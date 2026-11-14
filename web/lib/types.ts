// Shapes mirror docs/ARCHITECTURE.md §4 (spec v0.3.1). U128 travels as a decimal string.
// Optional Rust fields (Option<T>) may arrive as `null` or be absent; consumers must handle both.

export type U128 = string;
export type AccountId = string;

export type JobStatus = 'Open' | 'Assigned' | 'Expired' | 'Closed';
export type FindingStatus = 'Pending' | 'Valid' | 'Invalid' | 'Failed';
export type Severity = 'high' | 'medium' | 'low' | 'none';
export type VerdictLevel = 'Allow' | 'Warn' | 'Block';
export type BidStatus = 'Open' | 'Countered' | 'Accepted' | 'Rejected';
export type Role = 'client' | 'provider' | 'evaluator';

export interface Job {
  id: number;
  parent_id?: number | null;
  depth: number;
  client: AccountId;
  root_client: AccountId;
  provider?: AccountId | null;
  target_id: string;
  budget: U128;
  remaining: U128;
  reward_per_finding: U128;
  /** what the provider actually receives per Valid finding (reward × warn cap when restricted) */
  payout_per_finding: U128;
  categories: string[];
  deadline_ms: number;
  status: JobStatus;
  restricted: boolean;
  can_subcontract: boolean;
  children: number[];
  findings: number[];
  pending: number;
  created_ms: number;
}

export interface Finding {
  id: number;
  job_id: number;
  attacker: AccountId;
  category?: string | null;
  status: FindingStatus;
  severity?: Severity | null;
  manipulation: boolean;
  unpaid: boolean;
  paid_attacker: U128;
  paid_lead: U128;
  report_for_client?: string | null; // base64 ECIES to root client — never decrypted by the dashboard
  report_for_lead?: string | null;
  result_hash?: string | null;
  /** enclave dedup key (root job + category + normalized payload); a repeat under the same root is Valid + unpaid */
  dedup_key?: string | null;
  error?: string | null;
  created_ms: number;
  evaluated_ms?: number | null;
}

export interface Strike {
  finding_id: number;
  evidence_hash: string;
  ts_ms?: number;
}

export interface Agent {
  account_id: AccountId;
  role: Role;
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
  bidder: AccountId;
  price_per_finding: U128;
  note: string;
  counter_price?: U128 | null;
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
  actor: AccountId;
  action: string;
  job_id?: number | null;
  verdict?: Verdict | null;
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

export interface Config {
  owner: AccountId;
  token_id: AccountId;
  outlayer_id: AccountId;
  enclave_code: unknown; // OutLayer CodeSource, rendered generically
  enclave_pubkey: string;
  secrets_ref?: unknown;
  resource_limits?: unknown;
  /** refunded to the attacker when OutLayer produces no output (infra timeout) */
  infra_refund?: U128;
  outlayer_max_charge?: U128;
  policy: Policy;
}

export interface Counts {
  agents: number;
  jobs: number;
  findings: number;
  policy_log: number;
}

export interface Solvency {
  balance: U128;
  storage_usage: number;
  storage_cost: U128;
  compute_liabilities: U128;
  reserve: U128;
  headroom: string; // signed decimal
  solvent: boolean;
}

/** Policy-log `action` values (contracts/VIEWS.md). */
export type PolicyAction = 'accept_bid' | 'create_subjob' | 'strike' | 'blocklist' | 'expire' | 'refund' | 'close' | 'unpaid' | 'lead_margin_unpaid' | 'force_fail' | 'withdraw_compute' | 'duplicate' | 'client_fault' | 'infra_timeout';

/** Function-call key method list the agent runtime holds (receiver = redteam, 0 deposit). */
export const AGENT_FC_METHODS = ['register_agent', 'register_target', 'create_job', 'place_bid', 'counter_bid', 'accept_bid', 'create_subjob', 'submit_finding', 'expire_job', 'withdraw', 'withdraw_compute'];

export interface Balance {
  usdc: U128;
  compute: U128;
}

/** agents/fixtures/attack-receipts.json entry (spec §6). */
export interface AttackReceipt {
  name: string;
  scenario: number | string;
  title?: string;
  signer: AccountId;
  method: string;
  args_summary: string;
  tx_hash: string | null;
  /** one code or alternatives "A|B"; null for non-error entries (decisions, view checks) */
  expected_error: string | null;
  observed_error: string | null;
  stage?: 'rpc' | 'execution' | null;
  expected?: string;
  observed?: string;
  ok: boolean;
  mock?: boolean;
}

/** Panic codes (contracts/VIEWS.md). On chain: `Smart contract panicked: ERR_<CODE>: text`. */
export const ERR = {
  BUDGET_CAP: 'ERR_BUDGET_CAP',
  DEPTH: 'ERR_DEPTH',
  MAX_CHILDREN: 'ERR_MAX_CHILDREN',
  CATEGORY: 'ERR_CATEGORY',
  REWARD: 'ERR_REWARD',
  NO_SUBCONTRACT: 'ERR_NO_SUBCONTRACT',
  COUNTERPARTY_BLOCK: 'ERR_COUNTERPARTY_BLOCK',
  RATE_LIMIT: 'ERR_RATE_LIMIT',
  DEADLINE: 'ERR_DEADLINE',
  NOT_PROVIDER: 'ERR_NOT_PROVIDER',
  NOT_CLIENT: 'ERR_NOT_CLIENT',
  NOT_TARGET_OWNER: 'ERR_NOT_TARGET_OWNER',
  NOT_OWNER: 'ERR_NOT_OWNER',
  NOT_REGISTERED: 'ERR_NOT_REGISTERED',
  ROLE: 'ERR_ROLE',
  BALANCE: 'ERR_BALANCE',
  COMPUTE: 'ERR_COMPUTE',
  STATUS: 'ERR_STATUS',
  NOT_FOUND: 'ERR_NOT_FOUND',
  SELF_DEAL: 'ERR_SELF_DEAL',
  BID: 'ERR_BID',
  PENDING: 'ERR_PENDING',
  FINDINGS_CAP: 'ERR_FINDINGS_CAP',
  STORAGE: 'ERR_STORAGE',
  TARGET_LOCKED: 'ERR_TARGET_LOCKED',
  KEY_LOCKED: 'ERR_KEY_LOCKED',
  BAD_KEY: 'ERR_BAD_KEY',
  GAS: 'ERR_GAS',
  INPUT: 'ERR_INPUT',
  TOKEN: 'ERR_TOKEN',
  MINT_CAP: 'ERR_MINT_CAP',
} as const;

/** Extracts "ERR_<CODE>" from any panic/RPC error text. */
export function errCode(text: string | null | undefined): string | null {
  const m = text?.match(/\bERR_[A-Z0-9_]+/);
  return m ? m[0] : null;
}
