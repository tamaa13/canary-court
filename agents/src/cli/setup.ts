/**
 * `pnpm setup:testnet` — ONE-TIME provisioning. This is the ONLY code that reads full-access keys
 * (~/.near-credentials/testnet/<account>.json). Agents never run this path; at runtime they hold only
 * the function-call key + x25519 key written here to agents/.keys (0600, gitignored).
 *
 * Idempotent. For each agent account:
 *   1. create the sub-account if missing (0.5 NEAR from the root account; FA key saved to the legacy keychain)
 *   2. derive x25519_sk = HKDF-SHA256(FA ed25519 seed, salt "near-redteam", info "x25519-v1:"+account) → .keys/<acct>.x25519
 *   3. add a function-call key (receiver redteam, method list from contracts/DEPLOYMENTS.md, 1 NEAR gas allowance) → .keys/<acct>.fc.json
 *   4. tusdc storage_deposit (so `withdraw` can pay out), deposit_compute (OutLayer fees), client: mint + ft_transfer_call
 *   5. register_agent (signed with the FC key) for client/lead/sub1/sub2 so they age past min_age_blocks.
 *      Mallory accounts are NOT registered here: `pnpm attacks` registers a fresh one to show the Warn path.
 *
 * Flags: --mallory=N (default 2 mallory accounts: mallory, mallory2, …), --plan (print actions only).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Account, KeyPair, KeyPairSigner, type KeyPairString } from 'near-api-js';
import { config, FC_METHODS } from '../config.js';
import { x25519PublicHex } from '../crypto/ecies.js';
import {
  deriveX25519Secret, keyPaths, loadRuntimeKeys, readFullAccessKeyForSetup, seedFromNearSecret, writeFcKey, writeX25519,
} from '../crypto/keys.js';
import { provider } from '../chain/near-contract.js';
import { fmtNear, fmtUsdc, NEAR, USDC } from '../util/amount.js';
import { color, log } from '../util/log.js';

const GAS = 50_000_000_000_000n;
/** Root spend guard (PM rule: ask before spending > 4 NEAR). */
let rootSpent = 0n;
/** Hard cap for this run: --max-spend=<NEAR> (default 1 NEAR). Everything above it needs an explicit OK. */
const MAX_ROOT_SPEND = NEAR(process.argv.find((a) => a.startsWith('--max-spend='))?.split('=')[1] ?? '1');
function spendFromRoot(amount: bigint): void {
  if (rootSpent + amount > MAX_ROOT_SPEND) throw new Error(`refusing: root spend would reach ${fmtNear(rootSpent + amount)} (> --max-spend ${fmtNear(MAX_ROOT_SPEND)}); run with --plan, then ask before raising it`);
  rootSpent += amount;
}

const argv = process.argv.slice(2);
const PLAN = argv.includes('--plan');
const MALLORY_N = Number(argv.find((a) => a.startsWith('--mallory='))?.split('=')[1] ?? 2);

interface Spec {
  name: string;
  id: string;
  role: 'client' | 'provider';
  register: boolean;
  computeNear: string;
  /** tUSDC to keep in the escrow's internal balance (clients only). */
  usdc?: number;
}

const SPECS: Spec[] = [
  { name: 'client', id: config.accounts.client, role: 'client', register: true, computeNear: '0', usdc: 600 },
  { name: 'copycat', id: config.accounts.copycat, role: 'client', register: true, computeNear: '0', usdc: 30 },
  { name: 'lead', id: config.accounts.lead, role: 'provider', register: true, computeNear: '0.3' },
  { name: 'sub1', id: config.accounts.sub1, role: 'provider', register: true, computeNear: '0.2' },
  { name: 'sub2', id: config.accounts.sub2, role: 'provider', register: true, computeNear: '0.2' },
  ...Array.from({ length: MALLORY_N }, (_, i) => ({
    name: `mallory${i ? i + 1 : ''}`, id: `mallory${i ? i + 1 : ''}.${config.rootAccount}`, role: 'provider' as const, register: false, computeNear: '0.1',
  })),
];

const rpc = provider();
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  rpc.callFunction({ contractId, method, args }) as Promise<T>;

async function exists(id: string): Promise<boolean> {
  try {
    await rpc.viewAccount({ accountId: id, blockQuery: { finality: 'final' } });
    return true;
  } catch {
    return false;
  }
}

function faAccount(id: string): Account {
  const fa = readFullAccessKeyForSetup(id);
  return new Account(id, rpc, KeyPairSigner.fromSecretKey(fa.private_key as KeyPairString));
}

async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
  if (PLAN) return log.info(`${color.yellow('plan')} ${label}`);
  const res = (await fn()) as { transaction?: { hash?: string } } | undefined;
  const h = res?.transaction?.hash;
  log.info(`${color.green('✓')} ${label}${h ? color.gray(` https://testnet.nearblocks.io/txns/${h}`) : ''}`);
}

async function main() {
  log.section(`Canary Court · setup:testnet ${PLAN ? '(plan only)' : ''} · root ${config.rootAccount} · contract ${config.redteamContract}`);
  const cfg = await view<{ enclave_pubkey: string; policy: { outlayer_fee: string } }>(config.redteamContract, 'get_config');
  log.info(`contract live; enclave_pubkey ${cfg.enclave_pubkey ? cfg.enclave_pubkey.slice(0, 16) + '…' : color.yellow('(not set yet — submit_finding will fail until set_enclave)')}`);
  const root = faAccount(config.rootAccount);
  const rootBal = BigInt((await rpc.viewAccount({ accountId: config.rootAccount, blockQuery: { finality: 'final' } })).amount);
  const toCreate = [];
  for (const s of SPECS) if (!(await exists(s.id))) toCreate.push(s);
  const spend = NEAR('0.5') * BigInt(toCreate.length);
  log.info(`root balance ${fmtNear(rootBal)}; will create ${toCreate.length} account(s) [${toCreate.map((s) => s.name).join(', ')}] costing ${fmtNear(spend)}`);
  if (spend > MAX_ROOT_SPEND) throw new Error(`refusing: account creation alone would exceed --max-spend ${fmtNear(MAX_ROOT_SPEND)}`);

  for (const s of SPECS) {
    log.agent(s.name, color.bold(s.id));
    // 1. account
    if (toCreate.includes(s)) {
      const kp = KeyPair.fromRandom('ed25519');
      const legacy = join(config.legacyKeychain, `${s.id}.json`);
      if (!PLAN) {
        mkdirSync(config.legacyKeychain, { recursive: true });
        if (!existsSync(legacy)) writeFileSync(legacy, JSON.stringify({ account_id: s.id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }) + '\n', { mode: 0o600 });
      }
      if (!PLAN) spendFromRoot(NEAR('0.5'));
      await step(`create ${s.id} (0.5 NEAR, FA key → legacy keychain)`, () => root.createSubAccount({ accountOrPrefix: s.id, publicKey: kp.getPublicKey(), nearToTransfer: NEAR('0.5') }));
      if (PLAN) continue;
    }
    const fa = readFullAccessKeyForSetup(s.id);
    let akFa = null;
    for (let i = 0; i < 10 && !akFa; i++) {
      akFa = await rpc.viewAccessKey({ accountId: s.id, publicKey: fa.public_key, finalityQuery: { finality: 'optimistic' } }).catch(() => null);
      if (!akFa) await new Promise((r) => setTimeout(r, 1500)); // fresh account: wait for the block to land
    }
    if (!akFa || (akFa as { permission: unknown }).permission !== 'FullAccess') throw new Error(`${s.id}: legacy keychain key is not a full-access key on chain`);
    const acct = faAccount(s.id);

    // 2. x25519 (derived from the FA seed; written once)
    const xsk = deriveX25519Secret(seedFromNearSecret(fa.private_key), s.id);
    if (!PLAN) {
      const pk = writeX25519(s.id, xsk);
      log.info(`${color.green('✓')} x25519 ${pk.slice(0, 16)}… → ${keyPaths(s.id).x25519}`);
    }

    // 3. function-call key scoped to redteam
    let haveFc = false;
    let staleFc: string | null = null;
    if (existsSync(keyPaths(s.id).fc)) {
      try {
        const k = loadRuntimeKeys(s.id);
        const onChain = !!(await rpc.viewAccessKey({ accountId: s.id, publicKey: k.fc.public_key, finalityQuery: { finality: 'final' } }).catch(() => null));
        const complete = FC_METHODS.every((m) => k.fc.method_names.includes(m));
        haveFc = onChain && complete;
        if (onChain && !complete) staleFc = k.fc.public_key; // method list changed (e.g. withdraw_compute added) → rotate
      } catch {
        haveFc = false;
      }
    }
    if (!haveFc) {
      const fc = KeyPair.fromRandom('ed25519');
      await step(`add FC key ${fc.getPublicKey().toString().slice(0, 20)}… receiver=${config.redteamContract}, 1 NEAR gas allowance, ${FC_METHODS.length} methods`, () =>
        acct.addFunctionCallAccessKey({ publicKey: fc.getPublicKey(), contractId: config.redteamContract, methodNames: FC_METHODS, allowance: NEAR(1) }));
      if (!PLAN) writeFcKey({ account_id: s.id, public_key: fc.getPublicKey().toString(), private_key: fc.toString(), receiver_id: config.redteamContract, method_names: FC_METHODS });
      if (staleFc) await step(`delete rotated FC key ${staleFc.slice(0, 20)}…`, () => acct.deleteKey(staleFc!));
    } else log.info(`${color.green('✓')} FC key present (${keyPaths(s.id).fc})`);

    // 4a. tusdc storage so withdraw() can pay out to this account
    const storage = await view<unknown>(config.tusdcContract, 'storage_balance_of', { account_id: s.id }).catch(() => null);
    if (!storage) await step('tusdc storage_deposit (0.00125 NEAR)', () => acct.callFunctionRaw({ contractId: config.tusdcContract, methodName: 'storage_deposit', args: { account_id: s.id, registration_only: true }, deposit: NEAR('0.00125'), gas: GAS }));
    else log.info(`${color.green('✓')} registered on tusdc`);

    // 4b. compute balance for OutLayer fees
    const bal = await view<{ usdc: string; compute: string }>(config.redteamContract, 'balance_of', { account_id: s.id });
    if (NEAR(s.computeNear) > 0n && BigInt(bal.compute) < NEAR(s.computeNear) / 2n) {
      await step(`deposit_compute ${s.computeNear} NEAR (≈${Math.floor(Number(s.computeNear) / 0.02)} OutLayer fees)`, () => acct.callFunctionRaw({ contractId: config.redteamContract, methodName: 'deposit_compute', args: {}, deposit: NEAR(s.computeNear), gas: GAS }));
    } else if (NEAR(s.computeNear) > 0n) log.info(`${color.green('✓')} compute ${fmtNear(bal.compute)}`);

    // 4b'. attackers need liquid NEAR to prepay 300 TGas per submit_finding (~0.3 NEAR, reserved until the OutLayer
    // callback lands ~1–2 min later). Lead/subs submit 2 back-to-back (≤2 in flight) → ≥0.65; mallory submits sequentially.
    if (s.role === 'provider' && !PLAN) {
      const floor = s.name.startsWith('mallory') ? NEAR('0.35') : NEAR('0.65');
      await new Promise((r) => setTimeout(r, 1500));
      const av = await rpc.viewAccount({ accountId: s.id, blockQuery: { finality: 'optimistic' } });
      const liquid = BigInt(av.amount) - BigInt(av.storage_usage) * 10n ** 19n;
      if (liquid < floor) {
        spendFromRoot(NEAR('0.5'));
        await step(`top up 0.5 NEAR from root (liquid ${fmtNear(liquid)} < ${fmtNear(floor)} to prepay 2 × 300 TGas in flight)`, () => root.transfer({ receiverId: s.id, amount: NEAR('0.5') }));
      } else log.info(`${color.green('✓')} liquid ${fmtNear(liquid)}`);
    }

    // 4c. client: mint tUSDC and move it into the escrow's internal balance (ft_transfer_call, 1 yocto)
    if (s.usdc && BigInt(bal.usdc) < USDC(s.usdc / 2)) {
      const wallet = BigInt(await view<string>(config.tusdcContract, 'ft_balance_of', { account_id: s.id }).catch(() => '0'));
      if (wallet < USDC(s.usdc)) await step('tusdc.mint 1000 tUSDC', () => acct.callFunctionRaw({ contractId: config.tusdcContract, methodName: 'mint', args: { amount: USDC(1000).toString() }, gas: GAS }));
      else log.info(`${color.green('✓')} wallet holds ${fmtUsdc(wallet)} (no mint needed)`);
      await step(`tusdc.ft_transfer_call ${s.usdc} tUSDC → redteam (msg "")`, () => acct.callFunctionRaw({ contractId: config.tusdcContract, methodName: 'ft_transfer_call', args: { receiver_id: config.redteamContract, amount: USDC(s.usdc!).toString(), msg: '' }, deposit: 1n, gas: GAS }));
    } else if (s.usdc) log.info(`${color.green('✓')} internal balance ${fmtUsdc(bal.usdc)}`);

    // 5. register with the FC key (proves the runtime key works; starts the reputation age clock)
    if (s.register && !PLAN) {
      const agent = await view<{ x25519_pubkey: string } | null>(config.redteamContract, 'get_agent', { account_id: s.id });
      if (agent?.x25519_pubkey === x25519PublicHex(xsk)) log.info(`${color.green('✓')} registered as ${s.role}`);
      else {
        const k = loadRuntimeKeys(s.id);
        const fcAcct = new Account(s.id, rpc, KeyPairSigner.fromSecretKey(k.fc.private_key as KeyPairString));
        await step(`register_agent ${s.role} (signed with FC key)`, () => fcAcct.callFunctionRaw({ contractId: config.redteamContract, methodName: 'register_agent', args: { role: s.role, x25519_pubkey: k.x25519Pk, meta: JSON.stringify({ agent: s.name }) }, gas: GAS }));
      }
    }
  }
  log.section(`setup done · spent ${fmtNear(rootSpent)} from root this run`);
  log.info(`runtime keys in ${config.keysDir} (0600, gitignored). Next: pnpm demo  ·  pnpm attacks`);
}

main().catch((e) => {
  log.fail(`setup failed: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
