/**
 * `pnpm seal-target` — build the target plaintext and ECIES-seal it to the enclave (ARCHITECTURE §5, v0.1.2 binding):
 *   {system_prompt, canary, model, client_pubkey}  →  base64 enc_target (stdout)  → use it in register_target.
 *
 *   --system-prompt-file <f> | --template treasury [--version v1|v2]
 *   --canary <8..128 chars>  (default: random, written to --canary-out)
 *   --model mock | <NEAR AI model owned_by nearai>   (default: mock = free canned stub that ignores the system prompt;
 *                                                    it tests the market, not your bot. Use a NEAR AI model to test your prompt)
 *   --client-pubkey <hex64> | --key <your .x25519 file>   (MUST be the x25519 key you registered: binding)
 *   --canary-out <file>   (0600; you need the canary later to verify reports)
 *
 * The canary must be a FAKE secret you made up (never a real key/password). It must appear in the system prompt.
 */
import { readFileSync } from 'node:fs';

import { encryptJson, x25519PublicHex } from '../crypto/ecies.js';
import { profile, type TargetKind } from '../target/index.js';
import { arg, die, enclavePubkey, readX25519Secret, writeSecretFile } from './ext-common.js';

const template = arg('template') as TargetKind | undefined;
if (template && template !== 'treasury') die('the only built-in template is: treasury');
const version = (arg('version') ?? 'v1') as 'v1' | 'v2';
const model = arg('model') ?? 'mock';
let canary = arg('canary');
let systemPrompt: string;
if (template) {
  const prof = profile(template);
  canary ??= prof.newCanary();
  systemPrompt = prof.systemPrompt(canary, version);
} else {
  const f = arg('system-prompt-file') ?? die('give --system-prompt-file <f> (with --canary) or --template treasury');
  systemPrompt = readFileSync(f, 'utf8');
  canary ??= die('--canary is required with --system-prompt-file');
}
if (canary.length < 8 || canary.length > 128) die('canary must be 8..128 characters');
if (!systemPrompt.includes(canary)) die('the system prompt must contain the canary verbatim');
if (systemPrompt.length > 16000) die('system prompt > 16000 chars');

const clientPubkey = (arg('client-pubkey') ?? (arg('key') ? x25519PublicHex(readX25519Secret(arg('key')!)) : undefined))?.toLowerCase()
  ?? die('give --client-pubkey <hex> or --key <your .x25519 file> (the key you registered with register_agent)');
if (!/^[0-9a-f]{64}$/.test(clientPubkey)) die('client pubkey must be 64 hex chars');

const enclave = arg('enclave-pubkey') ?? (await enclavePubkey());
const enc = encryptJson(enclave, { system_prompt: systemPrompt, canary, model, client_pubkey: clientPubkey });
if (enc.length > 8192) die(`enc_target is ${enc.length} b64 chars (> 8192): shorten the system prompt`);
const canaryOut = arg('canary-out') ?? (template || !arg('canary') ? 'canary.secret' : undefined);
if (canaryOut) writeSecretFile(canaryOut, canary + '\n');
process.stderr.write(`sealed ${template ? `${template} ${version}` : 'custom'} target (model ${model}, ${systemPrompt.length} chars) to enclave ${enclave.slice(0, 12)}…, bound to client ${clientPubkey.slice(0, 12)}…${canaryOut ? `; canary saved to ${canaryOut} (0600)` : ''}\n`);
process.stdout.write(enc + '\n');

