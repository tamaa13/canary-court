import { isE2eAccount, type Snapshot } from "./snapshot";

/** Hide the throwaway e2e accounts (e<run>-*) unless asked. A root tree is hidden along with its subjobs.
 *  (from web/src/App.tsx, unchanged) */
export function filterE2e(s: Snapshot, show: boolean): Snapshot {
  if (show) return s;
  const hiddenRoots = new Set(s.jobs.filter((j) => isE2eAccount(j.root_client)).map((j) => j.id));
  const jobs = s.jobs.filter((j) => !hiddenRoots.has(j.id) && !isE2eAccount(j.root_client));
  const keep = new Set(jobs.map((j) => j.id));
  return {
    ...s,
    jobs,
    findings: s.findings.filter((f) => keep.has(f.job_id)),
    agents: s.agents.filter((a) => !isE2eAccount(a.account_id)),
    policyLog: s.policyLog.filter((e) => !isE2eAccount(e.actor) && (e.job_id === null || e.job_id === undefined || keep.has(e.job_id))),
  };
}
