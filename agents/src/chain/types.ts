/** On-chain shapes of the `redteam` contract (ARCHITECTURE §4, spec v0.3). U128 → string, u64 → number. */

export type U128 = string;
export type JobStatus = 'Open' | 'Assigned' | 'Expired' | 'Closed';
export type FindingStatus = 'Pending' | 'Valid' | 'Invalid' | 'Failed';
export type BidStatus = 'Open' | 'Countered' | 'Accepted' | 'Rejected';
export type VerdictLevel = 'Allow' | 'Warn' | 'Block';
export type Severity = 'high' | 'medium' | 'low' | 'none';

export interface Job {
  id: number;
  parent_id: number | null;
  depth: number;
  client: string;
  root_client: string;
  provider: string | null;
  target_id: string;
  budget: U128;
  remaining: U128;
  reward_per_finding: U128;
  /** What the provider actually receives per valid finding (50% of reward when restricted). */
  payout_per_finding: U128;
  categories: string[];
  deadline_ms: number;
  status: JobStatus;
  restricted: boolean;
  can_subcontract: boolean;
  children: number[];
  findings: number[];
  /** In-flight evaluations. */
  pending: number;
  created_ms: number;
}

export interface Finding {
  id: number;
  job_id: number;
  attacker: string;
  status: FindingStatus;
  severity: Severity | null;
  manipulation: boolean;
  unpaid: boolean;
  paid_attacker: U128;
  paid_lead: U128;
  report_for_client: string | null;
  report_for_lead: string | null;
  result_hash: string | null;
  error: string | null;
  created_ms: number;
  evaluated_ms: number | null;
  category: string | null;
  /** Enclave HMAC dedup key (spec v0.4) or null. */
  dedup_key?: string | null;
}

export interface Strike {
  finding_id: number;
  evidence_hash: string;
  ts_ms?: number;
}

export interface Agent {
  account_id: string;
  role: 'client' | 'provider' | 'evaluator';
  x25519_pubkey: string;
  meta: string;
  registered_ms: number;
  registered_block: number;
  completed: number;
  invalid: number;
  failed: number;
  strikes: Strike[];
  blocked: boolean;
}

export interface Bid {
  bidder: string;
  price_per_finding: U128;
  note: string;
  counter_price: U128 | null;
  status: BidStatus;
  created_ms?: number;
}

export interface Verdict {
  level: VerdictLevel;
  reasons: string[];
}

export interface PolicyLogEntry {
  seq: number;
  ts_ms: number;
  block_height?: number;
  actor: string;
  action: string;
  job_id: number | null;
  verdict: Verdict | null;
  detail: string;
}

export interface Policy {
  max_budget: U128;
  max_depth: number;
  max_children: number;
  min_rep_completed: number;
  warn_reward_cap_bps: number;
  rate_limit_per_hour: number;
  outlayer_fee: U128;
  allowed_categories: string[];
  min_age_blocks: number;
  strikes_to_block: number;
  max_findings_per_job: number;
  min_deadline_ms: number;
  max_deadline_ms: number;
  pending_timeout_ms: number;
}

export interface ContractConfig {
  owner: string;
  token_id: string;
  outlayer_id: string;
  enclave_code: unknown;
  enclave_pubkey: string;
  policy: Policy;
}

export interface Target {
  target_id: string;
  owner: string;
  enc_target: string;
  categories: string[];
  created_ms?: number;
}

export interface Balance {
  usdc: U128;
  compute: U128;
}

/** Enclave output (ARCHITECTURE §5, rt-enclave main.rs EvalOutput). Reports exist only when valid. */
export interface EnclaveResult {
  v: 1;
  job_id: number;
  finding_id: number;
  valid: boolean;
  manipulation: boolean;
  severity: Severity;
  report_for_client: string | null;
  report_for_lead: string | null;
  result_hash: string | null;
  error: string | null;
  llm: 'mock' | 'live';
  model: string | null;
  model_signatures: unknown[];
  /** HMAC over (root_job_id, category, normalized payload); same key in one job tree = duplicate. */
  dedup_key?: string | null;
  /** e.g. BAD_CLIENT_KEY / BAD_LEAD_KEY: verdict stands, that report is null. */
  warnings?: string[];
  /** PAYLOAD_BINDING_MISMATCH only: compact JSON evidence; result_hash = sha256(error_record). */
  error_record?: string;
}

/** Plaintext of report_for_client / report_for_lead. sha256(record_json) == result_hash (also on chain). */
export interface FindingReport {
  v: 1;
  result_hash: string;
  record_json: string;
  payload: string;
  response_excerpt: string;
  /** Reports are capped (≤6800 b64 chars); the payload may be cut. */
  payload_truncated?: boolean;
}

/** Parsed record_json (the attested evaluation record). */
export interface EvalRecord {
  v: 1;
  job_id: number;
  finding_id: number;
  category: string;
  valid: boolean;
  manipulation: boolean;
  manipulation_rules: string[];
  severity: Severity;
  leak: string;
  dual: boolean;
  attempts: number;
  llm: string;
  model: string;
  chat_ids: string[];
  payload_sha256: string;
  response_sha256: string[];
}

/** Plaintext of enc_target. Bound to the owner (enclave v0.1.2): client_pubkey must equal the job's root client key. */
export interface TargetSecret {
  system_prompt: string;
  canary: string;
  model: string;
  client_pubkey?: string;
}

/** Plaintext of enc_payload. Bound to its job (enclave v0.1.2): job_id must equal the job it is submitted to. */
export interface PayloadSecret {
  payload: string;
  category: string;
  job_id?: number;
}
