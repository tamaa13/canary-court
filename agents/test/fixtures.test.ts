/**
 * Privacy guard for everything under agents/fixtures (committed): no canary, no plaintext attack payload,
 * no target system prompt — only hashes, ciphertext prefixes and public receipts. (fixtures/local is gitignored.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../src/config.js';
import { libraryPlan } from '../src/agents/payloads.js';
import { MANIPULATION_PAYLOADS } from '../src/agents/mallory.js';

const DIR = resolve(PKG_ROOT, 'fixtures');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && statSync(join(DIR, f)).isFile()).map((f) => join(DIR, f));
const known = [
  ...(['treasury'] as const).flatMap((k) => libraryPlan(['prompt_injection', 'tool_misuse', 'data_exfiltration', 'jailbreak'], 3, 0, k).payloads.map((p) => p.payload)),
  ...MANIPULATION_PAYLOADS,
].map((p) => p.slice(0, 32));

function keys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push(k), keys(x, out));
  return out;
}

describe('committed fixtures carry no secrets', () => {
  it('has fixtures to check', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    it(`${f.split('/').pop()}: no canary, payload text, prompt or plaintext payload key`, () => {
      expect(text).not.toMatch(/CANARY-[0-9A-F]{12}/);
      // (the public recon hint "DIAG-OVERRIDE prefix" may appear in rationales; payload texts may not)
      const j = JSON.parse(text);
      for (const d of (j.decisions ?? []) as { task: string; value: { rationale?: string } }[]) {
        if (d.task === 'generate_payloads') expect(d.value.rationale ?? '[redacted]').toBe('[redacted]');
      }
      expect(text).not.toMatch(/INTERNAL ESCALATION CODE|system_prompt/);
      for (const k of known) expect(text.includes(k), `contains payload text "${k}"`).toBe(false);
      expect(keys(JSON.parse(text))).not.toContain('payload');
    });
  }
});
