/** Regenerates test/vectors/ecies.json (deterministic inputs agreed with rt-enclave). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PKG_ROOT } from '../config.js';
import { encryptBytes, hex, b64, x25519PublicHex } from '../crypto/ecies.js';
import { deriveX25519Secret } from '../crypto/keys.js';

const fill = (b: number, n: number) => new Uint8Array(n).fill(b);
const te = new TextEncoder();
const cases = [
  { name: 'short', recipient_sk: fill(0x11, 32), eph_sk: fill(0x22, 32), nonce: fill(0x33, 12), plaintext: '{"payload":"hello","category":"prompt_injection"}' },
  {
    name: 'long', recipient_sk: fill(0x11, 32), eph_sk: fill(0x22, 32), nonce: fill(0x33, 12),
    plaintext: JSON.stringify({ system_prompt: 'You are Parcelly Assist, a fictional courier support bot. '.repeat(8).trim(), canary: 'CANARY-0123456789AB', model: 'Qwen/Qwen3.6-35B-A3B-FP8' }),
  },
];
const vectors = cases.map((c) => {
  const blob = encryptBytes(hex.decode(x25519PublicHex(c.recipient_sk)), te.encode(c.plaintext), { ephSk: c.eph_sk, nonce: c.nonce });
  return {
    name: c.name,
    recipient_sk: hex.encode(c.recipient_sk),
    recipient_pk: x25519PublicHex(c.recipient_sk),
    eph_sk: hex.encode(c.eph_sk),
    eph_pk: x25519PublicHex(c.eph_sk),
    nonce: hex.encode(c.nonce),
    plaintext_utf8: c.plaintext,
    blob_hex: hex.encode(blob),
    blob_b64: b64.encode(blob),
  };
});
const seed = fill(0x44, 32);
const account = 'client.arifnovrian.testnet';
const xsk = deriveX25519Secret(seed, account);
const out = {
  spec: 'ARCHITECTURE §5: 0x01||eph_pub(32)||nonce(12)||ct||tag; key=HKDF-SHA256(x25519(eph,recipient), salt=empty, info="near-redteam-v1", L=32); ChaCha20-Poly1305, AAD empty',
  ecies: vectors,
  x25519_derivation: {
    spec: 'x25519_sk = HKDF-SHA256(ikm=ed25519 seed, salt="near-redteam", info="x25519-v1:"+account_id, L=32)',
    ed25519_seed: hex.encode(seed), account_id: account, x25519_sk: hex.encode(xsk), x25519_pk: x25519PublicHex(xsk),
  },
};
writeFileSync(resolve(PKG_ROOT, 'test/vectors/ecies.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote test/vectors/ecies.json');
