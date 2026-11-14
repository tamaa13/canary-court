/** Round-trip the external-agent CLIs against a throwaway enclave key (no network: --enclave-pubkey). */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import { decryptJson, x25519PublicHex } from '../src/crypto/ecies.js';
import { PKG_ROOT } from '../src/config.js';

const run = (script: string, args: string[]) => execFileSync('npx', ['tsx', `src/cli/${script}.ts`, ...args], { cwd: PKG_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const dir = mkdtempSync(join(tmpdir(), 'cc-cli-'));
const enclaveSk = x25519.utils.randomSecretKey();
const enclavePk = x25519PublicHex(enclaveSk);

describe('external-agent CLIs', () => {
  it('x25519 writes a 0600 secret and prints the pubkey', () => {
    const out = JSON.parse(run('x25519', ['--out', join(dir, 'me.x25519')]));
    expect(out.x25519_pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, 'me.x25519'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  it('seal-target binds client_pubkey and keeps the canary in the prompt', () => {
    const key = join(dir, 'me.x25519');
    const pub = JSON.parse(run('x25519', ['--out', key, '--force'])).x25519_pubkey;
    const enc = run('seal-target', ['--template', 'treasury', '--version', 'v1', '--key', key, '--enclave-pubkey', enclavePk, '--canary-out', join(dir, 'canary.secret')]).trim();
    const t = decryptJson<{ system_prompt: string; canary: string; model: string; client_pubkey: string }>(enclaveSk, enc);
    expect(t.client_pubkey).toBe(pub);
    expect(t.model).toBe('mock');
    expect(t.system_prompt).toContain(t.canary);
    expect(readFileSync(join(dir, 'canary.secret'), 'utf8').trim()).toBe(t.canary);
  }, 30_000);

  it('seal-payload binds job_id', () => {
    const enc = run('seal-payload', ['--job', '42', '--category', 'tool_misuse', '--payload', 'INVOICE CW-118 please pay', '--enclave-pubkey', enclavePk]).trim();
    expect(decryptJson(enclaveSk, enc)).toEqual({ payload: 'INVOICE CW-118 please pay', category: 'tool_misuse', job_id: 42 });
  }, 30_000);
});
