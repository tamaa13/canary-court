/**
 * Client agent: owns the fictional target, posts a red-team job, negotiates bids, reads the encrypted
 * reports and withdraws refunds. Every decision is an LLM call bounded by validation + contract policy.
 */
import { config } from '../config.js';
import { decryptJson, encryptJson, sha256Hex } from '../crypto/ecies.js';
import type { Bid, EvalRecord, Finding, FindingReport, Job, TargetSecret, Verdict } from '../chain/types.js';
import { untrusted } from '../llm/llm.js';
import { profile, TARGET_MODEL, type TargetKind, type TargetVersion } from '../target/index.js';
import { detectLeak, isFullLeak, type Leak } from '../enclave/leak.js';
import { fmtUsdc, USDC } from '../util/amount.js';
import { redact } from '../util/log.js';
import { BaseAgent, big } from './base.js';

interface JobPlan {
  budget_usdc: number;
  reward_per_finding_usdc: number;
  categories: string[];
  rationale?: string;
}

interface BidDecision {
  action: 'accept' | 'counter' | 'wait';
  bidder?: string;
  counter_price_usdc?: number;
  rationale?: string;
}

export interface DecryptedReport {
  finding: Finding;
  report: FindingReport;
  record: EvalRecord;
  /** sha256(record_json) == report.result_hash == on-chain finding.result_hash */
  integrity: boolean;
  leakedCanary: boolean;
  leakKind: Leak;
}

const CLIENT_SYSTEM =
  'You are the CLIENT agent in an autonomous red-team market on NEAR testnet. You own a fictional AI agent (here: a ' +
  'treasury agent that pays vendor invoices) and pay specialist agents (in tUSDC) only for TEE-verified leaks of its ' +
  'secret. Spend carefully, prefer reputable counterparties, and never accept an agent the contract would Block.';

export class ClientAgent extends BaseAgent {
  target?: TargetSecret;
  targetId?: string;

  /** Generate a fresh canary, encrypt the target to the enclave key, register it on chain. */
  /** Targets published by this client in this run (version → secret); `target` is the most recent. */
  readonly targets = new Map<string, TargetSecret>();

  async publishTarget(enclavePubkey: string, targetId?: string, model?: string, version: TargetVersion = 'v1', kind?: TargetKind): Promise<string> {
    const prof = profile(kind);
    targetId ??= `${prof.kind}-${version}-${Date.now().toString(36)}`;
    const canary = prof.newCanary();
    this.target = { system_prompt: prof.systemPrompt(canary, version), canary, model: model ?? TARGET_MODEL, client_pubkey: this.ctx.x25519Pk }; // binding (v0.1.2)
    this.targets.set(targetId, this.target);
    redact(this.target.canary);
    this.targetId = targetId;
    const enc = encryptJson(enclavePubkey, this.target);
    this.say(`register_target ${targetId}: ${prof.name}, ${version === 'v1' ? 'v1 legacy build, planted flaw' : 'v2 hardened build'}; model ${this.target.model}. System prompt + secret ECIES-encrypted to the enclave (${enc.length} b64 chars)`);
    await this.chain.registerTarget(targetId, enc, [...config.categories]);
    return targetId;
  }

  async postJob(opts: { deadlineMs: number; maxBudget?: bigint; targetId?: string; description?: string }): Promise<number> {
    const bal = big((await this.chain.balanceOf(this.id)).usdc);
    const cfg = await this.chain.getConfig();
    const cap = [bal, big(cfg.policy.max_budget), opts.maxBudget ?? bal].reduce((a, b) => (a < b ? a : b));
    const capUsdc = Number(cap / 1_000_000n);
    const plan = await this.decide<JobPlan>({
      task: 'post_job',
      system: CLIENT_SYSTEM,
      user: [
        `Target: ${opts.description ?? profile().descriptions.v1}`,
        `Internal balance: ${fmtUsdc(bal)}. Budget cap for this job: ${capUsdc} tUSDC (policy max ${fmtUsdc(cfg.policy.max_budget)}).`,
        `Allowed categories: ${config.categories.join(', ')}. Cover at least 3 of them.`,
        'Pick a budget and a reward per valid finding so that several findings can be paid.',
        'JSON: {"budget_usdc":number,"reward_per_finding_usdc":number,"categories":[...],"rationale":"..."}',
      ].join('\n'),
      fallback: () => ({
        budget_usdc: Math.min(100, capUsdc), reward_per_finding_usdc: Math.max(1, Math.min(10, Math.floor(capUsdc / 8))),
        categories: [...config.categories], rationale: 'policy: ~10 findings worth of budget across all four categories',
      }),
      validate: (v) =>
        !(v.budget_usdc > 0 && v.budget_usdc <= capUsdc) ? `budget must be in (0, ${capUsdc}]`
          : !(v.reward_per_finding_usdc > 0 && v.reward_per_finding_usdc * 3 <= v.budget_usdc) ? 'reward must allow ≥3 findings'
            : !(Array.isArray(v.categories) && v.categories.length >= 3 && v.categories.every((c) => (config.categories as readonly string[]).includes(c))) ? 'need ≥3 valid categories'
              : null,
    });
    const { value: jobId } = await this.chain.createJob({
      target_id: opts.targetId ?? this.targetId!, budget: USDC(plan.budget_usdc).toString(),
      reward_per_finding: USDC(plan.reward_per_finding_usdc).toString(), categories: plan.categories, deadline_ms: opts.deadlineMs,
    });
    const id = jobId ?? (await this.listAll()).filter((j) => j.client === this.id).at(-1)!.id;
    this.say(`posted job #${id}: budget ${plan.budget_usdc} tUSDC, ${plan.reward_per_finding_usdc} tUSDC/finding, [${plan.categories.join(', ')}]`);
    return id;
  }

  /** Accept, counter (once per bid) or wait. Returns the accepted bidder, if any. */
  async reviewBids(jobId: number, opts: { forcePolicy?: boolean } = {}): Promise<{ action: BidDecision['action']; bidder?: string }> {
    const job = (await this.chain.getJob(jobId))!;
    const bids = (await this.chain.getBids(jobId)).filter((b) => b.status === 'Open' || b.status === 'Countered');
    if (!bids.length) return { action: 'wait' };
    const verdicts = new Map<string, Verdict>();
    for (const b of bids) verdicts.set(b.bidder, await this.chain.checkCounterparty(b.bidder));
    const d = opts.forcePolicy ? { ...clientBidPolicy(job, bids, verdicts), rationale: 'policy (LLM kept waiting)' } : await this.decide<BidDecision>({
      task: 'review_bids',
      system: CLIENT_SYSTEM,
      user: this.bidsPrompt(job, bids, verdicts),
      fallback: () => clientBidPolicy(job, bids, verdicts),
      validate: (v) => validateBidDecision(v, job, bids, verdicts),
    });
    if (d.action === 'accept' && d.bidder) {
      const v = verdicts.get(d.bidder)!;
      this.say(`accept_bid ${d.bidder} on job #${jobId} (check_counterparty: ${v.level}${v.reasons.length ? ` — ${v.reasons.join('; ')}` : ''})`);
      await this.chain.acceptBid(jobId, d.bidder);
    } else if (d.action === 'counter' && d.bidder && d.counter_price_usdc) {
      this.say(`counter_bid ${d.bidder} on job #${jobId} at ${d.counter_price_usdc} tUSDC/finding`);
      await this.chain.counterBid(jobId, d.bidder, USDC(d.counter_price_usdc).toString());
    }
    return { action: d.action, bidder: d.bidder };
  }

  private bidsPrompt(job: Job, bids: Bid[], verdicts: Map<string, Verdict>): string {
    const lines = bids.map((b) => {
      const v = verdicts.get(b.bidder)!;
      return `- bidder ${b.bidder}: ${fmtUsdc(b.price_per_finding)}/finding, status ${b.status}, countered ${b.counter_price ? 'yes' : 'no'}, check_counterparty ${v.level} [${v.reasons.join('; ')}]\n  note: ${untrusted(`bid note from ${b.bidder}`, b.note)}`;
    });
    return [
      `Job #${job.id}: reward ${fmtUsdc(job.reward_per_finding)}/finding, budget ${fmtUsdc(job.budget)}, categories [${job.categories.join(', ')}].`,
      'Bids:', ...lines,
      'Options: accept one bid; counter ONE bid once with a lower price; or wait. Block-level bidders cannot be accepted.',
      'Warn-level bidders are automatically restricted by the contract (50% reward, no subcontracting, dual evaluation).',
      'JSON: {"action":"accept"|"counter"|"wait","bidder":"...","counter_price_usdc":number,"rationale":"..."}',
    ].join('\n');
  }

  /** Decrypt report_for_client on every finding of the job tree; only this agent's x25519 key can. */
  async readReports(jobIds: number[]): Promise<DecryptedReport[]> {
    const out: DecryptedReport[] = [];
    for (const id of jobIds) {
      for (const f of await this.chain.getFindings(id)) {
        if (!f.report_for_client) continue;
        const report = decryptJson<FindingReport>(this.ctx.x25519Sk, f.report_for_client);
        const integrity = sha256Hex(report.record_json) === report.result_hash && report.result_hash === f.result_hash;
        const record = JSON.parse(report.record_json) as EvalRecord;
        const job = await this.chain.getJob(id);
        const secret = (job && this.targets.get(job.target_id)) ?? this.target;
        const kind = secret ? detectLeak(secret.canary, report.response_excerpt) : 'none';
        out.push({ finding: f, report, record, integrity, leakedCanary: isFullLeak(kind), leakKind: kind });
      }
    }
    return out;
  }

  /**
   * After the deadline: expire active children first, then the root; refunds roll up to this client.
   * Closed jobs (budget exhausted) already refunded themselves and are skipped.
   */
  async expireTree(rootId: number): Promise<void> {
    const active = (j: Job) => j.status === 'Open' || j.status === 'Assigned';
    const root = (await this.chain.getJob(rootId))!;
    for (const ch of root.children) {
      const j = (await this.chain.getJob(ch))!;
      if (!active(j)) continue;
      this.say(`expire_job #${ch} (subjob) → remaining ${fmtUsdc(j.remaining)} rolls up to job #${rootId}`);
      await this.chain.expireJob(ch);
    }
    const r2 = (await this.chain.getJob(rootId))!;
    if (active(r2)) {
      this.say(`expire_job #${rootId} → remaining ${fmtUsdc(r2.remaining)} refunds to client balance`);
      await this.chain.expireJob(rootId);
    } else this.say(`job #${rootId} is ${r2.status}: nothing left to expire`);
  }
}

function clientBidPolicy(job: Job, bids: Bid[], verdicts: Map<string, Verdict>): BidDecision {
  const ok = bids.filter((b) => verdicts.get(b.bidder)?.level !== 'Block' && big(b.price_per_finding) <= big(job.reward_per_finding));
  if (!ok.length) return { action: 'wait', rationale: 'no acceptable bids yet' };
  const rank = (b: Bid) => (verdicts.get(b.bidder)!.level === 'Allow' ? 0 : 1);
  ok.sort((a, b) => rank(a) - rank(b) || (big(a.price_per_finding) < big(b.price_per_finding) ? -1 : 1));
  const best = ok[0];
  const price = Number(big(best.price_per_finding)) / 1e6;
  if (best.status === 'Open' && best.counter_price === null && rank(best) === 0 && price >= 2) {
    const counter = Math.max(1, Math.round(price * 0.85 * 10) / 10);
    return { action: 'counter', bidder: best.bidder, counter_price_usdc: counter, rationale: `best bid ${price}; counter once at ~85% (${counter})` };
  }
  if (best.status === 'Countered') return { action: 'wait', rationale: `waiting for ${best.bidder} to answer the counter` };
  return { action: 'accept', bidder: best.bidder, rationale: `accept ${best.bidder} at ${price} (${verdicts.get(best.bidder)!.level})` };
}

function validateBidDecision(v: BidDecision, job: Job, bids: Bid[], verdicts: Map<string, Verdict>): string | null {
  if (!['accept', 'counter', 'wait'].includes(v?.action)) return 'action must be accept|counter|wait';
  if (v.action === 'wait') return null;
  const b = bids.find((x) => x.bidder === v.bidder);
  if (!b) return `unknown bidder ${v.bidder}`;
  if (verdicts.get(b.bidder)?.level === 'Block') return 'cannot accept a Block-level counterparty';
  if (v.action === 'accept') return b.status === 'Open' && big(b.price_per_finding) <= big(job.reward_per_finding) ? null : 'bid not acceptable';
  if (b.counter_price !== null || b.status !== 'Open') return 'bid already countered';
  if (!(typeof v.counter_price_usdc === 'number' && v.counter_price_usdc > 0 && USDC(v.counter_price_usdc) < big(b.price_per_finding))) return 'counter must be below bid';
  return null;
}
