/**
 * Key handling. Two strictly separated paths (README → Security):
 *
 *  SETUP (one-time, `pnpm setup:testnet`): reads the account's FULL-ACCESS key from the legacy
 *  keychain (~/.near-credentials/testnet/<account>.json), derives the agent's x25519 encryption key
 *     x25519_sk = HKDF-SHA256(ikm = ed25519 seed of FA key, salt = "near-redteam",
 *                             info = "x25519-v1:" + account_id, L = 32)
 *  and writes it to agents/.keys/<account>.x25519 (0600). It also creates a function-call key
 *  scoped to the redteam contract and writes it to agents/.keys/<account>.fc.json (0600).
 *
 *  RUNTIME (agents): loads ONLY .keys/<account>.fc.json + .keys/<account>.x25519. It never opens the
 *  legacy keychain, and `assertFunctionCallOnly` fails closed if the loaded key is full-access on chain.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { baseDecode } from 'near-api-js';
import { config } from '../config.js';
import { hex, x25519PublicHex } from './ecies.js';

const te = new TextEncoder();

/** Derive the dedicated x25519 secret from a 32-byte ed25519 seed (PM decision, 2026-11-13). */
export function deriveX25519Secret(ed25519Seed: Uint8Array, accountId: string): Uint8Array {
  if (ed25519Seed.length !== 32) throw new Error('ed25519 seed must be 32 bytes');
  return hkdf(sha256, ed25519Seed, te.encode('near-redteam'), te.encode(`x25519-v1:${accountId}`), 32);
}

/** ed25519 seed from a NEAR secret key string `ed25519:<base58(seed||pub)>`. */
export function seedFromNearSecret(secret: string): Uint8Array {
  const [curve, body] = secret.split(':');
  if (curve !== 'ed25519' || !body) throw new Error('expected ed25519:<base58> secret key');
  const raw = baseDecode(body);
  if (raw.length !== 64 && raw.length !== 32) throw new Error(`unexpected ed25519 secret length ${raw.length}`);
  return raw.slice(0, 32);
}

// ---------------------------------------------------------------- setup-only (full-access) ----

interface LegacyKeyFile {
  account_id?: string;
  public_key: string;
  private_key: string;
}

/** SETUP ONLY. Reads a full-access key from the near-cli legacy keychain. */
export function readFullAccessKeyForSetup(accountId: string): LegacyKeyFile {
  const p = join(config.legacyKeychain, `${accountId}.json`);
  if (!existsSync(p)) throw new Error(`no full-access key for ${accountId} at ${p}`);
  return JSON.parse(readFileSync(p, 'utf8')) as LegacyKeyFile;
}

function writeSecret(path: string, body: string): void {
  mkdirSync(config.keysDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export const keyPaths = (accountId: string) => ({
  fc: join(config.keysDir, `${accountId}.fc.json`),
  x25519: join(config.keysDir, `${accountId}.x25519`),
});

export function writeX25519(accountId: string, sk: Uint8Array): string {
  writeSecret(keyPaths(accountId).x25519, hex.encode(sk) + '\n');
  return x25519PublicHex(sk);
}

export interface FcKeyFile {
  account_id: string;
  public_key: string;
  private_key: string;
  receiver_id: string;
  method_names: string[];
}

export function writeFcKey(k: FcKeyFile): void {
  writeSecret(keyPaths(k.account_id).fc, JSON.stringify(k, null, 2) + '\n');
}

// ---------------------------------------------------------------- runtime (function-call only) ----

export interface RuntimeKeys {
  accountId: string;
  fc: FcKeyFile;
  x25519Sk: Uint8Array;
  x25519Pk: string;
}

/** RUNTIME. Loads only the scoped FC key and the x25519 key. Never touches ~/.near-credentials. */
export function loadRuntimeKeys(accountId: string): RuntimeKeys {
  const p = keyPaths(accountId);
  if (!existsSync(p.fc) || !existsSync(p.x25519)) {
    throw new Error(`missing runtime keys for ${accountId} in ${config.keysDir} — run \`pnpm setup:testnet\` first`);
  }
  const fc = JSON.parse(readFileSync(p.fc, 'utf8')) as FcKeyFile;
  if (fc.account_id !== accountId) throw new Error(`key file account mismatch: ${fc.account_id} != ${accountId}`);
  if (fc.receiver_id !== config.redteamContract) {
    throw new Error(`FAIL CLOSED: ${accountId} FC key is scoped to ${fc.receiver_id}, expected ${config.redteamContract}`);
  }
  const x25519Sk = hex.decode(readFileSync(p.x25519, 'utf8').trim());
  if (x25519Sk.length !== 32) throw new Error(`bad x25519 key for ${accountId}`);
  return { accountId, fc, x25519Sk, x25519Pk: x25519PublicHex(x25519Sk) };
}

/** Shape of `view_access_key` permission as returned by near-api-js. */
type AccessKeyPermissionLike = 'FullAccess' | { FunctionCall: { receiver_id: string; method_names: string[] } } | unknown;

/**
 * FAIL CLOSED: the runtime must never hold a key that can move money. Called at agent startup with
 * the on-chain permission of the key we are about to sign with.
 */
export function assertFunctionCallOnly(accountId: string, permission: AccessKeyPermissionLike, contractId: string): void {
  const p = permission as { FunctionCall?: { receiver_id?: string; receiverId?: string } } | string;
  if (p === 'FullAccess' || (typeof p === 'object' && p !== null && 'FullAccess' in p)) {
    throw new Error(`FAIL CLOSED: ${accountId} runtime key is FULL-ACCESS on chain; refusing to run`);
  }
  const fc = typeof p === 'object' && p !== null ? p.FunctionCall : undefined;
  const receiver = fc?.receiver_id ?? fc?.receiverId;
  if (!fc || receiver !== contractId) {
    throw new Error(`FAIL CLOSED: ${accountId} runtime key is not a function-call key for ${contractId} (got ${JSON.stringify(permission)})`);
  }
}
