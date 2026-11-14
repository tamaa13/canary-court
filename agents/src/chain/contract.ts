import type {
  Agent, Balance, Bid, ContractConfig, Finding, Job, PolicyLogEntry, Target, U128, Verdict,
} from './types.js';

/** Every state-changing call returns the decoded value plus the receipt pointer. */
export interface TxOutcome<T = void> {
  value: T;
  /** Testnet tx hash; null in mock / dry-run. */
  txHash: string | null;
  logs: string[];
  mock: boolean;
}

/**
 * A rejected call. `stage` tells where it died:
 *  - 'rpc'       → refused before inclusion (access-key scope, deposit on FC key, bad nonce…); txHash null
 *  - 'execution' → included on chain and the contract panicked; txHash points at the failed receipt
 */
export class ChainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly stage: 'rpc' | 'execution',
    public readonly txHash: string | null = null,
  ) {
    super(message);
    this.name = 'ChainError';
  }
}

/** Extract `ERR_<CODE>` from a panic string, or fall back to a provided code. */
export function errCode(msg: string, fallback = 'ERR_UNKNOWN'): string {
  return msg.match(/\bERR_[A-Z_]+/)?.[0] ?? fallback;
}

export interface CreateJobArgs {
  target_id: string;
  budget: U128;
  reward_per_finding: U128;
  categories: string[];
  deadline_ms: number;
}

export interface CreateSubjobArgs {
  parent_id: number;
  budget: U128;
  reward_per_finding: U128;
  categories: string[];
  deadline_ms: number;
}

/** A raw transaction an agent runtime might try (used by attack scenario 1 to prove key scope). */
export interface RawCall {
  receiverId: string;
  method: string;
  args: Record<string, unknown>;
  depositYocto?: bigint;
  /** Non-FunctionCall action, e.g. a plain NEAR transfer or AddKey. */
  action?: 'Transfer' | 'AddKey';
}

/**
 * Signer-bound client for the `redteam` contract (ARCHITECTURE §4, spec v0.3).
 * Two implementations: NearRedteam (testnet via near-api-js) and MockRedteam (in-memory, dry-run).
 *
 * Not exposed here on purpose:
 *  - `new` / `set_enclave` / `set_policy`  → owner-only, deployed by rt-contracts
 *  - `on_finding_evaluated`                → #[private] OutLayer callback
 *  - `ft_on_transfer`                      → called by the token; agents reach it via `fundUsdc`
 *                                            (= tusdc.ft_transfer_call, setup-only, full-access key)
 *  - `deposit_compute`                     → payable, setup-only, full-access key
 */
export interface RedteamContract {
  readonly accountId: string;
  readonly contractId: string;
  readonly mock: boolean;

  // registry
  registerAgent(role: Agent['role'], x25519Pubkey: string, meta: string): Promise<TxOutcome>;
  registerTarget(targetId: string, encTarget: string, categories: string[]): Promise<TxOutcome>;

  // jobs
  createJob(a: CreateJobArgs): Promise<TxOutcome<number>>;
  placeBid(jobId: number, pricePerFinding: U128, note: string): Promise<TxOutcome>;
  counterBid(jobId: number, bidder: string, pricePerFinding: U128): Promise<TxOutcome>;
  acceptBid(jobId: number, bidder: string): Promise<TxOutcome>;
  createSubjob(a: CreateSubjobArgs): Promise<TxOutcome<number>>;
  submitFinding(jobId: number, encPayload: string, category?: string): Promise<TxOutcome<number | null>>;
  expireJob(jobId: number): Promise<TxOutcome>;
  /** Returns false if the token transfer failed and the contract refunded the internal balance. */
  withdraw(amount: U128): Promise<TxOutcome<boolean>>;
  /** Refund unused compute NEAR (yocto) to the caller. */
  withdrawCompute(amount: U128): Promise<TxOutcome<unknown>>;

  // views
  getJob(jobId: number): Promise<Job | null>;
  listJobs(from?: number, limit?: number): Promise<Job[]>;
  getFindings(jobId: number): Promise<Finding[]>;
  getFinding(findingId: number): Promise<Finding | null>;
  getBids(jobId: number): Promise<Bid[]>;
  getAgent(accountId: string): Promise<Agent | null>;
  listAgents(from?: number, limit?: number): Promise<Agent[]>;
  getTarget(targetId: string): Promise<Target | null>;
  checkCounterparty(accountId: string): Promise<Verdict>;
  balanceOf(accountId: string): Promise<Balance>;
  getConfig(): Promise<ContractConfig>;
  getPolicyLog(from?: number, limit?: number): Promise<PolicyLogEntry[]>;

  /** Attack scenarios only: try an arbitrary tx with this agent's runtime key. */
  rawCall(c: RawCall): Promise<TxOutcome<unknown>>;
}

/** Page through the whole policy log (views cap `limit` at 200). */
export async function fullPolicyLog(c: RedteamContract) {
  const out = [];
  for (let from = 0; ; from += 200) {
    const page = await c.getPolicyLog(from, 200);
    out.push(...page);
    if (page.length < 200) return out;
  }
}
