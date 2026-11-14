// The market in plain words, for someone who just arrived: what a bot is called, which jobs were our own security
// tests, what a job is doing now and how it ended, what an agent did, and the few results worth reading. Everything is
// derived from the same snapshot as the rest of /app; nothing here is invented.

import type { MarketEvent } from "./events";
import { big, ledger, type AgentRow, type Snapshot, type TreeLedger } from "./snapshot";
import type { Job } from "./types";

// ───────────────────────────────────────────── names

export interface TargetInfo {
  /** what people call it */
  name: string;
  /** one line on what it is ("" when we only know its id) */
  about: string;
  /** our own security test (attack scenarios, the replay check, release checks): kept out of the market by default */
  test: boolean;
}

/** a bot's name from its target id ("treasury-v1-mwff…" → Tilly v1, the Moonbeam Mugs treasury agent); a bot we
 *  don't know is named after whoever posted it ("cc-mcp-own-0ffc74's bot") rather than guessed from its id */
export function targetInfo(id: string, owner?: string): TargetInfo {
  if (/^treasury-v1/.test(id)) return { name: "Tilly v1", about: "Moonbeam Mugs treasury agent, legacy build", test: false };
  if (/^treasury-v2/.test(id)) return { name: "Tilly v2", about: "Moonbeam Mugs treasury agent, hardened build", test: false };
  if (/^(treasury|tilly)/.test(id)) return { name: "Tilly", about: "Moonbeam Mugs treasury agent", test: false };
  if (/^atk-|^parcelly-atk/.test(id)) return { name: "Security test", about: "attack scenarios S1–S5", test: true };
  if (/^copy-/.test(id)) return { name: "Security test", about: "a copied target: the replay check", test: true };
  if (/^(rtc|smoke)-/.test(id)) return { name: "Security test", about: "a release check", test: true };
  if (/^parcelly-v1/.test(id)) return { name: "Parcelly v1", about: "an earlier target, legacy build", test: false };
  if (/^parcelly-v2/.test(id)) return { name: "Parcelly v2", about: "an earlier target, hardened build", test: false };
  if (/^parcelly/.test(id)) return { name: "Parcelly", about: "an earlier target", test: false };
  // another agent's bot (named after its owner, not guessed from its id)
  return { name: owner ? `${ownerName(owner)}'s bot` : "another agent's bot", about: "a bot posted by another agent", test: false };
}

/** the accounts our own security tests ran as (the scenario attackers, the replay copycat, the release sanity check) */
export const isTestAgent = (id: string) => /^(mallory\d*|copycat|rtc-sanity)\./.test(id);
export const isTestJob = (root: Job) => targetInfo(root.target_id).test;

/** an account, short */
export const who = (id: string) => id.replace(/\.arifnovrian\.testnet$/, "");
/** an owner, shortest (for "<owner>'s bot") */
const ownerName = (id: string) => id.replace(/\.(arifnovrian\.)?testnet$/, "");

export const roleText = (role: string) => (role === "client" ? "Owner: posts bots to be tested and pays for proven leaks" : "Attacker: tries to make bots leak, for bounties");

// ───────────────────────────────────────────── money and time, said simply

/** tUSDC from its 6-decimal units, whole where it is ("30", "2.5") */
export const usdc = (v: bigint) => {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").slice(0, 2);
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
};

export function timeLeft(deadlineMs: number, nowMs: number): string {
  const m = Math.round((deadlineMs - nowMs) / 60_000);
  if (m <= 0) return "deadline passed";
  if (m < 60) return `${m} min left`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h left`;
  return `${Math.round(h / 24)} days left`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ───────────────────────────────────────────── a job, in plain words

export interface JobPlain {
  t: TreeLedger;
  info: TargetInfo;
  /** open or assigned on chain */
  active: boolean;
  /** active and before its deadline: really happening now */
  live: boolean;
  /** what it's doing now, or how it ended */
  status: string;
  /** for a finished job: what came of it */
  result: string | null;
  attacks: number;
  leaks: number;
  attackers: number;
  paid: bigint;
}

export function jobPlain(s: Snapshot, t: TreeLedger, nowMs: number): JobPlain {
  const ids = new Set(t.jobs.map((j) => j.id));
  const fs = s.findings.filter((f) => ids.has(f.job_id));
  const leaks = fs.filter((f) => f.status === "Valid" && !f.unpaid).length;
  const attackers = new Set(fs.map((f) => f.attacker)).size;
  const hired = new Set(t.jobs.map((j) => j.provider).filter((p): p is string => !!p)).size;
  const paid = t.subRewards + t.providerRewards + t.leadMargins;
  const pending = t.jobs.reduce((n, j) => n + j.pending, 0);
  const active = t.jobs.some((j) => j.status === "Open" || j.status === "Assigned");
  const root = t.root;
  const late = active && root.deadline_ms < nowMs;
  let status: string;
  if (late) status = "Deadline passed, closing soon";
  else if (root.status === "Open") status = "Waiting for attackers";
  else if (active && pending > 0) status = "Awaiting verdicts";
  else if (active) status = hired ? `${plural(hired, "attacker")} working` : "Starting";
  else status = root.status === "Closed" ? "Budget used up" : "Ended";
  const result = active
    ? null
    : leaks
      ? `${plural(leaks, "leak")} found, ${usdc(paid)} tUSDC paid`
      : fs.length
        ? `Held against ${plural(fs.length, "attack")}`
        : "Nobody attacked it";
  return { t, info: targetInfo(root.target_id, root.client), active, live: active && !late, status, result, attacks: fs.length, leaks, attackers: Math.max(attackers, active ? hired : 0), paid };
}

/** the job page's opening sentence */
export function jobSentence(p: JobPlain): string {
  const { t, info, leaks, attacks, attackers, paid } = p;
  const name = info.test ? `This security test (${info.about})` : info.name;
  const back = t.refunded > 0n ? `${usdc(t.refunded)} tUSDC went back to its owner` : "";
  if (p.active && !p.live) return `${name} reached its deadline with ${plural(attacks, "attack")} and ${plural(leaks, "leak")}; whatever wasn't paid goes back to its owner once the job is closed.`;
  if (t.root.status === "Open") return `${name} is waiting for attackers: a ${usdc(big(t.root.budget))} tUSDC bounty, ${usdc(big(t.root.reward_per_finding))} per leak.`;
  if (p.active) return `${name} is being tested by ${plural(Math.max(1, attackers), "agent")}. So far: ${plural(attacks, "attack")}, ${plural(leaks, "leak")}.`;
  if (!attacks) return `Nobody attacked ${name} before the deadline${back ? `; ${back}` : ""}.`;
  if (!leaks) return `${name} was tested by ${plural(attackers, "agent")} and held against all ${plural(attacks, "attack")}${back ? `; ${back}` : ""}.`;
  return `${name} was tested by ${plural(attackers, "agent")}. ${leaks} of ${plural(attacks, "attack")} made it leak; the owner paid ${usdc(paid)} tUSDC and got ${plural(leaks, "sealed report")}${back ? `; ${back}` : ""}.`;
}

// ───────────────────────────────────────────── results worth reading

export type ResultPart = string | { acct: string } | { job: number; name: string };
export interface Result {
  id: string;
  ts: number;
  parts: ResultPart[];
  test: boolean;
}

/** only outcomes: leaks paid, bots that held, agents blocklisted. Newest first. */
export function recentResults(s: Snapshot, events: MarketEvent[]): Result[] {
  const out: Result[] = [];
  const byId = new Map(s.jobs.map((j) => [j.id, j]));
  const rootOf = (id: number) => {
    const j = byId.get(id);
    return j?.parent_id != null ? (byId.get(j.parent_id) ?? j) : j;
  };
  for (const f of s.findings) {
    if (f.status !== "Valid" || f.unpaid) continue;
    const root = rootOf(f.job_id);
    if (!root) continue;
    const info = targetInfo(root.target_id, root.client);
    out.push({
      id: `leak:${f.id}`,
      ts: f.evaluated_ms ?? f.created_ms,
      test: info.test || isTestAgent(f.attacker),
      parts: [{ acct: f.attacker }, " made ", { job: root.id, name: info.test ? "a security-test bot" : info.name }, ` leak its key: paid ${usdc(big(f.paid_attacker))} tUSDC`],
    });
  }
  // (when a job ended: its expiry or close in the feed, else its deadline)
  const endedAt = new Map<number, number>();
  for (const e of events) if ((e.kind === "expired" || e.kind === "closed") && e.rootId != null && !endedAt.has(e.rootId)) endedAt.set(e.rootId, e.ts);
  for (const t of ledger(s.jobs, s.findings)) {
    const p = jobPlain(s, t, s.timeMs);
    if (p.active || p.leaks || !p.attacks) continue;
    out.push({
      id: `held:${t.root.id}`,
      ts: endedAt.get(t.root.id) ?? t.root.deadline_ms,
      test: p.info.test,
      parts: [
        { job: t.root.id, name: p.info.test ? "A security-test bot" : p.info.name },
        ` held against ${plural(p.attacks, "attack")}`,
        t.refunded > 0n ? `: ${usdc(t.refunded)} tUSDC back to its owner` : "",
      ],
    });
  }
  for (const e of events) {
    if (e.kind !== "blocklist") continue;
    const id = e.accounts[0];
    if (!id) continue;
    out.push({ id: `block:${e.id}`, ts: e.ts, test: isTestAgent(id), parts: [{ acct: id }, " was blocklisted after 2 strikes"] });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

// ───────────────────────────────────────────── the market in four numbers

export function marketNumbers(s: Snapshot) {
  const trees = ledger(s.jobs, s.findings).filter((t) => !isTestJob(t.root));
  const ids = new Set(trees.flatMap((t) => t.jobs.map((j) => j.id)));
  const fs = s.findings.filter((f) => ids.has(f.job_id));
  return {
    paid: fs.reduce((x, f) => x + big(f.paid_attacker) + big(f.paid_lead), 0n),
    leaks: fs.filter((f) => f.status === "Valid" && !f.unpaid).length,
    bots: new Set(trees.filter((t) => fs.some((f) => t.jobs.some((j) => j.id === f.job_id))).map((t) => t.root.target_id)).size,
    agents: s.agents.filter((a) => !isTestAgent(a.account_id)).length,
  };
}

// ───────────────────────────────────────────── an agent, in plain words

export function agentSentence(a: AgentRow, st: { earned: bigint; asLead: bigint; valid: number; attacks: number; jobsPosted: number; spent: bigint }): string {
  const name = who(a.account_id);
  if (a.role === "client") {
    if (!st.jobsPosted) return `${name} has joined as an owner but hasn't posted a bot yet.`;
    return `${name} posted ${plural(st.jobsPosted, "bot")} for testing and paid ${usdc(st.spent)} tUSDC for proven leaks.`;
  }
  if (!st.attacks) return `${name} has joined as an attacker but hasn't sent an attack yet.`;
  const lead = st.asLead > 0n ? `, ${usdc(st.asLead)} of it as a lead hiring other agents` : "";
  return `${name} sent ${plural(st.attacks, "attack")}; ${st.valid ? `${st.valid} made a bot leak, earning ${usdc(st.earned)} tUSDC${lead}` : "none made a bot leak yet"}.`;
}
