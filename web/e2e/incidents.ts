// Compiles every infrastructure incident of e2e runs from the chain (read-only):
//   - policy-log `infra_timeout` entries whose actor is a run account (e<run>-*)
//   - findings of run jobs that failed with a NEAR AI error (LLM_UNAVAILABLE / LLM_BAD_RESPONSE)
// and how each was resolved (a later finding by the same attacker in the same job).
//   npx tsx e2e/incidents.ts <out.json> <runId> [runId…]
import { writeFileSync } from 'node:fs';
import { Rpc, TESTNET_RPCS } from '../lib/rpc';
import type { Finding, Job, PolicyLogEntry } from '../lib/types';

export interface Incident {
  run: string;
  finding: number;
  job: number;
  attacker: string;
  kind: 'infra_timeout' | 'llm_error';
  error: string;
  policy_seq: number | null;
  resolution: string;
  resolved: boolean;
}

const [out, ...runs] = process.argv.slice(2);
if (!out || !runs.length) {
  console.error('usage: incidents.ts <out.json> <runId> [runId…]');
  process.exit(2);
}
const contract = process.env.REDTEAM_CONTRACT ?? 'redteam.arifnovrian.testnet';
const rpc = new Rpc(TESTNET_RPCS);
const view = async <T>(m: string, a: object = {}) => (await rpc.view<T>(contract, m, a)).value;

const counts = await view<{ jobs: number; policy_log: number }>('get_counts');
const log: PolicyLogEntry[] = [];
for (let f = 0; f < counts.policy_log; f += 200) log.push(...(await view<PolicyLogEntry[]>('get_policy_log', { from: f, limit: 200 })));
const jobs: Job[] = [];
for (let f = 0; f < counts.jobs; f += 200) jobs.push(...(await view<Job[]>('list_jobs', { from: f, limit: 200 })));

const incidents: Incident[] = [];
for (const run of runs) {
  const prefix = `e${run}-`;
  const runJobs = jobs.filter((j) => j.root_client.startsWith(prefix));
  const findings = (await Promise.all(runJobs.map((j) => view<Finding[]>('get_findings', { job_id: j.id })))).flat();
  // each failed finding is matched to the next not-yet-used later finding by the same attacker in the same job
  const used = new Set<number>();
  const resolve = (f: Finding) => {
    const later = findings.filter((x) => x.attacker === f.attacker && x.job_id === f.job_id && x.id > f.id && x.status !== 'Failed' && !used.has(x.id)).sort((a, b) => a.id - b.id)[0];
    if (later) used.add(later.id);
    return later
      ? { resolved: true, resolution: `resubmitted in-run as #${later.id} → ${later.status}${later.manipulation ? ' (manipulation)' : ''}${later.unpaid ? ' (unpaid)' : ''}` }
      : { resolved: false, resolution: 'not resubmitted in this run' };
  };
  const cands: { f: Finding; kind: Incident['kind']; seq: number | null }[] = [];
  for (const e of log.filter((x) => x.action === 'infra_timeout' && x.actor.startsWith(prefix))) {
    const id = Number(/finding (\d+)/.exec(e.detail)?.[1]);
    const f = findings.find((x) => x.id === id);
    if (f) cands.push({ f, kind: 'infra_timeout', seq: e.seq });
  }
  for (const f of findings.filter((x) => x.status === 'Failed' && /LLM_UNAVAILABLE|LLM_BAD_RESPONSE/.test(x.error ?? ''))) cands.push({ f, kind: 'llm_error', seq: null });
  for (const { f, kind, seq } of cands.sort((a, b) => a.f.id - b.f.id))
    incidents.push({ run, finding: f.id, job: f.job_id, attacker: f.attacker, kind, error: f.error ?? '', policy_seq: seq, ...resolve(f) });
}
incidents.sort((a, b) => a.finding - b.finding);
writeFileSync(out, JSON.stringify(incidents, null, 2));
for (const i of incidents) console.log(`${i.run} #${i.finding} ${i.kind} seq=${i.policy_seq ?? '-'} ${i.attacker.split('.')[0]}: ${i.resolution}`);
