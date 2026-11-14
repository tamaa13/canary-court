/**
 * `pnpm open-report --finding <id> --key <your .x25519 file> [--canary <c> | --canary-file <f>] [--show]`
 * Decrypt the sealed report of a Valid finding (report_for_client, or report_for_lead for subjob leads) and verify it:
 *   sha256(record_json) == report.result_hash == on-chain finding.result_hash. With your canary it also re-runs
 *   the leak detector on the bot's response. Response text is masked unless --show.
 */
import { readFileSync } from 'node:fs';
import { decryptJson, sha256Hex } from '../crypto/ecies.js';
import { detectLeak, redact } from '../enclave/leak.js';
import type { EvalRecord, Finding, FindingReport } from '../chain/types.js';
import { arg, die, flag, readX25519Secret, view } from './ext-common.js';

const id = Number(arg('finding') ?? die('usage: pnpm open-report --finding <id> --key <file.x25519> [--canary <c>]'));
const sk = readX25519Secret(arg('key') ?? die('--key <your .x25519 file> is required'));
const canary = arg('canary') ?? (arg('canary-file') ? readFileSync(arg('canary-file')!, 'utf8').trim() : undefined);
const f = (await view<Finding | null>('get_finding', { finding_id: id })) ?? die(`finding ${id} not found`);
if (f.status === 'Pending') die(`finding ${id} is still Pending (the TEE verdict lands ~1–2 min after submit)`);
const blobs = [['client', f.report_for_client], ['lead', f.report_for_lead]] as const;
let report: FindingReport | null = null;
let as = '';
for (const [who, b] of blobs) {
  if (!b) continue;
  try {
    report = decryptJson<FindingReport>(sk, b);
    as = who;
    break;
  } catch { /* not sealed to this key */ }
}
if (!report) die(`finding ${id} is ${f.status}${f.error ? ` (${f.error})` : ''}: no report decryptable with this key (reports exist only for Valid findings and only for the client / subjob lead)`);
const integrity = sha256Hex(report.record_json) === report.result_hash && report.result_hash === f.result_hash;
const record = JSON.parse(report.record_json) as EvalRecord;
const leak = canary ? detectLeak(canary, report.response_excerpt) : null;
const mask = (s: string) => (flag('show') || !canary ? s : redact(canary, s));
process.stdout.write(JSON.stringify({
  finding: id, job: f.job_id, status: f.status, severity: f.severity, opened_as: as,
  integrity_ok: integrity, result_hash: f.result_hash,
  record: { category: record.category, leak: record.leak, model: record.model, llm: record.llm, dual: record.dual, attempts: record.attempts },
  payload: mask(report.payload), response_excerpt: mask(report.response_excerpt), payload_truncated: report.payload_truncated ?? false,
  ...(leak ? { your_canary_leaked: leak } : {}),
}, null, 2) + '\n');
if (!integrity) process.exit(2);
