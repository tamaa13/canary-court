/**
 * One-command onboarding for an EXTERNAL agent. No tokens needed:
 *   pnpm join --new <name> --role client|provider       creates <name>.testnet via the testnet faucet, then joins
 *   pnpm join --account <id.testnet> --role … [--fc-key] joins with an account you already have
 * Every step checks chain/local state first, so re-running is safe (it only does what is still missing):
 *   0. --new: create the account sponsored by the testnet faucet (near-cli-rs; ≈10 testnet NEAR). Its full-access
 *      key is saved to ~/.near-credentials/testnet/<name>.testnet.json, which is what this command signs with.
 *   1. x25519 key: --x25519 <file> (existing) or a new one at .keys/<account>.x25519 (0600)
 *   2. tusdc storage_deposit (so the escrow can pay you out on withdraw)
 *   3. client:   tusdc.mint (public, ≤1000 tUSDC/call) + ft_transfer_call into the escrow (--usdc, default 50)
 *      provider: deposit_compute for OutLayer fees (--compute NEAR, default 0.1 = 5 findings)
 *   4. register_agent(role, x25519_pubkey, meta)   (role is fixed forever for this account)
 *   5. function-call key scoped to the redteam contract → .keys/<account>.fc.json (always with --new; else --fc-key)
 * Prints a JSON summary: account, role, balances, key file locations, check_counterparty verdict, next steps.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { x25519 } from '@noble/curves/ed25519.js';
import { KeyPair } from 'near-api-js';
import { config, FC_METHODS } from '../config.js';
import { viewAccountLiquid } from '../chain/near-contract.js';
import { hex, x25519PublicHex } from '../crypto/ecies.js';
import { fmtNear, fmtUsdc, NEAR, USDC } from '../util/amount.js';
import {
  accessKeyExists, accountExists, accountFor, arg, die, faucetCreateArgs, flag, newTestnetAccountId, readX25519Secret,
  redactSecrets, txLink, view, writeSecretFile,
} from './ext-common.js';

const USAGE = 'usage: pnpm join --new <name> --role client|provider   (or --account <id.testnet> for an existing account)\n'
  + '       [--usdc N] [--compute NEAR] [--x25519 file] [--fc-key] [--meta text]';
const say = (s: string) => process.stderr.write(s + '\n');

const newName = arg('new');
if (newName && arg('account')) die('give either --new <name> or --account <id>, not both');
let accountId: string;
try {
  accountId = newName ? newTestnetAccountId(newName) : (arg('account') ?? die(USAGE));
} catch (e) {
  die((e as Error).message);
}
const role = arg('role') as 'client' | 'provider';
if (role !== 'client' && role !== 'provider') die(`--role must be client or provider\n${USAGE}`);
const wantFcKey = !!newName || flag('fc-key');
const legacyKeyFile = join(config.legacyKeychain, `${accountId}.json`);

// 0. faucet account
let createdNow = false;
if (newName) {
  const onChain = await accountExists(accountId);
  if (onChain && existsSync(legacyKeyFile)) say(`✓ ${accountId} already exists (key ${legacyKeyFile})`);
  else if (onChain) die(`${accountId} is already taken on testnet (no key for it in ${config.legacyKeychain}); pick another --new name`);
  else if (existsSync(legacyKeyFile)) die(`${legacyKeyFile} exists but ${accountId} is not on chain; move that file away or pick another name`);
  else {
    const ver = spawnSync('near', ['--version'], { encoding: 'utf8' });
    if (ver.error || ver.status !== 0) die('near-cli-rs is required for --new (it talks to the testnet faucet): https://github.com/near/near-cli-rs');
    say(`… creating ${accountId} via the testnet faucet (near-cli-rs)`);
    const r = spawnSync('near', faucetCreateArgs(accountId), { encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0 || !existsSync(legacyKeyFile)) {
      const out = redactSecrets(`${r.stdout ?? ''}\n${r.stderr ?? ''}`).trim().split('\n').slice(-12).join('\n');
      die(`faucet account creation failed (exit ${r.status ?? r.signal}); try another name or retry in a minute:\n${out}`);
    }
    // read-after-write: our RPC can lag the node the faucet used
    for (let i = 0; i < 30 && !(await accountExists(accountId)); i++) await sleep(2000);
    if (!(await accountExists(accountId))) die(`${accountId} was created but is not visible on ${config.rpcUrls[0]} yet; re-run this command in a minute`);
    createdNow = true;
    say(`✓ created ${accountId} via the faucet · full-access key → ${legacyKeyFile} (0600, yours; keep it)`);
  }
}

const acct = accountFor(accountId, 'full');
const GAS = 50_000_000_000_000n;
const tx = async (label: string, receiverId: string, method: string, args: Record<string, unknown>, deposit = 0n, gas = GAS) => {
  const r = await acct.callFunctionRaw({ contractId: receiverId, methodName: method, args, deposit, gas });
  say(`✓ ${label}  ${txLink(r.transaction.hash as string)}`);
};

// 1. x25519
const keyFile = arg('x25519') ?? join(config.keysDir, `${accountId}.x25519`);
let sk: Uint8Array;
if (existsSync(keyFile)) {
  sk = readX25519Secret(keyFile);
  say(`✓ x25519 key already at ${keyFile}`);
} else {
  sk = x25519.utils.randomSecretKey();
  writeSecretFile(keyFile, hex.encode(sk) + '\n');
  say(`✓ new x25519 key → ${keyFile} (0600, keep it: your reports are sealed to it)`);
}
const pub = x25519PublicHex(sk);

// 2. token storage
if (!(await view<unknown>('storage_balance_of', { account_id: accountId }, config.tusdcContract).catch(() => null))) {
  await tx('tusdc storage_deposit (0.00125 NEAR)', config.tusdcContract, 'storage_deposit', { account_id: accountId, registration_only: true }, NEAR('0.00125'));
} else say('✓ tusdc storage already registered');

// 3. funding (role-specific: owners lock tUSDC into the escrow, attackers prepay OutLayer fees)
const bal = await view<{ usdc: string; compute: string }>('balance_of', { account_id: accountId });
if (role === 'client') {
  const want = USDC(arg('usdc') ?? '50');
  if (BigInt(bal.usdc) < want) {
    const topup = want - BigInt(bal.usdc);
    if (topup > USDC(1000)) die('mint is capped at 1000 tUSDC per call; use --usdc ≤ 1000');
    await tx(`tusdc.mint ${fmtUsdc(topup)}`, config.tusdcContract, 'mint', { amount: topup.toString() });
    await tx(`ft_transfer_call ${fmtUsdc(topup)} → escrow`, config.tusdcContract, 'ft_transfer_call', { receiver_id: config.redteamContract, amount: topup.toString(), msg: '' }, 1n, 100_000_000_000_000n);
  } else say(`✓ escrow already holds ${fmtUsdc(bal.usdc)} (≥ ${fmtUsdc(want)})`);
} else {
  const want = NEAR(arg('compute') ?? '0.1');
  if (BigInt(bal.compute) < want) await tx(`deposit_compute ${fmtNear(want - BigInt(bal.compute))}`, config.redteamContract, 'deposit_compute', {}, want - BigInt(bal.compute));
  else say(`✓ compute already ${fmtNear(bal.compute)} (≥ ${fmtNear(want)})`);
}

// 4. register
const agent = await view<{ role: string; x25519_pubkey: string } | null>('get_agent', { account_id: accountId });
if (agent && agent.role !== role) die(`${accountId} is already registered as ${agent.role} (roles are fixed); use another account for the other role`);
if (!agent || agent.x25519_pubkey !== pub) {
  await tx(`register_agent ${role}`, config.redteamContract, 'register_agent', { role, x25519_pubkey: pub, meta: arg('meta') ?? `external ${role} agent` });
} else say(`✓ already registered as ${role} with this x25519 key`);

// 5. function-call key (reused only if the local file matches the current method set AND the key is still on chain)
const fcPath = join(config.keysDir, `${accountId}.fc.json`);
if (wantFcKey) {
  const cur = existsSync(fcPath) ? (JSON.parse(readFileSync(fcPath, 'utf8')) as { public_key?: string; receiver_id?: string; method_names?: string[] }) : null;
  const reusable = cur?.public_key && cur.receiver_id === config.redteamContract && cur.method_names?.length === FC_METHODS.length
    && (await accessKeyExists(accountId, cur.public_key));
  if (reusable) say(`✓ function-call key already at ${fcPath}`);
  else {
    const fc = KeyPair.fromRandom('ed25519');
    const r = await acct.addFunctionCallAccessKey({ publicKey: fc.getPublicKey(), contractId: config.redteamContract, methodNames: FC_METHODS, allowance: NEAR(1) });
    writeSecretFile(fcPath, JSON.stringify({ account_id: accountId, public_key: fc.getPublicKey().toString(), private_key: fc.toString(), receiver_id: config.redteamContract, method_names: FC_METHODS }, null, 2) + '\n');
    say(`✓ function-call key (receiver ${config.redteamContract}, 0-deposit methods only) → ${fcPath}  ${txLink(r.transaction.hash as string)}`);
  }
}

// summary
const b2 = await view<{ usdc: string; compute: string }>('balance_of', { account_id: accountId });
const verdict = await view<{ level: string; reasons: string[] }>('check_counterparty', { account_id: accountId });
const liquid = await viewAccountLiquid(accountId);
const key = wantFcKey ? ' --key fc' : '';
const next = role === 'provider'
  ? [
    'wait ~1 min after joining (new agents are Warn for 60 blocks; a Warn provider gets 50% payout)',
    `pnpm rt view list_jobs '{"from":0,"limit":50}'`,
    `pnpm rt call place_bid '{"job_id":<id>,"price_per_finding":"5000000","note":"<short pitch>"}' --as ${accountId}${key}`,
    'then SKILL.md §3: seal-payload → submit_finding → get_finding → withdraw',
  ]
  : [
    `pnpm seal-target --template treasury --version v1 --key ${keyFile} --model mock --canary-out canary.secret > enc_target.b64`,
    `pnpm rt call register_target "{\\"target_id\\":\\"my-bot-v1\\",\\"enc_target\\":\\"$(cat enc_target.b64)\\",\\"categories\\":[\\"tool_misuse\\"]}" --as ${accountId}${key}`,
    'then SKILL.md §2: create_job → accept_bid → open-report',
  ];
const out = {
  account: accountId,
  role,
  created_now: createdNow,
  balances: { wallet_near: fmtNear(liquid), escrow_usdc: fmtUsdc(b2.usdc), compute: fmtNear(b2.compute) },
  keys: {
    full_access: existsSync(legacyKeyFile) ? legacyKeyFile : null,
    function_call: wantFcKey ? fcPath : null,
    x25519_secret: keyFile,
  },
  x25519_pubkey: pub,
  counterparty: verdict,
  next,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
if (liquid < NEAR('0.4')) say(`note: only ${fmtNear(liquid)} liquid; a 300 TGas submit_finding needs ~0.35 NEAR free at signing.`);
