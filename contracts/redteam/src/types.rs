use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::{near, AccountId};

pub type JobId = u64;
pub type FindingId = u64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Client,
    Provider,
    Evaluator,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Strike {
    pub finding_id: FindingId,
    /// OutLayer/enclave `result_hash` of the evaluation that proved manipulation.
    pub evidence_hash: String,
    pub ts_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub account_id: AccountId,
    pub role: Role,
    pub x25519_pubkey: String,
    pub meta: String,
    pub registered_ms: u64,
    pub registered_block: u64,
    /// Number of Valid findings.
    pub completed: u32,
    /// Number of Invalid findings (error == null && valid == false).
    pub invalid: u32,
    /// Number of Failed evaluations (OutLayer/enclave error). Not a reputation penalty.
    pub failed: u32,
    pub strikes: Vec<Strike>,
    pub blocked: bool,
    #[serde(skip)]
    pub rl_window_start_ms: u64,
    #[serde(skip)]
    pub rl_count: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Target {
    pub target_id: String,
    pub owner: AccountId,
    /// base64 ECIES ciphertext to the enclave: {system_prompt, canary, model}
    pub enc_target: String,
    pub categories: Vec<String>,
    pub created_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Open,
    Assigned,
    Expired,
    Closed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: JobId,
    pub parent_id: Option<JobId>,
    pub depth: u8,
    pub client: AccountId,
    pub root_client: AccountId,
    pub provider: Option<AccountId>,
    pub target_id: String,
    pub budget: U128,
    pub remaining: U128,
    /// Agreed price per valid finding (after accept_bid). Lead margin for subjobs is computed from this.
    pub reward_per_finding: U128,
    /// What the provider actually receives per valid finding (= reward, or reward * warn_reward_cap_bps if restricted).
    pub payout_per_finding: U128,
    pub categories: Vec<String>,
    pub deadline_ms: u64,
    pub status: JobStatus,
    pub restricted: bool,
    pub can_subcontract: bool,
    pub children: Vec<JobId>,
    pub findings: Vec<FindingId>,
    /// Findings currently awaiting the OutLayer callback.
    pub pending: u32,
    pub created_ms: u64,
}

impl Job {
    pub fn is_active(&self) -> bool {
        matches!(self.status, JobStatus::Open | JobStatus::Assigned)
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BidStatus {
    Open,
    Countered,
    Accepted,
    Rejected,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Bid {
    pub bidder: AccountId,
    pub price_per_finding: U128,
    pub note: String,
    pub counter_price: Option<U128>,
    pub status: BidStatus,
    pub created_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FindingStatus {
    Pending,
    Valid,
    Invalid,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Finding {
    pub id: FindingId,
    pub job_id: JobId,
    pub attacker: AccountId,
    /// Plaintext category metadata given at submission (or the job's categories comma-joined).
    pub category: String,
    pub status: FindingStatus,
    pub severity: Option<String>,
    pub manipulation: bool,
    pub unpaid: bool,
    pub paid_attacker: U128,
    pub paid_lead: U128,
    pub report_for_client: Option<String>,
    pub report_for_lead: Option<String>,
    pub result_hash: Option<String>,
    pub error: Option<String>,
    pub created_ms: u64,
    pub evaluated_ms: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub level: VerdictLevel,
    pub reasons: Vec<String>,
}

/// JSON: "Allow" | "Warn" | "Block".
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerdictLevel {
    Allow,
    Warn,
    Block,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PolicyLogEntry {
    pub seq: u64,
    pub ts_ms: u64,
    pub block_height: u64,
    pub actor: AccountId,
    pub action: String,
    pub job_id: Option<JobId>,
    pub verdict: Option<Verdict>,
    pub detail: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Balances {
    pub usdc: U128,
    /// yoctoNEAR available to pay OutLayer fees.
    pub compute: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    /// Max budget of a root job (token base units; tUSDC has 6 decimals).
    pub max_budget: U128,
    /// Max job depth (1 = root + one layer of subjobs). Payout logic supports ≤ 1.
    pub max_depth: u8,
    /// Max subjobs per job.
    pub max_children: u8,
    /// Agents with fewer Valid findings than this get Warn.
    pub min_rep_completed: u32,
    /// Reward cap for restricted (Warn) providers, in basis points.
    pub warn_reward_cap_bps: u16,
    /// create_job + create_subjob + register_target per agent per hour.
    pub rate_limit_per_hour: u32,
    /// yoctoNEAR deducted from the attacker's compute balance and attached to OutLayer.
    pub outlayer_fee: U128,
    pub allowed_categories: Vec<String>,
    /// Agents registered fewer blocks ago than this get Warn.
    pub min_age_blocks: u64,
    pub strikes_to_block: u32,
    pub max_findings_per_job: u32,
    pub min_deadline_ms: u64,
    pub max_deadline_ms: u64,
    /// expire_job force-Fails Pending findings older than this.
    pub pending_timeout_ms: u64,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            max_budget: U128(1_000_000_000), // 1000 tUSDC
            max_depth: 1,
            max_children: 2,
            min_rep_completed: 0,
            warn_reward_cap_bps: 5000,
            rate_limit_per_hour: 30,
            outlayer_fee: U128(20_000_000_000_000_000_000_000), // 0.02 NEAR
            allowed_categories: vec![
                "prompt_injection".into(),
                "tool_misuse".into(),
                "data_exfiltration".into(),
                "jailbreak".into(),
            ],
            min_age_blocks: 60,
            strikes_to_block: 2,
            max_findings_per_job: 20,
            min_deadline_ms: 60_000,
            max_deadline_ms: 7 * 24 * 3600 * 1000,
            pending_timeout_ms: 900_000,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ConfigView {
    pub owner: AccountId,
    pub token_id: AccountId,
    pub outlayer_id: AccountId,
    pub enclave_code: Value,
    pub enclave_pubkey: String,
    pub secrets_ref: Option<Value>,
    pub resource_limits: Value,
    pub policy: Policy,
    /// Worst-case OutLayer charge per run under `resource_limits` (yoctoNEAR).
    pub outlayer_max_charge: U128,
    /// Refunded to the attacker's compute when OutLayer produces no output (outlayer_fee − max charge).
    pub infra_refund: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CountsView {
    pub agents: u64,
    pub jobs: u64,
    pub findings: u64,
    pub policy_log: u64,
}

/// Parsed enclave output (§5). Unknown fields are ignored.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct EvalOutput {
    #[serde(default)]
    pub v: u32,
    pub job_id: u64,
    pub finding_id: u64,
    pub valid: bool,
    #[serde(default)]
    pub manipulation: bool,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub report_for_client: Option<String>,
    #[serde(default)]
    pub report_for_lead: Option<String>,
    #[serde(default)]
    pub result_hash: Option<String>,
    /// Enclave HMAC over (root_job_id, category, normalized payload): same attack → same key.
    #[serde(default)]
    pub dedup_key: Option<String>,
    /// Non-fatal enclave warnings, e.g. "BAD_CLIENT_KEY" / "BAD_LEAD_KEY" (that report is null).
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// JSON view of a Finding: the stored fields plus `dedup_key`. `dedup_key` lives under a raw storage
/// key so the stored Finding layout (and existing state) is unchanged.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct FindingView {
    pub id: FindingId,
    pub job_id: JobId,
    pub attacker: AccountId,
    pub category: String,
    pub status: FindingStatus,
    pub severity: Option<String>,
    pub manipulation: bool,
    pub unpaid: bool,
    pub paid_attacker: U128,
    pub paid_lead: U128,
    pub report_for_client: Option<String>,
    pub report_for_lead: Option<String>,
    pub result_hash: Option<String>,
    pub dedup_key: Option<String>,
    pub error: Option<String>,
    pub created_ms: u64,
    pub evaluated_ms: Option<u64>,
}

impl FindingView {
    pub fn new(f: Finding, dedup_key: Option<String>) -> Self {
        Self {
            id: f.id,
            job_id: f.job_id,
            attacker: f.attacker,
            category: f.category,
            status: f.status,
            severity: f.severity,
            manipulation: f.manipulation,
            unpaid: f.unpaid,
            paid_attacker: f.paid_attacker,
            paid_lead: f.paid_lead,
            report_for_client: f.report_for_client,
            report_for_lead: f.report_for_lead,
            result_hash: f.result_hash,
            dedup_key,
            error: f.error,
            created_ms: f.created_ms,
            evaluated_ms: f.evaluated_ms,
        }
    }
}
