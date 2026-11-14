// ECIES per spec §5: 0x01 || eph_pub(32) || nonce(12) || ciphertext+tag
// key = HKDF-SHA256(ikm = x25519(eph_sk, recipient_pub), salt = empty, info = "near-redteam-v1", L = 32)
// cipher = ChaCha20-Poly1305, AAD empty. Wire encoding: standard base64.
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes, bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const INFO = utf8ToBytes('near-redteam-v1');
const ECIES_VERSION = 0x01;
const ECIES_OVERHEAD = 1 + 32 + 12 + 16;

export interface X25519Pair {
  sk: string; // hex
  pk: string; // hex
}

export function x25519Keygen(): X25519Pair {
  const sk = x25519.utils.randomSecretKey();
  return { sk: bytesToHex(sk), pk: bytesToHex(x25519.getPublicKey(sk)) };
}

export function x25519PubOf(skHex: string): string {
  return bytesToHex(x25519.getPublicKey(hexToBytes(skHex)));
}

function deriveKey(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, new Uint8Array(0), INFO, 32);
}

export function encrypt(recipientPubHex: string, data: Uint8Array | string | object, eph?: { sk: Uint8Array; nonce: Uint8Array }): string {
  const plain =
    data instanceof Uint8Array ? data : utf8ToBytes(typeof data === 'string' ? data : JSON.stringify(data));
  const ephSk = eph?.sk ?? x25519.utils.randomSecretKey();
  const ephPk = x25519.getPublicKey(ephSk);
  const key = deriveKey(x25519.getSharedSecret(ephSk, hexToBytes(recipientPubHex)));
  const nonce = eph?.nonce ?? randomBytes(12);
  const ct = chacha20poly1305(key, nonce).encrypt(plain);
  const out = new Uint8Array(1 + 32 + 12 + ct.length);
  out[0] = ECIES_VERSION;
  out.set(ephPk, 1);
  out.set(nonce, 33);
  out.set(ct, 45);
  return toB64(out);
}

export function decrypt(recipientSkHex: string, b64: string): Uint8Array {
  const buf = fromB64(b64);
  if (buf.length < ECIES_OVERHEAD || buf[0] !== ECIES_VERSION) throw new Error('ECIES: bad envelope');
  const ephPk = buf.subarray(1, 33);
  const nonce = buf.subarray(33, 45);
  const key = deriveKey(x25519.getSharedSecret(hexToBytes(recipientSkHex), ephPk));
  return chacha20poly1305(key, nonce).decrypt(buf.subarray(45));
}

export function decryptJson<T = unknown>(recipientSkHex: string, b64: string): T {
  return JSON.parse(new TextDecoder().decode(decrypt(recipientSkHex, b64))) as T;
}

/** Structural check only (no key): version byte + minimum length. */
export function looksLikeEcies(b64: string | null | undefined): boolean {
  if (!b64) return false;
  try {
    const buf = fromB64(b64);
    return buf.length >= ECIES_OVERHEAD && buf[0] === ECIES_VERSION;
  } catch {
    return false;
  }
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export { bytesToHex, hexToBytes, randomBytes };
