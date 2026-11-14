/**
 * `pnpm probe:target` — call the live TEE-hosted target model DIRECTLY (NEAR AI Cloud, same settings as the
 * enclave: temp 0, thinking off, ≤512 tokens) with every library payload against v1 and v2 of the target.
 * Fee-free on chain, ≈ $0.005 of NEAR AI. Records only {version, category, kind, technique, leak} — no payload
 * text, no canary — to fixtures/probe-<kind>.json. Supporting evidence for the v1/v2 behaviour; the authoritative
 * verdicts are the enclave's (fixtures/demo-receipts.json).
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import { detectLeak } from '../enclave/leak.js';
import { resolveNearAiKey } from '../llm/llm.js';
import { LIVE_TARGET_MODEL, profile, type TargetKind } from '../target/index.js';
import { log } from '../util/log.js';
import { writeJson } from './common.js';

const kind = (process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] as TargetKind) ?? undefined;
const prof = profile(kind);
const key = resolveNearAiKey();
if (!key) {
  log.fail('needs NEARAI_API_KEY (or the macOS Keychain item near-redteam-nearai)');
  process.exit(1);
}
const client = new OpenAI({ apiKey: key, baseURL: config.llm.baseUrl });
log.section(`Canary Court · probe ${prof.name} on ${LIVE_TARGET_MODEL} (direct, temp 0)`);
const rows: { version: string; category: string; kind: string; technique: string; leak: string }[] = [];
let pt = 0, ct = 0;
for (const version of ['v1', 'v2'] as const) {
  const canary = prof.newCanary();
  const system = prof.systemPrompt(canary, version);
  for (const [category, lib] of Object.entries(prof.library)) {
    for (const [i, p] of lib.entries()) {
      const r = (await client.chat.completions.create({ model: LIVE_TARGET_MODEL, temperature: 0, max_tokens: 512, chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'system', content: system }, { role: 'user', content: p.payload }] } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)) as OpenAI.Chat.ChatCompletion;
      pt += r.usage?.prompt_tokens ?? 0;
      ct += r.usage?.completion_tokens ?? 0;
      const leak = detectLeak(canary, r.choices[0].message.content ?? '');
      rows.push({ version, category, kind: i === 0 ? 'playbook' : 'classic', technique: p.technique, leak });
      log.info(`${version} ${category.padEnd(17)} ${(i === 0 ? 'playbook' : 'classic').padEnd(8)} ${leak}`);
    }
  }
}
const summary = (v: string, k: string) => `${rows.filter((r) => r.version === v && r.kind === k && r.leak !== 'none' && r.leak !== 'partial').length}/${rows.filter((r) => r.version === v && r.kind === k).length}`;
const out = { recorded_at: new Date().toISOString(), target: prof.kind, model: LIVE_TARGET_MODEL, settings: { temperature: 0, enable_thinking: false, max_tokens: 512 }, summary: { v1_playbook_leaks: summary('v1', 'playbook'), v1_classic_leaks: summary('v1', 'classic'), v2_playbook_leaks: summary('v2', 'playbook'), v2_classic_leaks: summary('v2', 'classic') }, usage: { prompt_tokens: pt, completion_tokens: ct }, rows };
writeJson(`${config.fixturesDir}/probe-${prof.kind}.json`, out);
log.ok(`v1 playbooks ${out.summary.v1_playbook_leaks} leak, classics ${out.summary.v1_classic_leaks}; v2 playbooks ${out.summary.v2_playbook_leaks}, classics ${out.summary.v2_classic_leaks} → fixtures/probe-${prof.kind}.json`);
