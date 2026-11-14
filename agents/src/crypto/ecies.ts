/**
 * ECIES used between agents, the contract and the OutLayer enclave (ARCHITECTURE §5).
 *
 *   blob = 0x01 || eph_pub(32) || nonce(12) || ciphertext || tag(16)      (base64, std alphabet, padded)
 *   shared = X25519(eph_sk, recipient_pk)              (all-zero shared secret rejected)
 *   key    = HKDF-SHA256(ikm=shared, salt=empty, info="near-redteam-v1", L=32)
 *   AEAD   = ChaCha20-Poly1305 (IETF, 12-byte nonce), AAD empty
 *
 * Parameters confirmed with rt-enclave; cross-checked by test/vectors/ecies.json.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';

const ECIES_VERSION = 0x01;
const ECIES_INFO = new TextEncoder().encode('near-redteam-v1');
const HEADER = 1 + 32 + 12;
const TAG = 16;

export const hex = {
  encode: (b: Uint8Array) => Buffer.from(b).toString('hex'),
  decode: (s: string): Uint8Array => {
    const clean = s.startsWith('0x') ? s.slice(2) : s;
    if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) throw new Error('invalid hex');
    return new Uint8Array(Buffer.from(clean, 'hex'));
  },
};
export const b64 = {
  encode: (b: Uint8Array) => Buffer.from(b).toString('base64'),
  decode: (s: string) => new Uint8Array(Buffer.from(s, 'base64')),
};

function deriveKey(shared: Uint8Array): Uint8Array {
  if (shared.every((x) => x === 0)) throw new Error('ECIES: all-zero shared secret (low-order point)');
  return hkdf(sha256, shared, undefined, ECIES_INFO, 32);
}

interface EncryptOpts {
  /** Test-only: fixed ephemeral secret key. */
  ephSk?: Uint8Array;
  /** Test-only: fixed nonce. */
  nonce?: Uint8Array;
}

export function encryptBytes(recipientPk: Uint8Array, plaintext: Uint8Array, opts: EncryptOpts = {}): Uint8Array {
  if (recipientPk.length !== 32) throw new Error('ECIES: recipient pubkey must be 32 bytes');
  const ephSk = opts.ephSk ?? x25519.utils.randomSecretKey();
  const ephPk = x25519.getPublicKey(ephSk);
  const nonce = opts.nonce ?? randomBytes(12);
  const key = deriveKey(x25519.getSharedSecret(ephSk, recipientPk));
  const ct = chacha20poly1305(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(HEADER + ct.length);
  out[0] = ECIES_VERSION;
  out.set(ephPk, 1);
  out.set(nonce, 33);
  out.set(ct, HEADER);
  return out;
}

export function decryptBytes(recipientSk: Uint8Array, blob: Uint8Array): Uint8Array {
  if (blob.length < HEADER + TAG) throw new Error('ECIES: blob too short');
  if (blob[0] !== ECIES_VERSION) throw new Error(`ECIES: unsupported version 0x${blob[0].toString(16)}`);
  const ephPk = blob.subarray(1, 33);
  const nonce = blob.subarray(33, HEADER);
  const key = deriveKey(x25519.getSharedSecret(recipientSk, ephPk));
  return chacha20poly1305(key, nonce).decrypt(blob.subarray(HEADER));
}

/** Encrypt a JSON value to a hex x25519 pubkey → base64 blob (the on-chain wire format). */
export function encryptJson(recipientPkHex: string, value: unknown, opts?: EncryptOpts): string {
  const pt = new TextEncoder().encode(JSON.stringify(value));
  return b64.encode(encryptBytes(hex.decode(recipientPkHex), pt, opts));
}

export function decryptJson<T = unknown>(recipientSk: Uint8Array, blobB64: string): T {
  return JSON.parse(new TextDecoder().decode(decryptBytes(recipientSk, b64.decode(blobB64)))) as T;
}

export function x25519PublicHex(sk: Uint8Array): string {
  return hex.encode(x25519.getPublicKey(sk));
}

export function sha256Hex(data: string | Uint8Array): string {
  return hex.encode(sha256(typeof data === 'string' ? new TextEncoder().encode(data) : data));
}

// ---- stable facade for other components (rt-web e2e interop) ----

/** encrypt(pubHex, bytes | JSON value) → base64 blob. Objects are JSON-encoded (UTF-8). */
export function encrypt(recipientPkHex: string, data: Uint8Array | unknown, opts?: EncryptOpts): string {
  const pt = data instanceof Uint8Array ? data : new TextEncoder().encode(JSON.stringify(data));
  return b64.encode(encryptBytes(hex.decode(recipientPkHex), pt, opts));
}

/** decrypt(privHex, base64 blob) → plaintext bytes. Use decryptJson for objects. */
export function decrypt(recipientSkHex: string, blobB64: string): Uint8Array {
  return decryptBytes(hex.decode(recipientSkHex), b64.decode(blobB64));
}
