// The market as a story: one plain-language event per thing that happened, derived from a snapshot (jobs, bids,
// findings, agents and the contract's policy log). Nothing here is invented: every event is a field the contract
// returned. Links: the policy log records a block height; for the recorded live runs (agents/fixtures) the exact
// transaction is known from the receipts, matched by method, job and signer.

import attackReceipts from "../../../../agents/fixtures/attack-receipts.json";
import demoReceipts from "../../../../agents/fixtures/demo-receipts.json";
import { targetInfo } from "./human";
import type { Tone } from "./status";
import { big, type Snapshot } from "./snapshot";
import type { Finding, Job, PolicyLogEntry } from "./types";

/** a token of an event's sentence: words, an account, a job, an amount */
export type Part = string | { acct: string } | { job: number } | { usdc: bigint | string } | { near: bigint | string } | { word: string; tone: Tone };

export type EventKind =
  | "joined"
  | "posted"
  | "subjob"
  | "bid"
  | "accepted"
  | "sealed"
  | "valid"
  | "invalid"
  | "failed"
  | "timeout"
  | "client_fault"
  | "strike"
  | "blocklist"
  | "expired"
  | "refund"
  | "closed"
  | "note";

export interface MarketEvent {
  id: string;
  ts: number;
  kind: EventKind;
  tone: Tone;
  parts: Part[];
  /** the job (and its root) this happened in, the finding, and every account involved */
  jobId?: number;
  rootId?: number;
  findingId?: number;
  accounts: string[];
  block?: number;
  tx?: string;
}

// ───────────────────────────────────────────── names

/** the targets, as people would say them (lib/market/human.ts: Tilly v1, a security test…) */
export function targetName(id: string, owner?: string): string {
  const i = targetInfo(id, owner);
  return i.test ? `a security test (${i.about})` : i.name;
}

export const shortAcct = (id: string) => id.replace(/\.arifnovrian\.testnet$/, "");

// ───────────────────────────────────────────── tx index from the recorded live runs

type Receipt = { signer: string; method: string; args_summary?: string; tx_hash?: string | null; ok?: boolean; error?: string | null; expected_error?: string | null };
const RECORDED: Receipt[] = [...((demoReceipts as { receipts?: Receipt[] }).receipts ?? []), ...(attackReceipts as Receipt[])];

/** method:firstArg:signer → tx hashes in the order they were sent (successful calls only) */
const TX = new Map<string, string[]>();
for (const r of RECORDED) {
  // (only calls that went through: in the attack receipts, ok means "the expected refusal happened")
  if (!r.tx_hash || r.ok === false || r.error || r.expected_error) continue;
  const args = r.args_summary ?? "";
  const first = /"(?:target_id|parent_id)":"?([^",}]+)"?/.exec(args)?.[1] ?? /^\w+\(\s*"?([^",){]+)"?/.exec(args)?.[1];
  if (!first) continue;
  const key = `${r.method}:${first}:${r.signer}`;
  TX.set(key, [...(TX.get(key) ?? []), r.tx_hash]);
}
const txOf = (method: string, first: string | number, signer: string, nth = 0, last = false) => {
  const list = TX.get(`${method}:${first}:${signer}`);
  return list ? (last ? list[list.length - 1] : list[nth]) : undefined;
};

// ───────────────────────────────────────────── derivation

const num = (s: string) => /(\d{4,})/.exec(s)?.[1];

export function deriveEvents(s: Snapshot, opts: { links: boolean }): MarketEvent[] {
  const out: MarketEvent[] = [];
  const jobs = new Map(s.jobs.map((j) => [j.id, j]));
  const rootOf = (j: Job | undefined) => (j && j.parent_id !== null && j.parent_id !== undefined ? (jobs.get(j.parent_id) ?? j) : j);
  const fee = s.config?.policy?.outlayer_fee ?? "0";
  const refund = s.config?.infra_refund ?? "0";
  const tx = (method: string, first: string | number, signer: string, nth = 0, last = false) => (opts.links ? txOf(method, first, signer, nth, last) : undefined);
  const byFinding = new Map<number, PolicyLogEntry[]>();
  for (const e of s.policyLog) {
    const f = /finding (\d+)/.exec(e.detail)?.[1];
    if (f) byFinding.set(Number(f), [...(byFinding.get(Number(f)) ?? []), e]);
  }
  const subjobLog = new Map(s.policyLog.filter((e) => e.action === "create_subjob" && e.job_id != null).map((e) => [e.job_id!, e]));
  const push = (e: Omit<MarketEvent, "rootId"> & { rootId?: number }) => {
    if (!e.ts) return;
    out.push({ ...e, rootId: e.rootId ?? rootOf(e.jobId != null ? jobs.get(e.jobId) : undefined)?.id });
  };

  for (const a of s.agents)
    push({ id: `joined:${a.account_id}`, ts: a.registered_ms, kind: "joined", tone: "muted", parts: [{ acct: a.account_id }, ` joined as ${a.role === "provider" ? "an attacker" : a.role}`], accounts: [a.account_id] });

  for (const j of s.jobs) {
    if (j.depth === 0 || j.parent_id == null) {
      // (which create_job: the n-th job this client posted against this target)
      const nth = s.jobs.filter((x) => x.client === j.client && x.target_id === j.target_id && x.depth === 0 && x.id < j.id).length;
      push({
        id: `posted:${j.id}`,
        ts: j.created_ms,
        kind: "posted",
        tone: "fg",
        jobId: j.id,
        parts: [{ acct: j.client }, " posted ", { job: j.id }, ` against ${targetName(j.target_id, j.client)}: `, { usdc: j.budget }, " tUSDC, ", { usdc: j.reward_per_finding }, " per leak"],
        accounts: [j.client],
        tx: tx("create_job", j.target_id, j.client, nth),
      });
    } else {
      const parent = jobs.get(j.parent_id);
      const log = subjobLog.get(j.id);
      const nth = (parent?.children ?? []).filter((c) => c < j.id).length;
      push({
        id: `subjob:${j.id}`,
        ts: j.created_ms,
        kind: "subjob",
        tone: "fg",
        jobId: j.id,
        parts: [
          { acct: j.client },
          " carved subjob ",
          { job: j.id },
          " out of ",
          { job: j.parent_id },
          ": ",
          { usdc: j.budget },
          " tUSDC, ",
          { usdc: j.reward_per_finding },
          " per leak",
          ...(parent ? [", a margin of ", { usdc: big(parent.reward_per_finding) - big(j.reward_per_finding) } as Part] : []),
        ],
        accounts: [j.client],
        block: log?.block_height,
        tx: tx("create_subjob", j.parent_id, j.client, nth),
      });
    }
    for (const b of s.bids[j.id] ?? []) {
      push({
        id: `bid:${j.id}:${b.bidder}`,
        ts: b.created_ms ?? j.created_ms + 1,
        kind: "bid",
        tone: "muted",
        jobId: j.id,
        parts: [
          { acct: b.bidder },
          " bid ",
          { usdc: b.price_per_finding },
          " per leak on ",
          { job: j.id },
          ...(b.counter_price ? [", and ", { acct: j.client } as Part, " countered at ", { usdc: b.counter_price } as Part] : []),
          ...(b.status === "Rejected" ? ["; not chosen"] : []),
        ],
        accounts: [b.bidder, j.client],
        tx: tx("place_bid", j.id, b.bidder, 0, true),
      });
    }
  }

  for (const f of s.findings) {
    const j = jobs.get(f.job_id);
    const nth = s.findings.filter((x) => x.job_id === f.job_id && x.attacker === f.attacker && x.id < f.id).length;
    push({
      id: `sealed:${f.id}`,
      ts: f.created_ms,
      kind: "sealed",
      tone: "fg",
      jobId: f.job_id,
      findingId: f.id,
      parts: [{ acct: f.attacker }, " sealed an attack on ", { job: f.job_id }, " for the TEE (", { near: fee }, " NEAR)"],
      accounts: [f.attacker],
      tx: tx("submit_finding", f.job_id, f.attacker, nth),
    });
    if (f.status === "Pending" || !f.evaluated_ms) continue;
    const logs = byFinding.get(f.id) ?? [];
    const timeout = logs.find((e) => e.action === "infra_timeout");
    const fault = logs.find((e) => e.action === "client_fault");
    const lead = j && j.depth > 0 ? j.client : null;
    const base = { ts: f.evaluated_ms, jobId: f.job_id, findingId: f.id };
    if (timeout)
      push({ ...base, id: `timeout:${f.id}`, kind: "timeout", tone: "muted", parts: ["OutLayer timed out on finding ", `#${f.id}`, "; ", { near: refund }, " NEAR went back to ", { acct: f.attacker }, ", no strike"], accounts: [f.attacker], block: timeout.block_height });
    else if (fault)
      push({ ...base, id: `fault:${f.id}`, kind: "client_fault", tone: "muted", parts: [{ acct: fault.actor }, `'s target was broken (${(f.error ?? "").replace(/^enclave:\s*/, "")}), so `, { acct: f.attacker }, "'s fee went back"], accounts: [f.attacker, fault.actor], block: fault.block_height });
    else if (f.status === "Valid" && !f.unpaid)
      push({
        ...base,
        id: `valid:${f.id}`,
        kind: "valid",
        tone: "accent",
        parts: ["TEE verdict: ", { word: "Valid", tone: "accent" }, ". The key leaked; ", { acct: f.attacker }, " +", { usdc: f.paid_attacker }, ...(lead && big(f.paid_lead) > 0n ? [", ", { acct: lead } as Part, " +", { usdc: f.paid_lead } as Part] : []), " tUSDC, report sealed for the owner"],
        accounts: [f.attacker, ...(lead ? [lead] : [])],
      });
    else if (f.status === "Valid")
      push({
        ...base,
        id: `valid:${f.id}`,
        kind: "valid",
        tone: "muted",
        parts: ["TEE verdict: ", { word: "Valid", tone: "accent" }, logs.some((e) => e.action === "duplicate") ? ", but it repeats a leak already paid, so it isn't paid" : ", but the job's budget ran out, so it isn't paid"],
        accounts: [f.attacker],
      });
    else if (f.status === "Invalid")
      push({
        ...base,
        id: `invalid:${f.id}`,
        kind: "invalid",
        tone: f.manipulation ? "bad" : "muted",
        parts: f.manipulation
          ? ["TEE verdict: ", { word: "Invalid", tone: "bad" }, ". ", { acct: f.attacker }, " tried to talk the grader into a verdict"]
          : ["TEE verdict: ", { word: "Invalid", tone: "muted" }, ". The key held against ", { acct: f.attacker }],
        accounts: [f.attacker],
      });
    else
      push({ ...base, id: `failed:${f.id}`, kind: "failed", tone: "bad", parts: ["Run ", { word: "failed", tone: "bad" }, ` for `, { acct: f.attacker }, ` (${f.error ?? "error"}); fee kept, no strike`], accounts: [f.attacker] });
  }

  // the end of a job, told once: its expiry and the refund it triggers are one event, and a tree whose subjobs expire
  // with it (within a minute) is one event too (the root's refund already holds what rolled up from them)
  const expires = new Map<number, PolicyLogEntry>();
  const refunds = new Map<number, PolicyLogEntry>();
  for (const e of s.policyLog) {
    if (e.job_id == null) continue;
    if (e.action === "expire") expires.set(e.job_id, e);
    if (e.action === "refund" && !refunds.has(e.job_id)) refunds.set(e.job_id, e);
  }
  const told = new Set<number>();
  const refundParts = (r: PolicyLogEntry | undefined): { parts: Part[]; to?: string } => {
    if (!r) return { parts: ["; nothing was left to refund"] };
    const amt = num(r.detail);
    const to = /refunded to root client (\S+)/.exec(r.detail)?.[1];
    const up = /rolled up to job (\d+)/.exec(r.detail)?.[1];
    const money: Part[] = amt ? [{ usdc: amt }, " tUSDC"] : ["the rest"];
    if (to) return { parts: ["; ", ...money, " went back to ", { acct: to }], to };
    if (up) return { parts: ["; ", ...money, " rolled up to ", { job: Number(up) }] };
    return { parts: [`; refund: ${r.detail}`] };
  };
  for (const [jobId, ex] of expires) {
    const j = jobs.get(jobId);
    const within = (e?: PolicyLogEntry) => !!e && Math.abs(e.ts_ms - ex.ts_ms) <= 60_000;
    if (j && j.parent_id != null && within(expires.get(j.parent_id))) continue; // (told with its tree)
    const kids = (j?.children ?? []).filter((c) => within(expires.get(c)));
    const r = refunds.get(jobId);
    for (const e of [ex, r, ...kids.flatMap((c) => [expires.get(c), refunds.get(c)])]) if (e) told.add(e.seq);
    const { parts, to } = refundParts(r);
    push({
      id: `ended:${jobId}`,
      ts: Math.max(ex.ts_ms, r?.ts_ms ?? 0),
      kind: "expired",
      tone: "muted",
      jobId,
      block: (r ?? ex).block_height,
      parts: kids.length ? [{ job: jobId }, ` and its ${kids.length} subjob${kids.length === 1 ? "" : "s"} expired`, ...parts] : [{ job: jobId }, " expired", ...parts],
      accounts: to ? [to] : [],
    });
  }

  for (const e of s.policyLog) {
    if (told.has(e.seq)) continue;
    const base = { ts: e.ts_ms, jobId: e.job_id ?? undefined, block: e.block_height };
    const j = e.job_id != null ? jobs.get(e.job_id) : undefined;
    switch (e.action) {
      case "accept_bid": {
        const warn = e.verdict?.level === "Warn";
        push({
          ...base,
          id: `accepted:${e.seq}`,
          kind: "accepted",
          tone: warn ? "accent" : "ok",
          parts: [{ acct: e.actor }, " hired ", ...(j?.provider ? [{ acct: j.provider } as Part] : ["a provider"]), " for ", { job: e.job_id! }, " (counterparty check: ", { word: e.verdict?.level ?? "Allow", tone: warn ? "accent" : "ok" }, warn ? "; restricted to half pay, no subcontracting, dual evaluation)" : ")"],
          accounts: [e.actor, ...(j?.provider ? [j.provider] : [])],
          tx: opts.links && j?.provider ? txOf("accept_bid", e.job_id!, e.actor) : undefined,
        });
        break;
      }
      case "strike":
        push({ ...base, id: `strike:${e.seq}`, kind: "strike", tone: "bad", parts: [{ acct: e.actor }, " got a strike: ", e.detail.replace(/\(evidence ([0-9a-f]{8})[0-9a-f]+\)/, "(evidence $1…)")], accounts: [e.actor] });
        break;
      case "blocklist":
        push({ ...base, id: `blocklist:${e.seq}`, kind: "blocklist", tone: "bad", parts: [{ acct: e.actor }, " is ", { word: "blocklisted", tone: "bad" }, " after 2 strikes"], accounts: [e.actor] });
        break;
      case "refund": {
        const amt = num(e.detail);
        const to = /refunded to root client (\S+)/.exec(e.detail)?.[1];
        const up = /rolled up to job (\d+)/.exec(e.detail)?.[1];
        push({
          ...base,
          id: `refund:${e.seq}`,
          kind: "refund",
          tone: "muted",
          parts: to
            ? [{ job: e.job_id! }, " closed out; ", ...(amt ? [{ usdc: amt } as Part, " tUSDC"] : ["the rest"]), " went back to ", { acct: to }]
            : up
              ? [{ job: e.job_id! }, " closed out; ", ...(amt ? [{ usdc: amt } as Part, " tUSDC"] : ["the rest"]), " rolled up to ", { job: Number(up) }]
              : [{ job: e.job_id! }, ` refund: ${e.detail}`],
          accounts: to ? [to] : [],
        });
        break;
      }
      case "close":
        push({ ...base, id: `closed:${e.seq}`, kind: "closed", tone: "muted", parts: [{ job: e.job_id! }, ` closed: ${e.detail}`], accounts: [] });
        break;
      case "lead_margin_unpaid":
      case "force_fail":
        push({ ...base, id: `note:${e.seq}`, kind: "note", tone: "muted", parts: [{ acct: e.actor }, `: ${e.detail}`], accounts: [e.actor] });
        break;
      default:
        break; // accept/subjob/verdict/refund lines above already tell create_subjob, duplicate, unpaid, infra_timeout, client_fault
    }
  }

  // newest first; same instant: the order things happen in (a verdict after its seal, a refund after its expiry)
  const order: Record<EventKind, number> = { joined: 0, posted: 1, bid: 2, accepted: 3, subjob: 4, sealed: 5, valid: 6, invalid: 6, failed: 6, timeout: 6, client_fault: 6, strike: 7, blocklist: 8, expired: 9, refund: 10, closed: 11, note: 12 };
  return out.sort((a, b) => b.ts - a.ts || order[b.kind] - order[a.kind]);
}

// ───────────────────────────────────────────── per-agent figures

export interface AgentStats {
  earned: bigint;
  asAttacker: bigint;
  asLead: bigint;
  valid: number;
  attacks: number;
  jobsPosted: number;
  spent: bigint;
}

export function agentStats(s: Snapshot, id: string): AgentStats {
  const jobs = new Map(s.jobs.map((j) => [j.id, j]));
  let asAttacker = 0n;
  let asLead = 0n;
  let valid = 0;
  let attacks = 0;
  for (const f of s.findings) {
    if (f.attacker === id) {
      attacks++;
      asAttacker += big(f.paid_attacker);
      if (f.status === "Valid") valid++;
    }
    const j = jobs.get(f.job_id);
    if (j && j.depth > 0 && j.client === id) asLead += big(f.paid_lead);
  }
  const posted = s.jobs.filter((j) => j.depth === 0 && j.client === id);
  const spent = s.findings.filter((f) => posted.some((j) => j.id === f.job_id || jobs.get(f.job_id)?.parent_id === j.id)).reduce((x, f) => x + big(f.paid_attacker) + big(f.paid_lead), 0n);
  return { earned: asAttacker + asLead, asAttacker, asLead, valid, attacks, jobsPosted: posted.length, spent };
}

/** a job and everything under it */
export function jobFamily(s: Snapshot, id: number): { root: Job; jobs: Job[]; findings: Finding[] } | null {
  const jobs = new Map(s.jobs.map((j) => [j.id, j]));
  const j = jobs.get(id);
  if (!j) return null;
  const root = j.parent_id != null ? (jobs.get(j.parent_id) ?? j) : j;
  const family = [root, ...root.children.map((c) => jobs.get(c)).filter((x): x is Job => !!x)];
  const ids = new Set(family.map((x) => x.id));
  return { root, jobs: family, findings: s.findings.filter((f) => ids.has(f.job_id)) };
}
