//! Canary Court escrow contract (`redteam` account).
//!
//! An autonomous market for red-teaming AI agents. Clients post jobs against encrypted targets,
//! leads win them and subcontract (depth ≤ 1, ≤ 2 children), attackers submit payloads encrypted to
//! an OutLayer TEE enclave, and the evaluation callback pays out atomically.
//!
//! Agents hold only 0-deposit function-call keys to this contract. All value moves through
//! internal balances: USDC enters via `ft_on_transfer`, NEAR for OutLayer fees via `deposit_compute`,
//! and leaves via `withdraw` (the contract attaches the 1 yocto).
//!
//! Every panic is `"ERR_<CODE>: text"` so agents/tests can match on the code.

mod eval;
mod jobs;
mod solvency;
mod types;
mod views;

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests;

pub use solvency::{SolvencyView, SOLVENCY_RESERVE};
pub use types::*;

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

pub const EVENT_STANDARD: &str = "redteam";
pub const EVENT_VERSION: &str = "1.0.0";

pub const MAX_META_LEN: usize = 512;
pub const MAX_NOTE_LEN: usize = 256;
pub const MAX_BLOB_LEN: usize = 8192;
pub const MAX_BIDS_PER_JOB: usize = 20;
pub const HOUR_MS: u64 = 3_600_000;

pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
pub const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);
pub const GAS_EVAL_CALLBACK: Gas = Gas::from_tgas(50);
pub const GAS_SUBMIT_RESERVE: Gas = Gas::from_tgas(20);
pub const GAS_OUTLAYER_MIN: Gas = Gas::from_tgas(100);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// Signature as deployed on outlayer.testnet (from its embedded ABI, 2026-11-13).
/// The promise result handed to our callback is the guest's JSON output (`response_format: "Json"`),
/// or `null` when the run failed / produced nothing.
#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
trait OutLayer {
    fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    );
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Agents,
    AgentIds,
    Targets,
    Balances,
    Jobs,
    Findings,
    Bids,
    PolicyLog,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    token_id: AccountId,
    outlayer_id: AccountId,
    /// JSON (OutLayer code_source)
    enclave_code: String,
    enclave_pubkey: String,
    /// JSON (OutLayer secrets_ref)
    secrets_ref: Option<String>,
    /// JSON (OutLayer resource_limits)
    resource_limits: String,
    policy: Policy,
    agents: LookupMap<AccountId, Agent>,
    agent_ids: Vector<AccountId>,
    targets: LookupMap<String, Target>,
    balances: LookupMap<AccountId, Balances>,
    jobs: Vector<Job>,
    findings: Vector<Finding>,
    bids: LookupMap<JobId, Vec<Bid>>,
    policy_log: Vector<PolicyLogEntry>,
}

pub(crate) fn fail(code: &str, msg: &str) -> ! {
    env::panic_str(&format!("{}: {}", code, msg))
}

pub(crate) fn check(cond: bool, code: &str, msg: &str) {
    if !cond {
        fail(code, msg)
    }
}

pub(crate) fn emit(event: &str, data: Value) {
    let ev = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", ev));
}

fn default_resource_limits() -> Value {
    json!({
        "max_instructions": 10_000_000_000u64,
        "max_memory_mb": 128,
        "max_execution_seconds": 90
    })
}

/// OutLayer ExecutionSource: {"Project":{..}} | {"GitHub":{..}} | {"WasmUrl":{..}}
fn assert_execution_source(v: &Value) {
    let ok = v
        .as_object()
        .map(|m| {
            m.len() == 1
                && ["Project", "GitHub", "WasmUrl"]
                    .iter()
                    .any(|k| m.get(*k).map(|x| x.is_object()).unwrap_or(false))
        })
        .unwrap_or(false);
    check(
        ok,
        "ERR_INPUT",
        "enclave code must be an OutLayer ExecutionSource: {\"Project\":{..}} | {\"GitHub\":{..}} | {\"WasmUrl\":{..}}",
    );
}

fn is_hex_32(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[near]
impl Contract {
    // ------------------------------------------------------------------ setup

    #[init]
    pub fn new(
        owner_id: AccountId,
        token_id: AccountId,
        outlayer_id: AccountId,
        enclave_code: Value,
        enclave_pubkey: String,
        secrets_ref: Option<Value>,
        resource_limits: Option<Value>,
    ) -> Self {
        check(
            enclave_pubkey.is_empty() || is_hex_32(&enclave_pubkey),
            "ERR_INPUT",
            "enclave_pubkey must be 32-byte hex (or empty until known)",
        );
        assert_execution_source(&enclave_code);
        Self {
            owner_id,
            token_id,
            outlayer_id,
            enclave_code: enclave_code.to_string(),
            enclave_pubkey,
            secrets_ref: secrets_ref.map(|v| v.to_string()),
            resource_limits: resource_limits
                .unwrap_or_else(default_resource_limits)
                .to_string(),
            policy: Policy::default(),
            agents: LookupMap::new(StorageKey::Agents),
            agent_ids: Vector::new(StorageKey::AgentIds),
            targets: LookupMap::new(StorageKey::Targets),
            balances: LookupMap::new(StorageKey::Balances),
            jobs: Vector::new(StorageKey::Jobs),
            findings: Vector::new(StorageKey::Findings),
            bids: LookupMap::new(StorageKey::Bids),
            policy_log: Vector::new(StorageKey::PolicyLog),
        }
    }

    /// Owner only: point at a new enclave build / key / OutLayer params.
    pub fn set_enclave(
        &mut self,
        code: Value,
        enclave_pubkey: String,
        secrets_ref: Option<Value>,
        resource_limits: Option<Value>,
    ) {
        self.assert_owner();
        check(
            is_hex_32(&enclave_pubkey),
            "ERR_INPUT",
            "enclave_pubkey must be 32-byte hex",
        );
        assert_execution_source(&code);
        self.enclave_code = code.to_string();
        self.enclave_pubkey = enclave_pubkey;
        if secrets_ref.is_some() {
            self.secrets_ref = secrets_ref.map(|v| v.to_string());
        }
        if let Some(rl) = resource_limits {
            self.resource_limits = rl.to_string();
        }
        emit(
            "enclave_updated",
            json!({
                "enclave_pubkey": self.enclave_pubkey,
                "code": serde_json::from_str::<Value>(&self.enclave_code).unwrap_or(Value::Null),
            }),
        );
    }

    /// Owner only.
    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        check(policy.max_depth <= 1, "ERR_INPUT", "max_depth must be <= 1");
        check(
            policy.max_children >= 1 && policy.max_children <= 2,
            "ERR_INPUT",
            "max_children must be 1..=2",
        );
        check(
            policy.warn_reward_cap_bps <= 10_000,
            "ERR_INPUT",
            "warn_reward_cap_bps must be <= 10000",
        );
        check(policy.strikes_to_block >= 1, "ERR_INPUT", "strikes_to_block must be >= 1");
        check(
            policy.min_deadline_ms <= policy.max_deadline_ms,
            "ERR_INPUT",
            "min_deadline_ms > max_deadline_ms",
        );
        self.policy = policy;
        emit("policy_updated", json!({}));
    }

    /// Credits the attached NEAR to the caller's compute balance (pays OutLayer fees).
    #[payable]
    pub fn deposit_compute(&mut self) -> U128 {
        let amount = env::attached_deposit().as_yoctonear();
        check(amount > 0, "ERR_INPUT", "attach NEAR to deposit");
        let account = env::predecessor_account_id();
        let total = self.liabilities_seeded();
        let mut b = self.balance(&account);
        b.compute = U128(b.compute.0 + amount);
        let out = b.compute;
        self.balances.insert(account.clone(), b);
        self.set_liabilities(total + amount);
        emit(
            "deposit_compute",
            json!({ "account_id": account, "amount": U128(amount) }),
        );
        out
    }

    /// NEP-141 receiver. `msg == ""` credits `sender_id`'s internal USDC balance.
    /// Any other msg is refunded in full.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        check(
            env::predecessor_account_id() == self.token_id,
            "ERR_TOKEN",
            "only the configured token is accepted",
        );
        if !msg.is_empty() {
            return PromiseOrValue::Value(amount);
        }
        let mut b = self.balance(&sender_id);
        b.usdc = U128(b.usdc.0 + amount.0);
        self.balances.insert(sender_id.clone(), b);
        emit(
            "deposit_usdc",
            json!({ "account_id": sender_id, "amount": amount }),
        );
        PromiseOrValue::Value(U128(0))
    }

    /// 0-deposit. Sends `amount` of the caller's internal USDC out via ft_transfer
    /// (the contract attaches the 1 yocto). Re-credits on failure.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        check(amount.0 > 0, "ERR_INPUT", "amount must be > 0");
        let account = env::predecessor_account_id();
        let mut b = self.balance(&account);
        check(b.usdc.0 >= amount.0, "ERR_BALANCE", "insufficient USDC balance");
        b.usdc = U128(b.usdc.0 - amount.0);
        self.balances.insert(account.clone(), b);
        emit(
            "withdraw",
            json!({ "account_id": account, "amount": amount }),
        );
        ext_ft::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), amount, Some("Canary Court withdraw".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_WITHDRAW_CALLBACK)
                    .with_unused_gas_weight(0)
                    .on_withdraw(account, amount),
            )
    }

    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        // Only an actual failure re-credits. A "too long" result still means the transfer ran,
        // so re-crediting then would pay twice.
        let ok = !matches!(
            env::promise_result_checked(0, 0),
            Err(near_sdk::PromiseError::Failed)
        );
        if !ok {
            let mut b = self.balance(&account_id);
            b.usdc = U128(b.usdc.0 + amount.0);
            self.balances.insert(account_id.clone(), b);
            emit(
                "withdraw_refunded",
                json!({ "account_id": account_id, "amount": amount }),
            );
        }
        ok
    }

    /// 0-deposit. Refunds `amount` of the caller's unused compute balance as a NEAR transfer to the
    /// caller. Re-credits if the transfer fails (e.g. the account was deleted).
    pub fn withdraw_compute(&mut self, amount: U128) -> Promise {
        check(amount.0 > 0, "ERR_INPUT", "amount must be > 0");
        let account = env::predecessor_account_id();
        let mut b = self.balance(&account);
        check(
            b.compute.0 >= amount.0,
            "ERR_COMPUTE",
            "insufficient compute balance",
        );
        let total = self.liabilities_seeded();
        b.compute = U128(b.compute.0 - amount.0);
        self.balances.insert(account.clone(), b);
        self.set_liabilities(total.saturating_sub(amount.0));
        self.log_policy(
            account.clone(),
            "withdraw_compute",
            None,
            None,
            format!("{} yoctoNEAR compute refunded to {}", amount.0, account),
        );
        Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_WITHDRAW_CALLBACK)
                    .with_unused_gas_weight(0)
                    .on_withdraw_compute(account, amount),
            )
    }

    #[private]
    pub fn on_withdraw_compute(&mut self, account_id: AccountId, amount: U128) -> bool {
        let ok = !matches!(
            env::promise_result_checked(0, 0),
            Err(near_sdk::PromiseError::Failed)
        );
        if !ok {
            let total = self.liabilities_seeded();
            let mut b = self.balance(&account_id);
            b.compute = U128(b.compute.0 + amount.0);
            self.balances.insert(account_id.clone(), b);
            self.set_liabilities(total + amount.0);
            emit(
                "withdraw_compute_refunded",
                json!({ "account_id": account_id, "amount": amount }),
            );
        }
        ok
    }

    // --------------------------------------------------------------- registry

    pub fn register_agent(&mut self, role: Role, x25519_pubkey: String, meta: String) -> Agent {
        check(
            is_hex_32(&x25519_pubkey),
            "ERR_INPUT",
            "x25519_pubkey must be 32-byte hex",
        );
        check(meta.len() <= MAX_META_LEN, "ERR_INPUT", "meta too long (max 512)");
        check(
            !solvency::is_small_order_x25519(&x25519_pubkey),
            "ERR_BAD_KEY",
            "x25519_pubkey is zero / a small-order point",
        );
        self.assert_solvent();
        let account = env::predecessor_account_id();
        let key_lock = self.pubkey_locked_until(&account);
        let agent = if let Some(a) = self.agents.get_mut(&account) {
            check(a.role == role, "ERR_ROLE", "role is fixed at first registration");
            check(
                a.x25519_pubkey.eq_ignore_ascii_case(&x25519_pubkey)
                    || env::block_timestamp_ms() >= key_lock,
                "ERR_KEY_LOCKED",
                &format!(
                    "pubkey is frozen until {} (client/lead of an active job); meta can still change",
                    key_lock
                ),
            );
            a.x25519_pubkey = x25519_pubkey;
            a.meta = meta;
            a.clone()
        } else {
            let a = Agent {
                account_id: account.clone(),
                role,
                x25519_pubkey,
                meta,
                registered_ms: env::block_timestamp_ms(),
                registered_block: env::block_height(),
                completed: 0,
                invalid: 0,
                failed: 0,
                strikes: vec![],
                blocked: false,
                rl_window_start_ms: 0,
                rl_count: 0,
            };
            self.agents.insert(account.clone(), a.clone());
            self.agent_ids.push(account.clone());
            a
        };
        emit(
            "agent_registered",
            json!({ "account_id": account, "role": agent.role }),
        );
        agent
    }

    pub fn register_target(
        &mut self,
        target_id: String,
        enc_target: String,
        categories: Vec<String>,
    ) -> Target {
        let caller = env::predecessor_account_id();
        self.assert_role(&caller, Role::Client);
        self.assert_solvent();
        check(
            !target_id.is_empty()
                && target_id.len() <= 64
                && target_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.'),
            "ERR_INPUT",
            "target_id must be 1-64 chars [A-Za-z0-9._-]",
        );
        check(
            !enc_target.is_empty() && enc_target.len() <= MAX_BLOB_LEN,
            "ERR_INPUT",
            "enc_target must be 1..8192 bytes",
        );
        let categories = self.validate_categories(categories, &self.policy.allowed_categories.clone());
        if let Some(existing) = self.targets.get(&target_id) {
            check(
                existing.owner == caller,
                "ERR_NOT_TARGET_OWNER",
                "target_id taken by another owner",
            );
            let until = self.target_locked_until(&target_id);
            check(
                env::block_timestamp_ms() >= until,
                "ERR_TARGET_LOCKED",
                &format!("target is immutable while jobs on it are active (until {})", until),
            );
        }
        // Contract-paid storage: count targets toward the per-agent hourly rate limit.
        self.rate_limit(&caller);
        let t = Target {
            target_id: target_id.clone(),
            owner: caller.clone(),
            enc_target,
            categories,
            created_ms: env::block_timestamp_ms(),
        };
        self.targets.insert(target_id.clone(), t.clone());
        emit(
            "target_registered",
            json!({ "target_id": target_id, "owner": caller, "categories": t.categories }),
        );
        t
    }

    // ------------------------------------------------------------ internals

    pub(crate) fn assert_owner(&self) {
        check(
            env::predecessor_account_id() == self.owner_id,
            "ERR_NOT_OWNER",
            "owner only",
        );
    }

    pub(crate) fn balance(&self, account: &AccountId) -> Balances {
        self.balances.get(account).cloned().unwrap_or_default()
    }

    pub(crate) fn credit_usdc(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let mut b = self.balance(account);
        b.usdc = U128(b.usdc.0 + amount);
        self.balances.insert(account.clone(), b);
    }

    pub(crate) fn agent(&self, account: &AccountId) -> &Agent {
        self.agents
            .get(account)
            .unwrap_or_else(|| fail("ERR_NOT_REGISTERED", &format!("{} is not registered", account)))
    }

    pub(crate) fn assert_role(&self, account: &AccountId, role: Role) {
        let a = self.agent(account);
        check(
            a.role == role,
            "ERR_ROLE",
            &format!("{} must have role {:?}", account, role).to_lowercase(),
        );
    }

    /// Non-empty, deduped, each in `allowed`.
    pub(crate) fn validate_categories(&self, categories: Vec<String>, allowed: &[String]) -> Vec<String> {
        check(!categories.is_empty(), "ERR_CATEGORY", "categories must be non-empty");
        let mut out: Vec<String> = Vec::new();
        for c in categories {
            check(
                self.policy.allowed_categories.contains(&c),
                "ERR_CATEGORY",
                &format!("category '{}' not allowed by policy", c),
            );
            check(
                allowed.contains(&c),
                "ERR_CATEGORY",
                &format!("category '{}' not allowed here", c),
            );
            if !out.contains(&c) {
                out.push(c);
            }
        }
        out
    }

    /// Fixed one-hour window, counts create_job + create_subjob + register_target.
    pub(crate) fn rate_limit(&mut self, account: &AccountId) {
        let now = env::block_timestamp_ms();
        let limit = self.policy.rate_limit_per_hour;
        let a = self
            .agents
            .get_mut(account)
            .unwrap_or_else(|| fail("ERR_NOT_REGISTERED", "not registered"));
        if now.saturating_sub(a.rl_window_start_ms) >= HOUR_MS {
            a.rl_window_start_ms = now;
            a.rl_count = 0;
        }
        check(
            a.rl_count < limit,
            "ERR_RATE_LIMIT",
            &format!("max {} jobs per hour", limit),
        );
        a.rl_count += 1;
    }

    pub(crate) fn log_policy(
        &mut self,
        actor: AccountId,
        action: &str,
        job_id: Option<JobId>,
        verdict: Option<Verdict>,
        detail: String,
    ) {
        let entry = PolicyLogEntry {
            seq: self.policy_log.len() as u64,
            ts_ms: env::block_timestamp_ms(),
            block_height: env::block_height(),
            actor,
            action: action.to_string(),
            job_id,
            verdict,
            detail,
        };
        emit("policy", serde_json::to_value(&entry).unwrap_or(Value::Null));
        self.policy_log.push(entry);
    }

    /// The counterparty verdict from on-chain stats (§3.3).
    pub(crate) fn verdict_for(&self, account_id: &AccountId) -> Verdict {
        let Some(a) = self.agents.get(account_id) else {
            return Verdict {
                level: VerdictLevel::Block,
                reasons: vec!["not registered".into()],
            };
        };
        if a.blocked {
            let ev: Vec<String> = a.strikes.iter().map(|s| s.evidence_hash.clone()).collect();
            return Verdict {
                level: VerdictLevel::Block,
                reasons: vec![format!(
                    "blocklisted: {} manipulation strikes (evidence: {})",
                    a.strikes.len(),
                    ev.join(",")
                )],
            };
        }
        let mut reasons = vec![];
        if !a.strikes.is_empty() {
            reasons.push(format!(
                "{} manipulation strike(s), evidence {}",
                a.strikes.len(),
                a.strikes[0].evidence_hash
            ));
        }
        let age = env::block_height().saturating_sub(a.registered_block);
        if age < self.policy.min_age_blocks {
            reasons.push(format!(
                "new agent: registered {} blocks ago (< {})",
                age, self.policy.min_age_blocks
            ));
        }
        if a.completed < self.policy.min_rep_completed {
            reasons.push(format!(
                "low reputation: {} completed (< {})",
                a.completed, self.policy.min_rep_completed
            ));
        }
        if a.invalid >= 3 && a.invalid > a.completed.saturating_mul(2) {
            reasons.push(format!(
                "high invalid ratio: {} invalid vs {} completed",
                a.invalid, a.completed
            ));
        }
        if reasons.is_empty() {
            Verdict {
                level: VerdictLevel::Allow,
                reasons: vec![format!(
                    "age {} blocks, {} completed, {} invalid, 0 strikes",
                    age, a.completed, a.invalid
                )],
            }
        } else {
            Verdict {
                level: VerdictLevel::Warn,
                reasons,
            }
        }
    }

    pub(crate) fn assert_not_blocked(&self, account_id: &AccountId) -> Verdict {
        let v = self.verdict_for(account_id);
        if v.level == VerdictLevel::Block {
            fail(
                "ERR_COUNTERPARTY_BLOCK",
                &format!("{}: {}", account_id, v.reasons.join("; ")),
            );
        }
        v
    }

    pub(crate) fn job(&self, job_id: JobId) -> &Job {
        self.jobs
            .get(job_id as u32)
            .filter(|_| job_id <= u32::MAX as u64)
            .unwrap_or_else(|| fail("ERR_NOT_FOUND", &format!("job {} not found", job_id)))
    }

    pub(crate) fn job_mut(&mut self, job_id: JobId) -> &mut Job {
        check(job_id <= u32::MAX as u64, "ERR_NOT_FOUND", "job not found");
        self.jobs
            .get_mut(job_id as u32)
            .unwrap_or_else(|| fail("ERR_NOT_FOUND", &format!("job {} not found", job_id)))
    }

    pub(crate) fn finding_mut(&mut self, finding_id: FindingId) -> &mut Finding {
        check(finding_id <= u32::MAX as u64, "ERR_NOT_FOUND", "finding not found");
        self.findings
            .get_mut(finding_id as u32)
            .unwrap_or_else(|| fail("ERR_NOT_FOUND", &format!("finding {} not found", finding_id)))
    }
}
