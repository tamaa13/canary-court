use crate::*;

#[near]
impl Contract {
    /// Client locks `budget` from its internal USDC balance. Only the target owner.
    pub fn create_job(
        &mut self,
        target_id: String,
        budget: U128,
        reward_per_finding: U128,
        categories: Vec<String>,
        deadline_ms: u64,
    ) -> JobId {
        let caller = env::predecessor_account_id();
        self.assert_role(&caller, Role::Client);
        self.assert_not_blocked(&caller);
        let target = self
            .targets
            .get(&target_id)
            .cloned()
            .unwrap_or_else(|| fail("ERR_NOT_FOUND", &format!("target {} not found", target_id)));
        check(
            target.owner == caller,
            "ERR_NOT_TARGET_OWNER",
            "only the target owner can post jobs on it",
        );
        check(budget.0 > 0, "ERR_BUDGET_CAP", "budget must be > 0");
        check(
            budget.0 <= self.policy.max_budget.0,
            "ERR_BUDGET_CAP",
            &format!("budget exceeds policy max {}", self.policy.max_budget.0),
        );
        check(
            reward_per_finding.0 > 0 && reward_per_finding.0 <= budget.0,
            "ERR_REWARD",
            "reward_per_finding must be in 1..=budget",
        );
        let categories = self.validate_categories(categories, &target.categories);
        let now = env::block_timestamp_ms();
        check(
            deadline_ms >= now + self.policy.min_deadline_ms
                && deadline_ms <= now + self.policy.max_deadline_ms,
            "ERR_DEADLINE",
            &format!(
                "deadline must be within [now+{}ms, now+{}ms]",
                self.policy.min_deadline_ms, self.policy.max_deadline_ms
            ),
        );
        self.rate_limit(&caller);
        let mut b = self.balance(&caller);
        check(b.usdc.0 >= budget.0, "ERR_BALANCE", "insufficient USDC balance");
        b.usdc = U128(b.usdc.0 - budget.0);
        self.balances.insert(caller.clone(), b);

        self.lock_target_until(&target.target_id, deadline_ms);
        self.lock_pubkey_until(&caller, deadline_ms);
        let id = self.jobs.len() as JobId;
        let job = Job {
            id,
            parent_id: None,
            depth: 0,
            client: caller.clone(),
            root_client: caller.clone(),
            provider: None,
            target_id,
            budget,
            remaining: budget,
            reward_per_finding,
            payout_per_finding: reward_per_finding,
            categories,
            deadline_ms,
            status: JobStatus::Open,
            restricted: false,
            can_subcontract: false,
            children: vec![],
            findings: vec![],
            pending: 0,
            created_ms: now,
        };
        emit("job_created", serde_json::to_value(&job).unwrap_or(Value::Null));
        self.jobs.push(job);
        id
    }

    /// Provider bids on an Open job. Re-bidding updates price/note (this is how a counter is accepted).
    pub fn place_bid(&mut self, job_id: JobId, price_per_finding: U128, note: String) {
        let caller = env::predecessor_account_id();
        self.assert_role(&caller, Role::Provider);
        self.assert_not_blocked(&caller);
        check(note.len() <= MAX_NOTE_LEN, "ERR_INPUT", "note too long (max 256)");
        check(price_per_finding.0 > 0, "ERR_INPUT", "price must be > 0");
        let job = self.job(job_id).clone();
        check(job.status == JobStatus::Open, "ERR_STATUS", "job is not Open");
        check(
            env::block_timestamp_ms() < job.deadline_ms,
            "ERR_DEADLINE",
            "job deadline passed",
        );
        check(
            caller != job.client && caller != job.root_client,
            "ERR_SELF_DEAL",
            "cannot bid on your own job",
        );
        let mut bids = self.bids.get(&job_id).cloned().unwrap_or_default();
        if let Some(bid) = bids.iter_mut().find(|b| b.bidder == caller) {
            check(
                matches!(bid.status, BidStatus::Open | BidStatus::Countered),
                "ERR_BID",
                "bid is closed",
            );
            bid.price_per_finding = price_per_finding;
            bid.note = note;
            bid.status = BidStatus::Open;
        } else {
            check(bids.len() < MAX_BIDS_PER_JOB, "ERR_BID", "too many bids on this job");
            bids.push(Bid {
                bidder: caller.clone(),
                price_per_finding,
                note,
                counter_price: None,
                status: BidStatus::Open,
                created_ms: env::block_timestamp_ms(),
            });
        }
        self.bids.insert(job_id, bids);
        emit(
            "bid_placed",
            json!({ "job_id": job_id, "bidder": caller, "price_per_finding": price_per_finding }),
        );
    }

    /// Job client counters a bid, once per bid.
    pub fn counter_bid(&mut self, job_id: JobId, bidder: AccountId, price_per_finding: U128) {
        let caller = env::predecessor_account_id();
        let job = self.job(job_id).clone();
        check(caller == job.client, "ERR_NOT_CLIENT", "only the job client");
        check(job.status == JobStatus::Open, "ERR_STATUS", "job is not Open");
        check(price_per_finding.0 > 0, "ERR_INPUT", "price must be > 0");
        let mut bids = self.bids.get(&job_id).cloned().unwrap_or_default();
        let bid = bids
            .iter_mut()
            .find(|b| b.bidder == bidder)
            .unwrap_or_else(|| fail("ERR_NOT_FOUND", "bid not found"));
        check(bid.counter_price.is_none(), "ERR_BID", "bid already countered");
        check(bid.status == BidStatus::Open, "ERR_BID", "bid is not Open");
        bid.counter_price = Some(price_per_finding);
        bid.status = BidStatus::Countered;
        self.bids.insert(job_id, bids);
        emit(
            "bid_countered",
            json!({ "job_id": job_id, "bidder": bidder, "counter_price": price_per_finding }),
        );
    }

    /// Job client accepts a bid at the bid's current price. Runs check_counterparty:
    /// Block → panic; Warn → restricted (reward cap, no subcontracting, dual evaluation).
    pub fn accept_bid(&mut self, job_id: JobId, bidder: AccountId) {
        let caller = env::predecessor_account_id();
        let job = self.job(job_id).clone();
        check(caller == job.client, "ERR_NOT_CLIENT", "only the job client");
        check(job.status == JobStatus::Open, "ERR_STATUS", "job is not Open");
        check(
            env::block_timestamp_ms() < job.deadline_ms,
            "ERR_DEADLINE",
            "job deadline passed",
        );
        let mut bids = self.bids.get(&job_id).cloned().unwrap_or_default();
        let price = {
            let bid = bids
                .iter()
                .find(|b| b.bidder == bidder)
                .unwrap_or_else(|| fail("ERR_NOT_FOUND", "bid not found"));
            check(
                matches!(bid.status, BidStatus::Open | BidStatus::Countered),
                "ERR_BID",
                "bid is closed",
            );
            bid.price_per_finding
        };
        check(
            price.0 <= job.reward_per_finding.0,
            "ERR_REWARD",
            "bid price exceeds job reward_per_finding",
        );
        let verdict = self.assert_not_blocked(&bidder);
        let restricted = verdict.level == VerdictLevel::Warn;
        let payout = if restricted {
            price.0 * self.policy.warn_reward_cap_bps as u128 / 10_000
        } else {
            price.0
        };
        let can_subcontract = !restricted && job.depth < self.policy.max_depth;
        for b in bids.iter_mut() {
            b.status = if b.bidder == bidder {
                BidStatus::Accepted
            } else {
                BidStatus::Rejected
            };
        }
        self.bids.insert(job_id, bids);
        {
            let j = self.job_mut(job_id);
            j.provider = Some(bidder.clone());
            j.reward_per_finding = price;
            j.payout_per_finding = U128(payout);
            j.restricted = restricted;
            j.can_subcontract = can_subcontract;
            j.status = JobStatus::Assigned;
        }
        let detail = if restricted {
            format!(
                "assigned to {} RESTRICTED (auto-escalation): reward capped at {} bps, no subcontracting, dual evaluation",
                bidder, self.policy.warn_reward_cap_bps
            )
        } else {
            format!("assigned to {}", bidder)
        };
        self.log_policy(caller, "accept_bid", Some(job_id), Some(verdict), detail);
        emit(
            "bid_accepted",
            json!({
                "job_id": job_id, "provider": bidder, "reward_per_finding": price,
                "payout_per_finding": U128(payout), "restricted": restricted,
                "can_subcontract": can_subcontract,
            }),
        );
    }

    /// Lead carves a subjob out of its job's remaining budget.
    pub fn create_subjob(
        &mut self,
        parent_id: JobId,
        budget: U128,
        reward_per_finding: U128,
        categories: Vec<String>,
        deadline_ms: u64,
    ) -> JobId {
        let caller = env::predecessor_account_id();
        let parent = self.job(parent_id).clone();
        check(
            parent.provider.as_ref() == Some(&caller),
            "ERR_NOT_PROVIDER",
            "only the parent job's provider",
        );
        check(
            parent.status == JobStatus::Assigned,
            "ERR_STATUS",
            "parent job is not Assigned",
        );
        check(
            parent.depth < self.policy.max_depth,
            "ERR_DEPTH",
            &format!("max depth {} reached", self.policy.max_depth),
        );
        check(
            parent.can_subcontract,
            "ERR_NO_SUBCONTRACT",
            "provider is restricted on this job (can_subcontract=false)",
        );
        let verdict = self.assert_not_blocked(&caller);
        check(
            verdict.level == VerdictLevel::Allow,
            "ERR_NO_SUBCONTRACT",
            &format!("lead verdict is Warn: {}", verdict.reasons.join("; ")),
        );
        check(
            parent.children.len() < self.policy.max_children as usize,
            "ERR_MAX_CHILDREN",
            &format!("max {} subjobs per job", self.policy.max_children),
        );
        check(budget.0 > 0, "ERR_BUDGET_CAP", "budget must be > 0");
        check(
            budget.0 <= parent.remaining.0,
            "ERR_BUDGET_CAP",
            &format!("budget exceeds parent remaining {}", parent.remaining.0),
        );
        check(
            reward_per_finding.0 > 0 && reward_per_finding.0 <= budget.0,
            "ERR_REWARD",
            "reward_per_finding must be in 1..=budget",
        );
        check(
            reward_per_finding.0 <= parent.reward_per_finding.0,
            "ERR_REWARD",
            "subjob reward exceeds parent reward_per_finding",
        );
        let categories = self.validate_categories(categories, &parent.categories);
        let now = env::block_timestamp_ms();
        check(
            deadline_ms > now && deadline_ms <= parent.deadline_ms,
            "ERR_DEADLINE",
            "subjob deadline must be in (now, parent.deadline_ms]",
        );
        self.rate_limit(&caller);

        self.lock_pubkey_until(&caller, deadline_ms);
        self.lock_target_until(&parent.target_id, deadline_ms);
        let id = self.jobs.len() as JobId;
        {
            let p = self.job_mut(parent_id);
            p.remaining = U128(p.remaining.0 - budget.0);
            p.children.push(id);
        }
        let job = Job {
            id,
            parent_id: Some(parent_id),
            depth: parent.depth + 1,
            client: caller.clone(),
            root_client: parent.root_client.clone(),
            provider: None,
            target_id: parent.target_id.clone(),
            budget,
            remaining: budget,
            reward_per_finding,
            payout_per_finding: reward_per_finding,
            categories,
            deadline_ms,
            status: JobStatus::Open,
            restricted: false,
            can_subcontract: false,
            children: vec![],
            findings: vec![],
            pending: 0,
            created_ms: now,
        };
        emit("subjob_created", serde_json::to_value(&job).unwrap_or(Value::Null));
        self.jobs.push(job);
        self.log_policy(
            caller,
            "create_subjob",
            Some(id),
            Some(verdict),
            format!(
                "carved {} from job {} (lead margin {}/finding)",
                budget.0,
                parent_id,
                parent.reward_per_finding.0 - reward_per_finding.0
            ),
        );
        id
    }

    /// Anyone, after the deadline. Expires children first, refunds roll up:
    /// subjob.remaining → parent.remaining → root client balance.
    pub fn expire_job(&mut self, job_id: JobId) {
        let job = self.job(job_id).clone();
        check(job.is_active(), "ERR_STATUS", "job already Expired/Closed");
        check(
            env::block_timestamp_ms() >= job.deadline_ms,
            "ERR_DEADLINE",
            "deadline not reached",
        );
        let actor = env::predecessor_account_id();
        for child in job.children.iter() {
            if self.job(*child).is_active() {
                self.expire_inner(*child, &actor);
            }
        }
        self.expire_inner(job_id, &actor);
    }

    // ------------------------------------------------------------ internals

    fn expire_inner(&mut self, job_id: JobId, actor: &AccountId) {
        self.resolve_stale_pending(job_id);
        let (remaining, provider) = {
            let j = self.job_mut(job_id);
            let r = j.remaining.0;
            j.remaining = U128(0);
            j.status = JobStatus::Expired;
            (r, j.provider.clone())
        };
        self.log_policy(
            actor.clone(),
            "expire",
            Some(job_id),
            None,
            format!(
                "job expired (provider {})",
                provider.map(|p| p.to_string()).unwrap_or_else(|| "none".into())
            ),
        );
        self.refund_up(job_id, remaining);
    }

    /// Pending findings block expiry, unless older than pending_timeout_ms (then force-Failed).
    fn resolve_stale_pending(&mut self, job_id: JobId) {
        let job = self.job(job_id).clone();
        if job.pending == 0 {
            return;
        }
        let now = env::block_timestamp_ms();
        let timeout = self.policy.pending_timeout_ms;
        for fid in job.findings.iter() {
            let f = self.finding_mut(*fid);
            if f.status != FindingStatus::Pending {
                continue;
            }
            check(
                now.saturating_sub(f.created_ms) >= timeout,
                "ERR_PENDING",
                &format!("finding {} is still being evaluated; retry later", fid),
            );
            f.status = FindingStatus::Failed;
            f.error = Some("evaluation timed out".into());
            f.evaluated_ms = Some(now);
            let attacker = f.attacker.clone();
            if let Some(a) = self.agents.get_mut(&attacker) {
                a.failed += 1;
            }
            self.log_policy(
                env::predecessor_account_id(),
                "force_fail",
                Some(job_id),
                None,
                format!("finding {} pending > {}ms, marked Failed (no strike)", fid, timeout),
            );
        }
        self.job_mut(job_id).pending = 0;
    }

    /// Return `amount` from `job_id` to the nearest active ancestor, or the root client.
    pub(crate) fn refund_up(&mut self, job_id: JobId, amount: u128) {
        if amount == 0 {
            return;
        }
        let job = self.job(job_id).clone();
        let mut cur = job.parent_id;
        while let Some(pid) = cur {
            let p = self.job(pid).clone();
            if p.is_active() {
                let pm = self.job_mut(pid);
                pm.remaining = U128(pm.remaining.0 + amount);
                self.log_policy(
                    env::predecessor_account_id(),
                    "refund",
                    Some(job_id),
                    None,
                    format!("{} rolled up to job {}", amount, pid),
                );
                return;
            }
            cur = p.parent_id;
        }
        self.credit_usdc(&job.root_client, amount);
        self.log_policy(
            env::predecessor_account_id(),
            "refund",
            Some(job_id),
            None,
            format!("{} refunded to root client {}", amount, job.root_client),
        );
    }

    /// Close a job (e.g. a valid finding could not be paid) and refund what is left.
    pub(crate) fn close_job(&mut self, job_id: JobId, reason: &str) {
        let remaining = {
            let j = self.job_mut(job_id);
            if !j.is_active() {
                return;
            }
            let r = j.remaining.0;
            j.remaining = U128(0);
            j.status = JobStatus::Closed;
            r
        };
        self.log_policy(
            env::current_account_id(),
            "close",
            Some(job_id),
            None,
            reason.to_string(),
        );
        self.refund_up(job_id, remaining);
    }
}
