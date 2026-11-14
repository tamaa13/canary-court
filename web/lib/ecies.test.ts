// Cross-team ECIES interop: the same vectors are published by rt-agents and rt-enclave.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { encrypt, decrypt, x25519Keygen, x25519PubOf, hexToBytes, bytesToHex, fromB64 } from './ecies';

const CANDIDATES = [
  resolve(__dirname, '../../agents/test/vectors/ecies.json'),
  resolve(__dirname, '../../enclave/test-vectors/ecies.json'),
  join(homedir(), 'projects/near-redteam-agents/agents/test/vectors/ecies.json'),
  join(homedir(), 'projects/near-redteam-enclave/enclave/test-vectors/ecies.json'),
];
const files = CANDIDATES.filter(existsSync);

describe('ECIES', () => {
  it('round-trips', () => {
    const k = x25519Keygen();
    const blob = encrypt(k.pk, { payload: 'x', category: 'jailbreak' });
    expect(JSON.parse(new TextDecoder().decode(decrypt(k.sk, blob)))).toEqual({ payload: 'x', category: 'jailbreak' });
    expect(fromB64(blob)[0]).toBe(1);
    expect(() => decrypt(x25519Keygen().sk, blob)).toThrow();
  });

  for (const f of files) {
    const doc = JSON.parse(readFileSync(f, 'utf8')) as { ecies: { name: string; recipient_sk: string; recipient_pk: string; eph_sk: string; nonce: string; plaintext_utf8: string; blob_b64: string }[] };
    for (const v of doc.ecies ?? []) {
      it(`matches vector "${v.name}" from ${f.split('/').slice(-4).join('/')}`, () => {
        expect(x25519PubOf(v.recipient_sk)).toBe(v.recipient_pk);
        expect(new TextDecoder().decode(decrypt(v.recipient_sk, v.blob_b64))).toBe(v.plaintext_utf8);
        const mine = encrypt(v.recipient_pk, new TextEncoder().encode(v.plaintext_utf8), { sk: hexToBytes(v.eph_sk), nonce: hexToBytes(v.nonce) });
        expect(bytesToHex(fromB64(mine))).toBe(bytesToHex(fromB64(v.blob_b64)));
      });
    }
  }
  it.skipIf(files.length > 0)('vectors not found (agents/enclave not checked out)', () => {});
});
