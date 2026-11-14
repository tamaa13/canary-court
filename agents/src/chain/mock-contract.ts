/**
 * In-memory `redteam` contract for dry-run and unit tests. It mirrors rt-contracts' semantics as
 * documented in contracts/VIEWS.md (check order, payouts, roll-up refunds, policy-log actions, error
 * codes "ERR_<CODE>: text"), and it emulates NEAR access-key rules for function-call keys so attack
 * scenario 1 behaves the same offline as on testnet. The deployed contract is the source of truth.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { config, FC_METHODS } from '../config.js';
import { MockEnclave } from '../enclave/mock-enclave.js';
import {
  ChainError, type CreateJobArgs, type CreateSubjobArgs, type RawCall, type RedteamContract, type TxOutcome,
} from './contract.js';
import type {
  Agent, Balance, Bid, ContractConfig, EnclaveResult, Finding, Job, Policy, PolicyLogEntry, Target, Verdict,
} from './types.js';

const panic = (code: string, text: string): never => {
  throw new ChainError(`${code}: ${text}`, code, 'execution', null);
};

/** Defaults copied from contracts/VIEWS.md get_config sample. */
const DEFAULT_MOCK_POLICY: Policy = {
  max_budget: '1000000000',
  max_depth: 1,
  max_children: 2,
  min_rep_completed: 0,
  warn_reward_cap_bps: 5000,
  rate_limit_per_hour: 30,
  outlayer_fee: config.outlayerFeeYocto.toString(),
  allowed_categories: [...config.categories],
  min_age_blocks: 60,
  strikes_to_block: 2,
  max_findings_per_job: 20,
  min_deadline_ms: 60_000,
  max_deadline_ms: 604_800_000,
  pending_timeout_ms: 900_000,
};

const ACTIVE = (j: Job) => j.status === 'Open' || j.status === 'Assigned';

/** Enclave errors caused by the client's target (not the attacker): fee is refunded (C6). */
export const CLIENT_FAULT_ERRORS = ['TARGET_DECRYPT_FAILED', 'BAD_TARGET', 'MODEL_NOT_ALLOWED', 'TARGET_BINDING_MISMATCH'];
/** Enclave errors that prove the attacker cheated (replayed someone else's sealed payload): strike. */
const ATTACKER_FAULT_ERRORS = ['PAYLOAD_BINDING_MISMATCH'];

function isLowOrder(pkHex: string): boolean {
  try {
    const shared = x25519.getSharedSecret(x25519.utils.randomSecretKey(), Buffer.from(pkHex, 'hex'));
    return shared.every((b) => b === 0);
  } catch {
    return true;
  }
}

/** Shared chain state; each agent gets a signer-bound MockRedteam via `as(accountId)`. */
export class MockChain {
  readonly contractId = config.redteamContract;
  readonly enclave: MockEnclave;
  policy: Policy;
  owner = config.rootAccount;
  block = 1_000;
  private clockOffset = 0;
  private seq = 0;

  balances = new Map<string, { usdc: bigint; compute: bigint }>();
  /** tUSDC held in each account's own wallet (outside the contract) after withdraw. */
  wallets = new Map<string, bigint>();
  agents = new Map<string, Agent>();
  targets = new Map<string, Target>();
  jobs: Job[] = [];
  findings: Finding[] = [];
  bids = new Map<number, Bid[]>();
  policyLog: PolicyLogEntry[] = [];
  private rate = new Map<string, { windowStart: number; count: number }>();
  private dedupKeys = new Map<string, number>();
  private pending = new Set<Promise<void>>();
  /** Evaluation latency in ms (OutLayer round-trip stand-in). */
  evalDelayMs = 25;
  /** Test hook: make the next N evaluations fail like an OutLayer error. */
  failNextEvaluations = 0;

  constructor(opts: { policy?: Partial<Policy>; enclave?: MockEnclave } = {}) {
    this.policy = { ...DEFAULT_MOCK_POLICY, ...opts.policy };
    this.enclave = opts.enclave ?? new MockEnclave();
  }

  now(): number {
    return Date.now() + this.clockOffset;
  }
  advanceTime(ms: number): void {
    this.clockOffset += ms;
  }
  advanceBlocks(n: number): void {
    this.block += n;
  }
  async settle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  as(accountId: string): MockRedteam {
    return new MockRedteam(this, accountId);
  }

  /** Setup stand-ins for tusdc.ft_transfer_call (→ ft_on_transfer, msg="") and payable deposit_compute. */
  fundUsdc(accountId: string, amount: bigint): void {
    this.bal(accountId).usdc += amount;
  }
  depositCompute(accountId: string, yocto: bigint): void {
    this.bal(accountId).compute += yocto;
  }

  bal(a: string) {
    let b = this.balances.get(a);
    if (!b) this.balances.set(a, (b = { usdc: 0n, compute: 0n }));
    return b;
  }

  log(actor: string, action: string, detail: string, job_id: number | null = null, verdict: Verdict | null = null): void {
    this.policyLog.push({ seq: this.seq++, ts_ms: this.now(), block_height: this.block, actor, action, job_id, verdict, detail });
  }

  job(id: number): Job {
    return this.jobs[id] ?? panic('ERR_NOT_FOUND', `job ${id}`);
  }

  checkCounterparty(accountId: string): Verdict {
    const a = this.agents.get(accountId);
    if (!a) return { level: 'Block', reasons: ['not registered'] };
    if (a.blocked) return { level: 'Block', reasons: [`blocklisted: ${a.strikes.length} manipulation strikes (evidence: ${a.strikes.map((s) => s.evidence_hash.slice(0, 8)).join(',')})`] };
    const reasons: string[] = [];
    const age = this.block - a.registered_block;
    if (a.strikes.length) reasons.push(`${a.strikes.length} manipulation strike(s)`);
    if (age < this.policy.min_age_blocks) reasons.push(`new agent: registered ${age} blocks ago (< ${this.policy.min_age_blocks})`);
    if (a.completed < this.policy.min_rep_completed) reasons.push(`low reputation: ${a.completed} completed (< ${this.policy.min_rep_completed})`);
    if (a.invalid >= 3 && a.invalid > 2 * a.completed) reasons.push(`mostly invalid findings: ${a.invalid} invalid vs ${a.completed} completed`);
    if (reasons.length) return { level: 'Warn', reasons };
    return { level: 'Allow', reasons: [`age ${age} blocks, ${a.completed} completed, ${a.invalid} invalid, 0 strikes`] };
  }

  notBlocked(accountId: string): void {
    const v = this.checkCounterparty(accountId);
    if (v.level === 'Block' && this.agents.has(accountId)) panic('ERR_COUNTERPARTY_BLOCK', `${accountId}: ${v.reasons.join('; ')}`);
  }

  rateLimit(actor: string): void {
    const now = this.now();
    let r = this.rate.get(actor);
    if (!r || now - r.windowStart >= 3600_000) this.rate.set(actor, (r = { windowStart: now, count: 0 }));
    if (r.count >= this.policy.rate_limit_per_hour) panic('ERR_RATE_LIMIT', `${actor} exceeded ${this.policy.rate_limit_per_hour} jobs/hour`);
    r.count++;
  }

  /** Refund a closed/expired job's remaining one level up (active parent) or to the root client. */
  rollUp(job: Job, actor: string): void {
    const rem = BigInt(job.remaining);
    job.remaining = '0';
    if (rem === 0n) return;
    const parent = job.parent_id !== null ? this.jobs[job.parent_id] : null;
    if (parent && ACTIVE(parent)) {
      parent.remaining = (BigInt(parent.remaining) + rem).toString();
      this.log(actor, 'refund', `${rem} from job ${job.id} rolled up to job ${parent.id}`, job.id);
    } else {
      this.bal(job.root_client).usdc += rem;
      this.log(actor, 'refund', `${rem} from job ${job.id} refunded to root client ${job.root_client}`, job.id);
    }
  }

  close(job: Job, actor: string): void {
    job.status = 'Closed';
    this.log(actor, 'close', `job ${job.id} closed (budget exhausted)`, job.id);
    this.rollUp(job, actor);
  }

  scheduleEvaluation(job: Job, f: Finding, encPayload: string, category: string): void {
    const rootClient = this.agents.get(job.root_client)!;
    const lead = job.depth === 1 ? this.agents.get(job.client) : undefined;
    const target = this.targets.get(job.target_id)!;
    const fail = this.failNextEvaluations > 0 ? (this.failNextEvaluations--, true) : false;
    const p = (async () => {
      await new Promise((r) => setTimeout(r, this.evalDelayMs));
      let result: EnclaveResult | null = null;
      let error: string | null = null;
      try {
        if (fail) throw new Error('outlayer: run failed or produced no output (simulated queue timeout)');
        result = this.enclave.evaluate({
          op: 'evaluate', job_id: job.id, finding_id: f.id, category,
          enc_target: target.enc_target, enc_payload: encPayload,
          client_pubkey: rootClient.x25519_pubkey, lead_pubkey: lead?.x25519_pubkey ?? null,
          dual: job.restricted, root_job_id: job.parent_id ?? job.id,
        });
      } catch (e) {
        error = (e as Error).message;
      }
      this.onFindingEvaluated(job.id, f.id, result, error);
    })();
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Mirrors the #[private] callback `on_finding_evaluated`. */
  onFindingEvaluated(jobId: number, findingId: number, r: EnclaveResult | null, error: string | null = null): void {
    const job = this.jobs[jobId];
    const f = this.findings[findingId];
    const attacker = this.agents.get(f.attacker)!;
    const actor = this.contractId;
    job.pending = Math.max(0, job.pending - 1);
    f.evaluated_ms = this.now();
    if (f.status !== 'Pending') return; // force-failed meanwhile
    if (!r || r.v !== 1 || r.error || r.job_id !== jobId || r.finding_id !== findingId) {
      f.status = 'Failed';
      f.error = error ?? (r?.error ? `enclave: ${r.error}` : 'bad output: malformed enclave output');
      if (error && !error.startsWith('outlayer: ')) f.error = `outlayer: ${error}`;
      if (!r) {
        // OutLayer returned nothing (queue / yield timeout): infra, not the attacker → 0.009 of the 0.02 fee back
        this.bal(f.attacker).compute += 9_000_000_000_000_000_000_000n;
        this.log(actor, 'infra_timeout', `finding ${f.id}: OutLayer returned no output; 0.009 NEAR refunded to ${f.attacker}`, jobId);
        return;
      }
      attacker.failed++;
      if (r?.error && CLIENT_FAULT_ERRORS.includes(r.error)) {
        this.bal(f.attacker).compute += BigInt(this.policy.outlayer_fee); // C6: not the attacker's fault
        this.log(job.root_client, 'client_fault', `finding ${f.id}: enclave ${r.error}; OutLayer fee refunded to ${f.attacker}`, jobId);
      }
      if (r?.error && ATTACKER_FAULT_ERRORS.includes(r.error)) {
        attacker.strikes.push({ finding_id: f.id, evidence_hash: r.result_hash ?? '', ts_ms: this.now() });
        this.log(actor, 'strike', `${f.attacker} strike ${attacker.strikes.length}/${this.policy.strikes_to_block}: ${r.error} (replayed sealed payload)`, jobId, this.checkCounterparty(f.attacker));
        if (attacker.strikes.length >= this.policy.strikes_to_block && !attacker.blocked) {
          attacker.blocked = true;
          this.log(actor, 'blocklist', `${f.attacker} blocked after ${attacker.strikes.length} strikes`, jobId, this.checkCounterparty(f.attacker));
        }
      }
      return;
    }
    f.dedup_key = r.dedup_key ?? null;
    f.manipulation = r.manipulation;
    f.severity = r.severity;
    f.result_hash = r.result_hash;
    f.report_for_client = r.report_for_client;
    f.report_for_lead = r.report_for_lead;
    if (r.manipulation) {
      f.status = 'Invalid';
      attacker.invalid++;
      attacker.strikes.push({ finding_id: f.id, evidence_hash: r.result_hash ?? '', ts_ms: this.now() });
      const v = this.checkCounterparty(f.attacker);
      this.log(actor, 'strike', `${f.attacker} strike ${attacker.strikes.length}/${this.policy.strikes_to_block}, evidence ${r.result_hash}`, jobId, v);
      if (attacker.strikes.length >= this.policy.strikes_to_block && !attacker.blocked) {
        attacker.blocked = true;
        this.log(actor, 'blocklist', `${f.attacker} blocked after ${attacker.strikes.length} strikes`, jobId, this.checkCounterparty(f.attacker));
      }
      return;
    }
    if (!r.valid) {
      f.status = 'Invalid';
      attacker.invalid++;
      return;
    }
    f.status = 'Valid';
    attacker.completed++;
    {
      const root = job.parent_id ?? job.id;
      const k = `${root}/${r.dedup_key ? `k:${r.dedup_key}` : `h:${r.result_hash}`}`; // per root job; result_hash fallback
      const seen = this.dedupKeys.get(k);
      if (seen !== undefined) {
        attacker.completed--; // duplicates don't count toward completed
        f.unpaid = true;
        this.log(actor, 'duplicate', `finding ${f.id} duplicates finding ${seen} in job tree ${root}: valid but unpaid`, jobId);
        return;
      }
      this.dedupKeys.set(k, f.id);
    }
    const payout = BigInt(job.payout_per_finding);
    if (BigInt(job.remaining) < payout) {
      f.unpaid = true;
      this.log(actor, 'unpaid', `finding ${f.id} valid but job ${job.id} remaining ${job.remaining} < ${payout}`, job.id);
      this.close(job, actor);
      return;
    }
    job.remaining = (BigInt(job.remaining) - payout).toString();
    this.bal(f.attacker).usdc += payout;
    f.paid_attacker = payout.toString();
    if (job.depth === 1) {
      const parent = this.jobs[job.parent_id!];
      const margin = BigInt(parent.reward_per_finding) - BigInt(job.reward_per_finding);
      if (margin > 0n) {
        if (BigInt(parent.remaining) >= margin) {
          parent.remaining = (BigInt(parent.remaining) - margin).toString();
          this.bal(job.client).usdc += margin;
          f.paid_lead = margin.toString();
        } else {
          this.log(actor, 'lead_margin_unpaid', `finding ${f.id}: parent ${parent.id} remaining ${parent.remaining} < margin ${margin}`, parent.id);
        }
      }
    }
    if (BigInt(job.remaining) < payout) this.close(job, actor);
  }
}

class MockRedteam implements RedteamContract {
  readonly mock = true;
  readonly contractId: string;
  constructor(private readonly chain: MockChain, readonly accountId: string) {
    this.contractId = chain.contractId;
  }

  /** Checks run before writes in every method, so a panic leaves state untouched (like a reverted receipt). */
  private async tx<T>(fn: () => T): Promise<TxOutcome<T>> {
    this.chain.block++;
    return { value: fn(), txHash: null, logs: [], mock: true };
  }

  private registered(role?: Agent['role']): Agent {
    const a = this.chain.agents.get(this.accountId) ?? panic('ERR_NOT_REGISTERED', this.accountId);
    this.chain.notBlocked(this.accountId);
    if (role && a.role !== role) panic('ERR_ROLE', `${this.accountId} is ${a.role}, needs ${role}`);
    return a;
  }

  registerAgent(role: Agent['role'], x25519Pubkey: string, meta: string) {
    return this.tx(() => {
      if (!/^[0-9a-f]{64}$/.test(x25519Pubkey)) panic('ERR_INPUT', 'x25519_pubkey must be 64 lowercase hex');
      if (isLowOrder(x25519Pubkey)) panic('ERR_BAD_KEY', 'zero/small-order x25519 pubkey');
      if (Buffer.byteLength(meta) > 512) panic('ERR_INPUT', 'meta > 512 bytes');
      const prev = this.chain.agents.get(this.accountId);
      if (prev && prev.role !== role) panic('ERR_ROLE', `role is fixed (${prev.role})`);
      if (prev && prev.x25519_pubkey !== x25519Pubkey) {
        // C2: reports in flight are sealed to the registered key → frozen while the agent is client/lead of an active job
        const busy = this.chain.jobs.some((j) => j.client === this.accountId && this.chain.now() <= j.deadline_ms);
        if (busy) panic('ERR_KEY_LOCKED', 'x25519 key is locked while you are client/lead of a job before its deadline');
      }
      if (prev) {
        prev.x25519_pubkey = x25519Pubkey;
        prev.meta = meta;
        return;
      }
      this.chain.agents.set(this.accountId, {
        account_id: this.accountId, role, x25519_pubkey: x25519Pubkey, meta, registered_ms: this.chain.now(),
        registered_block: this.chain.block, completed: 0, invalid: 0, failed: 0, strikes: [], blocked: false,
      });
    });
  }

  registerTarget(targetId: string, encTarget: string, categories: string[]) {
    return this.tx(() => {
      this.registered('client');
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(targetId)) panic('ERR_INPUT', 'target_id');
      if (Buffer.byteLength(encTarget) > 8192) panic('ERR_INPUT', 'enc_target > 8KB');
      for (const c of categories) if (!this.chain.policy.allowed_categories.includes(c)) panic('ERR_CATEGORY', c);
      const t = this.chain.targets.get(targetId);
      if (t && t.owner !== this.accountId) panic('ERR_NOT_TARGET_OWNER', `${targetId} taken`);
      if (t && this.chain.jobs.some((j) => j.target_id === targetId && this.chain.now() <= j.deadline_ms)) panic('ERR_TARGET_LOCKED', `${targetId} is locked until its jobs' deadlines`); // C1
      this.chain.rateLimit(this.accountId); // register_target + create_job + create_subjob share the hourly limit
      this.chain.targets.set(targetId, { target_id: targetId, owner: this.accountId, enc_target: encTarget, categories, created_ms: this.chain.now() });
    });
  }

  createJob(a: CreateJobArgs) {
    return this.tx(() => {
      const c = this.chain;
      this.registered('client');
      const t = c.targets.get(a.target_id) ?? panic('ERR_NOT_FOUND', `target ${a.target_id}`);
      if (t.owner !== this.accountId) panic('ERR_NOT_TARGET_OWNER', a.target_id);
      const budget = BigInt(a.budget);
      const reward = BigInt(a.reward_per_finding);
      if (budget <= 0n || budget > BigInt(c.policy.max_budget)) panic('ERR_BUDGET_CAP', `budget ${budget} not in (0, ${c.policy.max_budget}]`);
      if (reward <= 0n || reward > budget) panic('ERR_REWARD', 'reward must be in (0, budget]');
      for (const cat of a.categories) {
        if (!c.policy.allowed_categories.includes(cat) || !t.categories.includes(cat)) panic('ERR_CATEGORY', cat);
      }
      const d = a.deadline_ms - c.now();
      if (d < c.policy.min_deadline_ms || d > c.policy.max_deadline_ms) panic('ERR_DEADLINE', `deadline must be ${c.policy.min_deadline_ms}..${c.policy.max_deadline_ms} ms ahead`);
      const b = c.bal(this.accountId);
      if (b.usdc < budget) panic('ERR_BALANCE', `have ${b.usdc}, need ${budget}`);
      c.rateLimit(this.accountId);
      b.usdc -= budget;
      const id = c.jobs.length;
      c.jobs.push({
        id, parent_id: null, depth: 0, client: this.accountId, root_client: this.accountId, provider: null,
        target_id: a.target_id, budget: a.budget, remaining: a.budget, reward_per_finding: a.reward_per_finding,
        payout_per_finding: a.reward_per_finding, categories: a.categories, deadline_ms: a.deadline_ms, status: 'Open',
        restricted: false, can_subcontract: true, children: [], findings: [], pending: 0, created_ms: c.now(),
      });
      return id;
    });
  }

  placeBid(jobId: number, price: string, note: string) {
    return this.tx(() => {
      const c = this.chain;
      this.registered('provider');
      const job = c.job(jobId);
      if (job.status !== 'Open') panic('ERR_STATUS', `job ${jobId} is ${job.status}`);
      if (job.client === this.accountId || job.root_client === this.accountId) panic('ERR_SELF_DEAL', 'cannot bid on own job');
      if (Buffer.byteLength(note) > 256) panic('ERR_INPUT', 'note too long (max 256 bytes)');
      if (BigInt(price) <= 0n) panic('ERR_INPUT', 'price must be > 0');
      const bids = c.bids.get(jobId) ?? [];
      const existing = bids.find((b) => b.bidder === this.accountId);
      if (existing) {
        if (existing.status === 'Accepted' || existing.status === 'Rejected') panic('ERR_BID', 'bid closed');
        existing.price_per_finding = price;
        existing.note = note;
        existing.status = 'Open';
      } else {
        if (bids.length >= 20) panic('ERR_BID', '> 20 bids');
        bids.push({ bidder: this.accountId, price_per_finding: price, note, counter_price: null, status: 'Open', created_ms: c.now() });
      }
      c.bids.set(jobId, bids);
    });
  }

  counterBid(jobId: number, bidder: string, price: string) {
    return this.tx(() => {
      const c = this.chain;
      const job = c.job(jobId);
      if (job.client !== this.accountId) panic('ERR_NOT_CLIENT', `${this.accountId} is not client of job ${jobId}`);
      if (job.status !== 'Open') panic('ERR_STATUS', `job ${jobId} is ${job.status}`);
      const bid = (c.bids.get(jobId) ?? []).find((b) => b.bidder === bidder) ?? panic('ERR_NOT_FOUND', `bid by ${bidder}`);
      if (bid.counter_price !== null) panic('ERR_BID', 'countered twice');
      if (bid.status !== 'Open') panic('ERR_BID', 'bid closed');
      bid.counter_price = price;
      bid.status = 'Countered';
    });
  }

  acceptBid(jobId: number, bidder: string) {
    return this.tx(() => {
      const c = this.chain;
      const job = c.job(jobId);
      if (job.client !== this.accountId) panic('ERR_NOT_CLIENT', `${this.accountId} is not client of job ${jobId}`);
      if (job.status !== 'Open') panic('ERR_STATUS', `job ${jobId} is ${job.status}`);
      const bid = (c.bids.get(jobId) ?? []).find((b) => b.bidder === bidder) ?? panic('ERR_NOT_FOUND', `bid by ${bidder}`);
      if (bid.status !== 'Open') panic('ERR_BID', `bid is ${bid.status}`);
      const price = BigInt(bid.price_per_finding);
      if (price > BigInt(job.reward_per_finding)) panic('ERR_REWARD', `bid ${price} > job reward ${job.reward_per_finding}`);
      const v = c.checkCounterparty(bidder);
      if (v.level === 'Block') panic('ERR_COUNTERPARTY_BLOCK', `${bidder}: ${v.reasons.join('; ')}`);
      job.reward_per_finding = price.toString();
      job.payout_per_finding = price.toString();
      if (v.level === 'Warn') {
        job.payout_per_finding = ((price * BigInt(c.policy.warn_reward_cap_bps)) / 10_000n).toString();
        job.restricted = true;
        job.can_subcontract = false;
      }
      job.provider = bidder;
      job.status = 'Assigned';
      bid.status = 'Accepted';
      for (const other of c.bids.get(jobId) ?? []) if (other !== bid) other.status = 'Rejected';
      c.log(this.accountId, 'accept_bid', v.level === 'Warn' ? `assigned to ${bidder} RESTRICTED (auto-escalation): payout ${job.payout_per_finding}/finding (cap ${c.policy.warn_reward_cap_bps / 100}%), no subcontracting, dual evaluation` : `assigned to ${bidder} @ ${price}/finding`, jobId, v);
    });
  }

  createSubjob(a: CreateSubjobArgs) {
    return this.tx(() => {
      const c = this.chain;
      const parent = c.job(a.parent_id);
      // order per contracts/VIEWS.md
      if (parent.provider !== this.accountId) panic('ERR_NOT_PROVIDER', `${this.accountId} is not provider of job ${a.parent_id}`);
      if (parent.status !== 'Assigned') panic('ERR_STATUS', `parent is ${parent.status}`);
      if (parent.depth >= c.policy.max_depth) panic('ERR_DEPTH', `job ${a.parent_id} is depth ${parent.depth}; max_depth ${c.policy.max_depth}`);
      const v = c.checkCounterparty(this.accountId);
      if (v.level === 'Block') panic('ERR_COUNTERPARTY_BLOCK', v.reasons.join('; '));
      if (!parent.can_subcontract || v.level !== 'Allow') panic('ERR_NO_SUBCONTRACT', `${this.accountId} may not subcontract job ${a.parent_id}${parent.restricted ? ' (restricted)' : ''}`);
      if (parent.children.length >= c.policy.max_children) panic('ERR_MAX_CHILDREN', `job ${a.parent_id} already has ${parent.children.length} subjobs`);
      const budget = BigInt(a.budget);
      const reward = BigInt(a.reward_per_finding);
      if (budget <= 0n || budget > BigInt(parent.remaining)) panic('ERR_BUDGET_CAP', `subjob budget ${budget} > parent remaining ${parent.remaining}`);
      if (reward <= 0n || reward > budget) panic('ERR_REWARD', 'reward must be in (0, budget]');
      if (reward > BigInt(parent.reward_per_finding)) panic('ERR_REWARD', `subjob reward ${reward} > parent reward ${parent.reward_per_finding}`);
      for (const cat of a.categories) if (!parent.categories.includes(cat)) panic('ERR_CATEGORY', `${cat} not in parent categories`);
      if (a.deadline_ms <= c.now() || a.deadline_ms > parent.deadline_ms) panic('ERR_DEADLINE', 'subjob deadline must be in (now, parent.deadline]');
      c.rateLimit(this.accountId);
      parent.remaining = (BigInt(parent.remaining) - budget).toString();
      const id = c.jobs.length;
      c.jobs.push({
        id, parent_id: parent.id, depth: parent.depth + 1, client: this.accountId, root_client: parent.root_client, provider: null,
        target_id: parent.target_id, budget: a.budget, remaining: a.budget, reward_per_finding: a.reward_per_finding,
        payout_per_finding: a.reward_per_finding, categories: a.categories, deadline_ms: a.deadline_ms, status: 'Open',
        restricted: false, can_subcontract: false, children: [], findings: [], pending: 0, created_ms: c.now(),
      });
      parent.children.push(id);
      c.log(this.accountId, 'create_subjob', `carved ${budget} from job ${parent.id} (lead margin ${BigInt(parent.reward_per_finding) - reward}/finding)`, id, v);
      return id;
    });
  }

  submitFinding(jobId: number, encPayload: string, category?: string) {
    return this.tx(() => {
      const c = this.chain;
      const job = c.job(jobId);
      if (job.provider !== this.accountId) panic('ERR_NOT_PROVIDER', `${this.accountId} is not provider of job ${jobId}`);
      c.notBlocked(this.accountId);
      if (job.status !== 'Assigned') panic('ERR_STATUS', `job ${jobId} is ${job.status}`);
      if (c.now() > job.deadline_ms) panic('ERR_DEADLINE', 'job deadline passed');
      if (!encPayload || encPayload.length > 8192) panic('ERR_INPUT', 'enc_payload size');
      if (category !== undefined && !job.categories.includes(category)) panic('ERR_CATEGORY', `${category} not in job categories`);
      if (job.findings.length >= c.policy.max_findings_per_job) panic('ERR_FINDINGS_CAP', `max ${c.policy.max_findings_per_job} findings`);
      const fee = BigInt(c.policy.outlayer_fee);
      const b = c.bal(this.accountId);
      if (b.compute < fee) panic('ERR_COMPUTE', `compute ${b.compute} < fee ${fee}`);
      b.compute -= fee;
      const cat = category ?? job.categories.join(',');
      const f: Finding = {
        id: c.findings.length, job_id: jobId, attacker: this.accountId, status: 'Pending', severity: null,
        manipulation: false, unpaid: false, paid_attacker: '0', paid_lead: '0', report_for_client: null,
        report_for_lead: null, result_hash: null, error: null, created_ms: c.now(), evaluated_ms: null, category: cat, dedup_key: null,
      };
      c.findings.push(f);
      job.findings.push(f.id);
      job.pending++;
      c.scheduleEvaluation(job, f, encPayload, cat);
      return f.id;
    });
  }

  expireJob(jobId: number) {
    return this.tx(() => {
      const c = this.chain;
      const job = c.job(jobId);
      if (!ACTIVE(job)) panic('ERR_STATUS', `job ${jobId} is ${job.status}`);
      if (c.now() <= job.deadline_ms) panic('ERR_DEADLINE', 'deadline not yet passed');
      const tree = [...job.children.map((id) => c.jobs[id]).filter(ACTIVE), job];
      for (const j of tree) {
        for (const fid of j.findings) {
          const f = c.findings[fid];
          if (f.status === 'Pending' && c.now() - f.created_ms < c.policy.pending_timeout_ms) panic('ERR_PENDING', `finding ${fid} still evaluating`);
        }
      }
      for (const j of tree) {
        for (const fid of j.findings) {
          const f = c.findings[fid];
          if (f.status !== 'Pending') continue;
          f.status = 'Failed';
          f.error = 'pending_timeout';
          j.pending = Math.max(0, j.pending - 1);
          c.log(this.accountId, 'force_fail', `finding ${fid} pending > ${c.policy.pending_timeout_ms} ms`, j.id);
        }
        j.status = 'Expired';
        c.log(this.accountId, 'expire', `job ${j.id} expired`, j.id);
        c.rollUp(j, this.accountId);
      }
    });
  }

  withdrawCompute(amount: string) {
    return this.tx(() => {
      const b = this.chain.bal(this.accountId);
      const a = BigInt(amount);
      if (a <= 0n) panic('ERR_INPUT', 'zero amount');
      if (b.compute < a) panic('ERR_COMPUTE', `have ${b.compute}, withdraw ${a}`);
      b.compute -= a;
      return true;
    });
  }

  withdraw(amount: string) {
    return this.tx(() => {
      const b = this.chain.bal(this.accountId);
      const a = BigInt(amount);
      if (a <= 0n) panic('ERR_INPUT', 'zero amount');
      if (b.usdc < a) panic('ERR_BALANCE', `have ${b.usdc}, withdraw ${a}`);
      b.usdc -= a;
      this.chain.wallets.set(this.accountId, (this.chain.wallets.get(this.accountId) ?? 0n) + a); // ft_transfer to the caller only
      return true;
    });
  }

  // ---- views ----
  async getJob(id: number) { return structuredClone(this.chain.jobs[id] ?? null); }
  async listJobs(from = 0, limit = 50) { return structuredClone(this.chain.jobs.slice(from, from + Math.min(limit, 200))); }
  async getFindings(jobId: number) {
    const j = this.chain.jobs[jobId];
    return j ? structuredClone(j.findings.map((f) => this.chain.findings[f])) : [];
  }
  async getFinding(id: number) { return structuredClone(this.chain.findings[id] ?? null); }
  async getBids(jobId: number) { return structuredClone(this.chain.bids.get(jobId) ?? []); }
  async getAgent(id: string) { return structuredClone(this.chain.agents.get(id) ?? null); }
  async listAgents(from = 0, limit = 50) { return structuredClone([...this.chain.agents.values()].slice(from, from + Math.min(limit, 200))); }
  async getTarget(id: string) { return structuredClone(this.chain.targets.get(id) ?? null); }
  async checkCounterparty(id: string) { return this.chain.checkCounterparty(id); }
  async balanceOf(id: string): Promise<Balance> {
    const b = this.chain.bal(id);
    return { usdc: b.usdc.toString(), compute: b.compute.toString() };
  }
  async getConfig(): Promise<ContractConfig> {
    return {
      owner: this.chain.owner, token_id: config.tusdcContract, outlayer_id: 'outlayer.testnet',
      enclave_code: { mock: true }, enclave_pubkey: this.chain.enclave.pubkeyHex, policy: structuredClone(this.chain.policy),
    };
  }
  async getPolicyLog(from = 0, limit = 100) { return structuredClone(this.chain.policyLog.slice(from, from + Math.min(limit, 200))); }

  /**
   * Emulates nearcore access-key validation for a function-call key (order: single FunctionCall action →
   * deposit == 0 → receiver → method list). These rejections happen before inclusion (no tx hash).
   */
  async rawCall(c: RawCall): Promise<TxOutcome<unknown>> {
    if (c.action) {
      throw new ChainError(`InvalidTxError: InvalidAccessKeyError: RequiresFullAccess (${c.action} action needs a full-access key)`, 'RequiresFullAccess', 'rpc');
    }
    if ((c.depositYocto ?? 0n) > 0n) {
      throw new ChainError('InvalidTxError: InvalidAccessKeyError: DepositWithFunctionCall', 'DepositWithFunctionCall', 'rpc');
    }
    if (c.receiverId !== this.contractId) {
      throw new ChainError(`InvalidTxError: InvalidAccessKeyError: ReceiverMismatch { tx_receiver: "${c.receiverId}", ak_receiver: "${this.contractId}" }`, 'ReceiverMismatch', 'rpc');
    }
    if (!FC_METHODS.includes(c.method)) {
      throw new ChainError(`InvalidTxError: InvalidAccessKeyError: MethodNameMismatch { method_name: "${c.method}" }`, 'MethodNameMismatch', 'rpc');
    }
    const a = c.args as Record<string, never>;
    if (c.method === 'withdraw') return this.withdraw(a.amount); // extra args like receiver_id are ignored: payout goes to the signer
    if (c.method === 'accept_bid') return this.acceptBid(a.job_id, a.bidder);
    throw new ChainError(`ERR_INPUT: mock rawCall does not route ${c.method}`, 'ERR_INPUT', 'execution');
  }
}
