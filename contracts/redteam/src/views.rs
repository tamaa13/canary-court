use crate::*;

const DEFAULT_LIMIT: u64 = 50;
const MAX_LIMIT: u64 = 200;

fn page(len: u64, from: Option<u64>, limit: Option<u64>) -> std::ops::Range<u64> {
    let from = from.unwrap_or(0).min(len);
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    from..(from.saturating_add(limit)).min(len)
}

#[near]
impl Contract {
    pub fn get_job(&self, job_id: JobId) -> Option<Job> {
        if job_id > u32::MAX as u64 {
            return None;
        }
        self.jobs.get(job_id as u32).cloned()
    }

    pub fn list_jobs(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Job> {
        page(self.jobs.len() as u64, from, limit)
            .filter_map(|i| self.jobs.get(i as u32).cloned())
            .collect()
    }

    pub fn get_findings(&self, job_id: JobId) -> Vec<FindingView> {
        self.get_job(job_id)
            .map(|j| j.findings.iter().filter_map(|f| self.get_finding(*f)).collect())
            .unwrap_or_default()
    }

    pub fn get_finding(&self, finding_id: FindingId) -> Option<FindingView> {
        if finding_id > u32::MAX as u64 {
            return None;
        }
        self.findings
            .get(finding_id as u32)
            .cloned()
            .map(|f| FindingView::new(f, self.finding_dedup_key(finding_id)))
    }

    pub fn get_bids(&self, job_id: JobId) -> Vec<Bid> {
        self.bids.get(&job_id).cloned().unwrap_or_default()
    }

    pub fn get_agent(&self, account_id: AccountId) -> Option<Agent> {
        self.agents.get(&account_id).cloned()
    }

    pub fn list_agents(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Agent> {
        page(self.agent_ids.len() as u64, from, limit)
            .filter_map(|i| self.agent_ids.get(i as u32))
            .filter_map(|id| self.agents.get(id).cloned())
            .collect()
    }

    pub fn get_target(&self, target_id: String) -> Option<Target> {
        self.targets.get(&target_id).cloned()
    }

    pub fn check_counterparty(&self, account_id: AccountId) -> Verdict {
        self.verdict_for(&account_id)
    }

    pub fn balance_of(&self, account_id: AccountId) -> Balances {
        self.balance(&account_id)
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner_id.clone(),
            token_id: self.token_id.clone(),
            outlayer_id: self.outlayer_id.clone(),
            enclave_code: serde_json::from_str(&self.enclave_code).unwrap_or(Value::Null),
            enclave_pubkey: self.enclave_pubkey.clone(),
            secrets_ref: self
                .secrets_ref
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok()),
            resource_limits: serde_json::from_str(&self.resource_limits).unwrap_or(Value::Null),
            policy: self.policy.clone(),
            outlayer_max_charge: U128(self.outlayer_max_charge()),
            infra_refund: U128(self.policy.outlayer_fee.0.saturating_sub(self.outlayer_max_charge())),
        }
    }

    pub fn get_policy_log(&self, from: Option<u64>, limit: Option<u64>) -> Vec<PolicyLogEntry> {
        page(self.policy_log.len() as u64, from, limit)
            .filter_map(|i| self.policy_log.get(i as u32).cloned())
            .collect()
    }

    /// Collection sizes, for pagination and e2e assertions.
    pub fn get_counts(&self) -> CountsView {
        CountsView {
            agents: self.agent_ids.len() as u64,
            jobs: self.jobs.len() as u64,
            findings: self.findings.len() as u64,
            policy_log: self.policy_log.len() as u64,
        }
    }
}
