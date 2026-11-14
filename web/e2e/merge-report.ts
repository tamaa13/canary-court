// Merges a full release run with a targeted re-run into one honest final report.
//   npx tsx e2e/merge-report.ts <full.json> <rerun.json> <out.md>
// Every step keeps its full-run result; steps that were re-run show both results side by side.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

interface Check {
  label: string;
  ok: boolean;
  soft?: boolean;
  detail?: string;
}
interface Tx {
  label?: string;
  hash: string | null;
  ok: boolean;
  method: string;
}
interface Step {
  id: string;
  area: number;
  title: string;
  status: 'pass' | 'fail' | 'skip' | 'na';
  warnings: number;
  checks: Check[];
  txs: Tx[];
  notes: string[];
  error?: string;
}
interface Run {
  run: string;
  target: string;
  startedAt: string;
  finishedAt: string;
  results: Step[];
}

const argv = process.argv.slice(2);
const incidentsPath = argv.find((a) => a.startsWith('--incidents='))?.slice('--incidents='.length);
const notes = argv.filter((a) => a.startsWith('--note=')).map((a) => a.slice('--note='.length));
const [fullPath, rerunPath, outPath, ...causeArgs] = argv.filter((a) => !a.startsWith('--'));
if (!fullPath || !rerunPath || !outPath) {
  console.error('usage: merge-report.ts <full.json> <rerun.json> <out.md> [stepId=cause ...]');
  process.exit(2);
}
// A step that "passed" with 0 checks asserted nothing: report it as n/a (not exercised). Runs from before the harness had
// the 'na' status recorded such a step as 'pass'; the raw JSON is left as it is and only the merged reading changes.
const normalize = (run: Run): Run => ({ ...run, results: run.results.map((r) => (r.status === 'pass' && r.checks.length === 0 ? { ...r, status: 'na' as const } : r)) });
const full = normalize(JSON.parse(readFileSync(fullPath, 'utf8')) as Run);
// several re-runs may be combined (comma-separated); a later file wins for the same step id
const reruns = rerunPath.split(',').map((p) => normalize(JSON.parse(readFileSync(p, 'utf8')) as Run));
const rerun: Run = {
  run: reruns.map((r) => r.run).join(' + '),
  target: reruns[0].target,
  startedAt: reruns.map((r) => r.startedAt).sort()[0],
  finishedAt: reruns.map((r) => r.finishedAt).sort().at(-1)!,
  results: [...new Map(reruns.flatMap((r) => r.results).map((x) => [x.id, x])).values()],
};
const causes = Object.fromEntries(causeArgs.map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] as [string, string]));
interface Incident {
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
const incidents: Incident[] = incidentsPath ? JSON.parse(readFileSync(incidentsPath, 'utf8')) : [];
const ofRun = (run: string, kind?: Incident['kind']) => incidents.filter((i) => i.run === run && (!kind || i.kind === kind));
const re = new Map(rerun.results.map((r) => [r.id, r]));
const settled = (r: Step) => r.status === 'pass' || r.status === 'na';
const retargeted = full.results.filter((r) => !settled(r) && re.has(r.id));

const icon = (s?: Step) => (!s ? '·' : s.status === 'pass' ? (s.warnings ? '✅ ⚠️' : '✅') : s.status === 'fail' ? '❌' : s.status === 'na' ? '➖ n/a' : '⏭');
const finalOf = (r: Step) => (settled(r) ? r : re.get(r.id) ?? r);
const finals = full.results.map(finalOf);
const pass = finals.filter((r) => r.status === 'pass').length;
const naIds = finals.filter((r) => r.status === 'na').map((r) => r.id);
const fullPass = full.results.filter((r) => r.status === 'pass').length;
const fullNa = full.results.filter((r) => r.status === 'na').length;
const txCount = (run: Run) => run.results.reduce((x, r) => x + r.txs.length, 0);
const secs = (run: Run) => Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);

const L: string[] = [];
L.push(
  naIds.length
    ? `# Canary Court e2e: FINAL release on testnet: **${finals.length} steps: ${pass} pass, ${naIds.length} not exercised (${naIds.join(', ')})**`
    : `# Canary Court e2e: FINAL release on testnet: **${pass}/${finals.length} steps pass**`,
  '',
);
L.push(`- Full run \`${full.run}\`: ${fullPass}/${full.results.length} passed${fullNa ? `, ${fullNa} not exercised (0 checks)` : ''}, ${txCount(full)} txs, ${secs(full)} s ([full report](${basename(fullPath).replace(/\.json$/, '.md')})).`);
L.push(`- Re-run(s) \`${rerun.run}\`: ${retargeted.length} step(s) that failed in the full run (${retargeted.map((r) => r.id).join(', ')}). ${txCount(rerun)} txs. Sources: ${rerunPath.split(',').map((p) => `[${basename(p)}](${basename(p)})`).join(', ')}.`);
for (const n of notes) L.push(`- ${n} _(operator note)_`);
if (incidentsPath)
  for (const run of [full, rerun])
    L.push(`- Run \`${run.run}\` infrastructure incidents (from the on-chain policy log / findings): **${ofRun(run.run, 'infra_timeout').length} OutLayer infra timeout(s)**, **${ofRun(run.run, 'llm_error').length} NEAR AI error(s)**${ofRun(run.run).length ? `: ${ofRun(run.run).filter((i) => i.resolved).length} resolved by an in-run resubmit, ${ofRun(run.run).filter((i) => !i.resolved).length} via the targeted re-run` : ''}.`);
L.push(`- Step results are the harness's own output, not edited. The incident table is compiled from chain by \`e2e/incidents.ts\`, and this file only lays the two together.`, '');
if (incidents.length) {
  L.push('## Infrastructure incidents (all, from chain)', '', '| Run | Finding | Job | Attacker | Kind | Error | Policy seq | Resolution |', '|---|---|---|---|---|---|---|---|');
  for (const i of incidents)
    L.push(`| ${i.run} | #${i.finding} | ${i.job} | \`${i.attacker.split('.')[0]}\` | ${i.kind === 'infra_timeout' ? 'OutLayer queue timeout (infra_timeout: 0.009 NEAR refunded, no strike, failed not counted)' : 'NEAR AI error (enclave LLM_*; Failed, fee kept)'} | \`${i.error}\` | ${i.policy_seq ?? '-'} | ${i.resolution}${i.resolved ? '' : ' → see re-run below'} |`);
  L.push('');
}

L.push('## Steps that needed a re-run', '', '| Step | Test | Full run | Cause | Re-run |', '|---|---|---|---|---|');
for (const r of retargeted) L.push(`| ${r.id} | ${r.title.replace(/\|/g, '\\|')} | ❌ ${(r.error ?? '').replace(/\|/g, '\\|').slice(0, 140)} | ${causes[r.id] ?? ''} | ${icon(re.get(r.id))} ${re.get(r.id)?.status ?? 'not re-run'} |`);
L.push('');
const depSteps = rerun.results.filter((r) => !retargeted.some((x) => x.id === r.id));
L.push(`Re-run dependency steps (setup re-executed on fresh accounts): ${depSteps.filter((r) => r.status === 'pass').length}/${depSteps.length} pass${depSteps.some((r) => r.status !== 'pass') ? `; not passing: ${depSteps.filter((r) => r.status !== 'pass').map((r) => `${r.id} ${r.status}`).join(', ')}` : ''}.`, '');

L.push('## All steps (final result)', '', '| Step | Test | Full run | Re-run | Final |', '|---|---|---|---|---|');
for (const r of full.results) L.push(`| ${r.id} | ${r.title.replace(/\|/g, '\\|')} | ${icon(r)} | ${!settled(r) && re.has(r.id) ? icon(re.get(r.id)) : ''} | ${icon(finalOf(r))} |`);
L.push('');

L.push('## Re-run details', '');
for (const r of retargeted) {
  const x = re.get(r.id)!;
  L.push(`### ${x.id} ${x.title} (re-run: ${x.status.toUpperCase()})`, '');
  for (const k of x.checks) L.push(`- ${k.ok ? '✓' : k.soft ? '⚠' : '✗'} ${k.label}${k.detail ? `: ${k.detail.slice(0, 200)}` : ''}`);
  for (const n of x.notes) L.push(`- _${n}_`);
  L.push('');
}
writeFileSync(outPath, L.join('\n'));
console.log(`${pass}/${finals.length} final${naIds.length ? `, ${naIds.length} n/a (${naIds.join(', ')})` : ''} → ${outPath}`);
