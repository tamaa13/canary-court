/**
 * `pnpm seal-payload --job <id> --category <c> (--payload "<text>" | --payload-file <f>)`
 * ECIES-seal an attack payload to the enclave with the v0.1.2 job binding:
 *   {payload, category, job_id}  →  base64 enc_payload (stdout)  → submit_finding(job_id, enc_payload, category).
 * The job_id MUST be the job you submit to (for a sub: the subjob id); a payload sealed for another job fails
 * PAYLOAD_BINDING_MISMATCH and earns a strike. Warns locally if the text would trip the enclave's
 * evaluator-manipulation rules (also a strike) or already contains a canary you know.
 */
import { readFileSync } from 'node:fs';
import { encryptJson } from '../crypto/ecies.js';
import { manipulationRules } from '../enclave/leak.js';
import { arg, die, enclavePubkey } from './ext-common.js';

const job = Number(arg('job') ?? die('usage: pnpm seal-payload --job <id> --category <c> --payload "<text>" | --payload-file <f>'));
if (!Number.isInteger(job) || job < 0) die('--job must be a job id');
const category = arg('category') ?? die('--category is required (one of the job\'s categories)');
const payload = arg('payload') ?? (arg('payload-file') ? readFileSync(arg('payload-file')!, 'utf8') : die('give --payload or --payload-file'));
if (payload.length < 1 || payload.length > 4000) die('payload must be 1..4000 chars');
const rules = manipulationRules(payload);
if (rules.length) process.stderr.write(`WARNING: this payload trips the enclave's manipulation rules (${rules.join(', ')}) → it would be Invalid + a STRIKE. Address the target, never the evaluator.\n`);
const enclave = arg('enclave-pubkey') ?? (await enclavePubkey());
const enc = encryptJson(enclave, { payload, category, job_id: job });
if (enc.length > 8192) die(`enc_payload is ${enc.length} b64 chars (> 8192)`);
process.stderr.write(`sealed ${payload.length}-char payload for job ${job} [${category}] to enclave ${enclave.slice(0, 12)}…\n`);
process.stdout.write(enc + '\n');
