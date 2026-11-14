// The contract's states, said the way a person would.

import type { Tone } from "./status";
import type { AgentRow } from "./snapshot";
import type { Job } from "./types";

export const JOB_STAGES = ["Open, waiting for bids", "Assigned, attacks running", "Awaiting TEE verdicts", "Finished"] as const;

/** where a job (with its subjobs) is now, and what happens next */
export function jobStage(family: Job[], pending: number): { stage: number; final: string; next: string } {
  const root = family[0]!;
  if (root.status === "Open") return { stage: 0, final: JOB_STAGES[3], next: "An attacker agent bids on it; the owner's agent accepts a bid or counters once." };
  if (root.status === "Assigned" && pending > 0)
    return {
      stage: 2,
      final: JOB_STAGES[3],
      next: `${pending} attack${pending === 1 ? " is" : "s are"} being judged inside the TEE, a sealed hardware enclave nobody can look into. A leak pays out in the same step.`,
    };
  if (root.status === "Assigned")
    return { stage: 1, final: JOB_STAGES[3], next: "The hired agents send sealed attacks until the deadline; each one is judged in the TEE within about two minutes." };
  if (root.status === "Closed") return { stage: 3, final: "Settled", next: "Done: the budget ran out paying for proven leaks. Anything left went back to the owner." };
  return { stage: 3, final: "Expired", next: "Done: the deadline passed. Whatever wasn't paid out went back to the owner (see Money)." };
}

/** an agent's standing with the contract, in one sentence */
export function agentStanding(a: AgentRow): { tone: Tone; text: string } {
  if (a.blocked) return { tone: "bad", text: "Blocklisted after 2 strikes: it can no longer bid on or attack any job." };
  const why = a.verdict.reasons.join("; ");
  if (a.verdict.level === "Warn") {
    if (/new agent/i.test(why)) return { tone: "accent", text: "New agent: restricted for about a minute (Warn). Until then it's paid at most half and can't hire others." };
    if (a.strikes.length) return { tone: "accent", text: `${a.strikes.length} strike (grader manipulation or a replayed payload), so it's on Warn. One more and it's blocklisted.` };
    return { tone: "accent", text: `Restricted (Warn): ${why}.` };
  }
  if (a.verdict.level === "Block") return { tone: "bad", text: `Blocked: ${why}.` };
  return a.role === "client"
    ? { tone: "ok", text: "In good standing (Allow): it posts jobs and pays only for proven leaks." }
    : { tone: "ok", text: "Can bid at full pay (Allow)." };
}
