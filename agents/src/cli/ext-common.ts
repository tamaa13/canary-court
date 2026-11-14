/**
 * Shared helpers for the external-agent CLIs (SKILL.md). External agents use THEIR OWN testnet account:
 * signing keys come from the near-cli legacy keychain (~/.near-credentials/testnet/<account>.json) or from a
 * function-call key file written by `pnpm join --fc-key`. Nothing here is specific to our own agents.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Account, KeyPairSigner, type KeyPairString } from 'near-api-js';
import { config } from '../config.js';
import { hex } from '../crypto/ecies.js';
import { provider } from '../chain/near-contract.js';

export function arg(name: string, argv = process.argv.slice(2)): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
export const flag = (name: string, argv = process.argv.slice(2)) => argv.includes(`--${name}`);
export const positional = (argv = process.argv.slice(2)) => argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !argv[i - 1].includes('=')));

export function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

/** Write a secret file with 0600 permissions (creating parent dirs). */
export function writeSecretFile(path: string, body: string): string {
  const p = resolve(path);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, body, { mode: 0o600 });
  chmodSync(p, 0o600);
  return p;
}

export function readX25519Secret(path: string): Uint8Array {
  if (!existsSync(path)) die(`x25519 key file not found: ${path} (create one with \`pnpm x25519 --out ${path}\`)`);
  const sk = hex.decode(readFileSync(path, 'utf8').trim());
  if (sk.length !== 32) die(`${path} is not a 32-byte hex x25519 secret`);
  return sk;
}

export async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = config.redteamContract): Promise<T> {
  return (await provider().callFunction({ contractId, method, args })) as T;
}

export async function enclavePubkey(): Promise<string> {
  const pk = (await view<{ enclave_pubkey: string }>('get_config')).enclave_pubkey;
  if (!/^[0-9a-f]{64}$/i.test(pk)) die(`contract has no enclave pubkey configured yet (${pk || 'empty'})`);
  return pk.toLowerCase();
}

/**
 * Signer for `account`: `--key fc` uses .keys/<account>.fc.json (function-call key from `pnpm join --fc-key`),
 * otherwise the account's own near-cli legacy keychain key.
 */
export function accountFor(accountId: string, keyKind: 'fc' | 'full' = 'full'): Account {
  let secret: string;
  if (keyKind === 'fc') {
    const p = join(config.keysDir, `${accountId}.fc.json`);
    if (!existsSync(p)) die(`no function-call key file ${p} (run \`pnpm join --account ${accountId} --role … --fc-key\`)`);
    secret = JSON.parse(readFileSync(p, 'utf8')).private_key;
  } else {
    const p = join(config.legacyKeychain, `${accountId}.json`);
    if (!existsSync(p)) die(`no near-cli legacy keychain key ${p} (create the account with near-cli … save-to-legacy-keychain)`);
    secret = JSON.parse(readFileSync(p, 'utf8')).private_key;
  }
  return new Account(accountId, provider(), KeyPairSigner.fromSecretKey(secret as KeyPairString));
}

export function txLink(hash: string): string {
  return `${config.explorer}/txns/${hash}`;
}

// ---------------------------------------------------------------- `join --new` (faucet onboarding) ----

export { faucetCreateArgs, newTestnetAccountId, redactSecrets } from '../util/names.js';

const missing = (e: unknown, kind: 'Account' | 'AccessKey') =>
  (e as Error)?.constructor?.name === `${kind}DoesNotExistError` || /does not exist/i.test(String((e as Error)?.message ?? e));

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await provider().viewAccount({ accountId, blockQuery: { finality: 'optimistic' } });
    return true;
  } catch (e) {
    if (missing(e, 'Account')) return false;
    throw e;
  }
}

export async function accessKeyExists(accountId: string, publicKey: string): Promise<boolean> {
  try {
    await provider().viewAccessKey({ accountId, publicKey, finalityQuery: { finality: 'optimistic' } });
    return true;
  } catch (e) {
    if (missing(e, 'AccessKey')) return false;
    throw e;
  }
}
