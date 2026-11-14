// One consistent read of the redteam contract. The same loader runs against the live RPC
// (pinned to one final block height) and the in-browser mock (demo mode).
import type { Agent, AttackReceipt, Balance, Bid, Config, Counts, Finding, Job, PolicyLogEntry, Solvency, Verdict } from './types';

export type ViewFn = <T>(method: string, args?: Record<string, unknown>) => Promise<T>;

export interface AgentRow extends Agent {
  verdict: Verdict;
  balance: Balance;
}

export interface ReceiptRow extends AttackReceipt {
  /** live re-check of tx_hash via RPC; undefined = not checked (demo, or no hash) */
  onchain?: { ok: boolean; error: string | null } | { failed: string };
}

export interface Snapshot {
  height: number | null;
  timeMs: number;
  config: Config;
  counts: Counts;
  jobs: Job[];
  findings: Finding[];
  bids: Record<number, Bid[]>;
  agents: AgentRow[];
  policyLog: PolicyLogEntry[];
  receipts: ReceiptRow[];
  /** get_solvency (final contract); null when the deployment has no such view */
  solvency: Solvency | null;
  /** jobs whose findings/bids are not loaded yet (live mode fills history in over several polls) */
  missingHistory?: number;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function paged<T>(view: ViewFn, method: string, total: number, page = 200): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < Math.max(total, 1); from += page) {
    const chunk = await view<T[]>(method, { from, limit: page });
    out.push(...chunk);
    if (chunk.length < page) break;
  }
  return out;
}

/** Cache across polls: per-job findings/bids are refetched only when the job changed or has pending evaluations. */
export interface LoadCache {
  jobKey: Map<number, string>;
  findings: Map<number, Finding[]>;
  bids: Map<number, Bid[]>;
  /** incremental state across polls (live mode): the policy log is append-only, config/agents change rarely */
  config?: Config;
  policyLog: PolicyLogEntry[];
  agents?: Agent[];
  agentDetails: Map<string, { verdict: Verdict; balance: Balance }>;
  tick: number;
}
export const newCache = (): LoadCache => ({ jobKey: new Map(), findings: new Map(), bids: new Map(), policyLog: [], agentDetails: new Map(), tick: 0 });

export interface LoadOptions {
  /** don't fetch per-job details / per-agent verdicts for these (e.g. hidden e2e run accounts) */
  skipAccount?: (accountId: string) => boolean;
  /** refresh agents' verdict/balance only every Nth call (default every call) */
  agentEvery?: number;
  /** at most this many not-yet-cached FINISHED jobs get their findings/bids fetched per call (active jobs always do);
   *  lets the first render happen quickly and history fill in over the next polls */
  historyBudget?: number;
}

export const isFinished = (j: Job) => (j.status === 'Expired' || j.status === 'Closed') && j.pending === 0;

export async function loadSnapshot(view: ViewFn, meta: { height: number | null; timeMs: number }, cache = newCache(), concurrency = 4, opts: LoadOptions = {}): Promise<Omit<Snapshot, 'receipts'>> {
  const skip = opts.skipAccount ?? (() => false);
  const tick = cache.tick++;
  const [config, counts, solvency] = await Promise.all([
    cache.config && tick % 20 !== 0 ? Promise.resolve(cache.config) : view<Config>('get_config'),
    view<Counts>('get_counts'),
    view<Solvency>('get_solvency').catch(() => null),
  ]);
  cache.config = config;
  const [jobs, agentsRaw, newLog] = await Promise.all([
    paged<Job>(view, 'list_jobs', counts.jobs),
    cache.agents && cache.agents.length === counts.agents && tick % 6 !== 0 ? Promise.resolve(cache.agents) : paged<Agent>(view, 'list_agents', counts.agents),
    // append-only: fetch only entries we haven't seen
    (async () => {
      const out: PolicyLogEntry[] = [];
      for (let from = cache.policyLog.length; from < counts.policy_log; from += 200) out.push(...(await view<PolicyLogEntry[]>('get_policy_log', { from, limit: 200 })));
      return out;
    })(),
  ]);
  cache.agents = agentsRaw;
  cache.policyLog = [...cache.policyLog, ...newLog];
  const policyLog = cache.policyLog;
  const visibleJobs = jobs.filter((j) => !skip(j.root_client));
  const visibleAgents = agentsRaw.filter((a) => !skip(a.account_id));
  let budget = opts.historyBudget ?? Infinity;
  const toFetch = visibleJobs.filter((j) => {
    const stale = cache.jobKey.get(j.id) !== JSON.stringify(j) || j.pending > 0 || !cache.findings.has(j.id);
    if (!stale) return false;
    if (!isFinished(j) || cache.findings.has(j.id)) return true; // active, or a known job that changed
    return budget-- > 0;
  });
  await pool(toFetch, concurrency, async (j) => {
    const key = JSON.stringify(j);
    const [f, b] = await Promise.all([j.findings.length ? view<Finding[]>('get_findings', { job_id: j.id }) : Promise.resolve([]), view<Bid[]>('get_bids', { job_id: j.id })]);
    cache.findings.set(j.id, f);
    cache.bids.set(j.id, b);
    cache.jobKey.set(j.id, key);
  });
  const refreshAgents = tick % (opts.agentEvery ?? 1) === 0;
  const agents = await pool(visibleAgents, concurrency, async (a) => {
    let d = cache.agentDetails.get(a.account_id);
    if (!d || refreshAgents) {
      const [verdict, balance] = await Promise.all([view<Verdict>('check_counterparty', { account_id: a.account_id }), view<Balance>('balance_of', { account_id: a.account_id })]);
      d = { verdict, balance };
      cache.agentDetails.set(a.account_id, d);
    }
    return { ...a, ...d };
  });
  const missingHistory = visibleJobs.filter((j) => !cache.findings.has(j.id)).length;
  return {
    missingHistory,
    height: meta.height,
    timeMs: meta.timeMs,
    config,
    counts,
    jobs: visibleJobs,
    findings: visibleJobs.flatMap((j) => cache.findings.get(j.id) ?? []).sort((a, b) => a.id - b.id),
    bids: Object.fromEntries(visibleJobs.map((j) => [j.id, cache.bids.get(j.id) ?? []])),
    agents,
    policyLog,
    solvency,
  };
}

// ------------------------------------------------------------ derived views

export const big = (v: string | number | bigint | null | undefined) => BigInt(v ?? 0);

export interface TreeLedger {
  root: Job;
  jobs: Job[];
  subRewards: bigint; // paid_attacker in subjobs
  leadMargins: bigint; // paid_lead
  providerRewards: bigint; // paid_attacker in the root job
  remaining: bigint; // Σ remaining across the tree (still in escrow)
  refunded: bigint; // derived: budget − paid − remaining (only once expired/closed)
  balanced: boolean;
  lines: { finding: Finding; job: Job; attacker: string; attackerPaid: bigint; lead: string | null; leadPaid: bigint }[];
}

export function ledger(jobs: Job[], findings: Finding[]): TreeLedger[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const roots = jobs.filter((j) => j.parent_id === null || j.parent_id === undefined);
  return roots.map((root) => {
    const tree = [root, ...root.children.map((c) => byId.get(c)).filter((x): x is Job => !!x)];
    const ids = new Set(tree.map((j) => j.id));
    const fs = findings.filter((f) => ids.has(f.job_id));
    const lines = fs
      .filter((f) => f.status === 'Valid')
      .map((f) => {
        const j = byId.get(f.job_id)!;
        return { finding: f, job: j, attacker: f.attacker, attackerPaid: big(f.paid_attacker), lead: j.depth > 0 ? j.client : null, leadPaid: big(f.paid_lead) };
      });
    const subRewards = fs.filter((f) => byId.get(f.job_id)!.depth > 0).reduce((x, f) => x + big(f.paid_attacker), 0n);
    const providerRewards = fs.filter((f) => f.job_id === root.id).reduce((x, f) => x + big(f.paid_attacker), 0n);
    const leadMargins = fs.reduce((x, f) => x + big(f.paid_lead), 0n);
    const remaining = tree.reduce((x, j) => x + big(j.remaining), 0n);
    const paid = subRewards + providerRewards + leadMargins;
    const refunded = big(root.budget) - paid - remaining;
    return { root, jobs: tree, subRewards, leadMargins, providerRewards, remaining, refunded, balanced: refunded >= 0n && (refunded === 0n || root.status === 'Expired' || root.status === 'Closed' || tree.some((j) => j.status === 'Expired' || j.status === 'Closed')), lines };
  });
}

export const isE2eAccount = (id: string | null | undefined) => !!id && /^e[a-z0-9]{6}-[a-z0-9]+\./.test(id);
