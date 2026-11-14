import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  b64, decrypt, decryptBytes, decryptJson, encrypt, encryptBytes, encryptJson, hex, x25519PublicHex,
} from '../src/crypto/ecies.js';
import { deriveX25519Secret } from '../src/crypto/keys.js';
import { PKG_ROOT } from '../src/config.js';

const V = JSON.parse(readFileSync(resolve(PKG_ROOT, 'test/vectors/ecies.json'), 'utf8'));
const te = new TextEncoder();

describe('ECIES §5 vectors (agents)', () => {
  for (const c of V.ecies) {
    it(`encrypts "${c.name}" byte-for-byte`, () => {
      const blob = encryptBytes(hex.decode(c.recipient_pk), te.encode(c.plaintext_utf8), {
        ephSk: hex.decode(c.eph_sk), nonce: hex.decode(c.nonce),
      });
      expect(hex.encode(blob)).toBe(c.blob_hex);
      expect(b64.encode(blob)).toBe(c.blob_b64);
    });
    it(`decrypts "${c.name}"`, () => {
      expect(new TextDecoder().decode(decrypt(c.recipient_sk, c.blob_b64))).toBe(c.plaintext_utf8);
    });
  }

  it('derives the agent x25519 key per PM spec', () => {
    const d = V.x25519_derivation;
    const sk = deriveX25519Secret(hex.decode(d.ed25519_seed), d.account_id);
    expect(hex.encode(sk)).toBe(d.x25519_sk);
    expect(x25519PublicHex(sk)).toBe(d.x25519_pk);
  });
});

// rt-enclave publishes its own vectors from the same inputs; cross-check when present.
const ENCLAVE_VECTORS = [
  resolve(PKG_ROOT, '../../near-redteam-enclave/enclave/test-vectors/ecies.json'),
  resolve(process.env.HOME ?? '', 'projects/near-redteam-enclave/enclave/test-vectors/ecies.json'),
].find(existsSync);

describe.skipIf(!ENCLAVE_VECTORS)('ECIES cross-check with rt-enclave vectors (Rust implementation)', () => {
  const ev = ENCLAVE_VECTORS ? JSON.parse(readFileSync(ENCLAVE_VECTORS, 'utf8')) : { ecies: [], must_reject: [] };
  for (const c of ev.ecies ?? []) {
    it(`decrypts and re-encrypts enclave vector "${c.name}" byte-for-byte`, () => {
      expect(new TextDecoder().decode(decrypt(c.recipient_sk, c.blob_b64))).toBe(c.plaintext_utf8);
      const blob = encryptBytes(hex.decode(c.recipient_pk), te.encode(c.plaintext_utf8), { ephSk: hex.decode(c.eph_sk), nonce: hex.decode(c.nonce) });
      expect(hex.encode(blob)).toBe(c.blob_hex);
    });
  }
  for (const c of ev.must_reject ?? []) {
    it(`rejects: ${c.why}`, () => {
      expect(() => decryptBytes(hex.decode(c.recipient_sk), hex.decode(c.blob_hex))).toThrow();
    });
  }
});

describe('ECIES properties', () => {
  const sk = x25519.utils.randomSecretKey();
  const pk = x25519PublicHex(sk);

  it('round-trips JSON with random ephemeral key and nonce', () => {
    const v = { payload: 'héllo 🌍', category: 'tool_misuse' };
    const a = encryptJson(pk, v);
    const b = encryptJson(pk, v);
    expect(a).not.toBe(b);
    expect(decryptJson(sk, a)).toEqual(v);
    expect(b64.decode(a)[0]).toBe(0x01);
  });

  it('encrypt() facade accepts bytes or objects', () => {
    expect(new TextDecoder().decode(decrypt(hex.encode(sk), encrypt(pk, te.encode('raw'))))).toBe('raw');
    expect(decryptJson(sk, encrypt(pk, { a: 1 }))).toEqual({ a: 1 });
  });

  it('rejects tampering, wrong key, wrong version', () => {
    const blob = encryptBytes(hex.decode(pk), te.encode('secret'));
    const t = blob.slice();
    t[t.length - 1] ^= 1;
    expect(() => decryptBytes(sk, t)).toThrow();
    expect(() => decryptBytes(x25519.utils.randomSecretKey(), blob)).toThrow();
    const v = blob.slice();
    v[0] = 2;
    expect(() => decryptBytes(sk, v)).toThrow(/version/);
  });

  it('rejects low-order points (all-zero shared secret)', () => {
    expect(() => encryptBytes(new Uint8Array(32), te.encode('x'))).toThrow();
  });
});
