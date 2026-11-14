/**
 * `pnpm keep-open [--once]`: keeps exactly ONE open Tilly v1 job on the market for outside agents (PM, 2026-11-14).
 * Stateless: everything is derived from chain data, so it can run as a GitHub Actions cron (`--once`) or as a local
 * loop (default, one pass every 60 s). One pass:
 *   1. finds the client's jobs whose target id starts with `tilly-open-` (posts so far, last post time, Open ones);
 *   2. on each Open one: expire it if its deadline passed, else accept the oldest bid that is Allow, has a clean note,
 *      price ≤ 5 tUSDC and is not one of our own agents (*.arifnovrian.testnet);
 *   3. if none is Open any more: post a fresh one (new target id, Tilly v1 sealed to the live model, 10 tUSDC budget,
 *      5/finding, tool_misuse, deadline min(now + 7 d − 5 min, KEEP_OPEN_UNTIL)), within the guards:
 *      ≤ 10 posts in total, ≥ 60 s since the last post, ≥ 1 h left before KEEP_OPEN_UNTIL, client liquid NEAR ≥ 0.5,
 *      escrow ≥ the budget.
 *   After KEEP_OPEN_UNTIL (default 2026-11-21T10:30:00Z) a pass does nothing.
 * Keys: ONLY the client's function-call key, from env (KEEPER_ACCOUNT + KEEPER_FC_KEY, for CI) or from
 * .keys/<client>.fc.json; checked on chain (fail closed) before the first signature. No root or full-access key, and
 * no x25519 secret: the target is sealed to the client's registered x25519 PUBLIC key read from chain.
 * The fresh canary is never logged; it is kept (0600, .keys/keep-open/) only when running locally.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Account, KeyPair, KeyPairSigner, type KeyPairString } from 'near-api-js';
import { config } from '../config.js';
import { encryptJson } from '../crypto/ecies.js';
import { assertFunctionCallOnly } from '../crypto/keys.js';
import { provider, viewAccountLiquid } from '../chain/near-contract.js';
import type { Bid, Job, Verdict } from '../chain/types.js';
import { pickBid } from '../agents/open-market.js';
import { LIVE_TARGET_MODEL, profile } from '../target/index.js';
import { fmtNear, fmtUsdc, NEAR, USDC } from '../util/amount.js';
import { enclavePubkey, txLink, view, writeSecretFile } from './ext-common.js';

const ONCE = process.argv.includes('--once');
/** --dry: read everything, decide, but sign nothing (logs what it would do). */
const DRY = process.argv.includes('--dry');
const FROM_ENV = !!process.env.KEEPER_FC_KEY;
const CLIENT = process.env.KEEPER_ACCOUNT?.trim() || config.accounts.client;
const PREFIX = 'tilly-open-';
const BUDGET = USDC(10);
const REWARD = USDC(5);
const TARGET_CATEGORIES = ['tool_misuse', 'data_exfiltration'];
const JOB_CATEGORIES = ['tool_misuse'];
const MAX_DEADLINE_MS = 604_800_000 - 5 * 60_000; // policy max_deadline_ms − 5 min margin
const UNTIL_MS = Date.parse(process.env.KEEP_OPEN_UNTIL ?? '2026-11-21T10:30:00Z');
const MIN_LEFT_MS = 60 * 60_000;
const MAX_POSTS = Number(process.env.KEEP_OPEN_MAX_POSTS ?? 10);
const MIN_NEAR = NEAR('0.5');
const POLL_MS = 60_000;
const MIN_POST_GAP_MS = 60_000;
const GAS = 50_000_000_000_000n;
const ownAgents = new Set(Object.values(config.accounts));
const isOwnAgent = (a: string) => ownAgents.has(a) || a.endsWith(`.${config.rootAccount}`) || a === config.rootAccount || a === CLIENT;

const LOG = FROM_ENV ? null : join(config.fixturesDir, 'local', 'keep-open.log');
if (LOG) mkdirSync(join(config.fixturesDir, 'local'), { recursive: true });
const log = (s: string) => {
  const line = `${new Date().toISOString()} ${s}`;
  process.stdout.write(line + '\n');
  if (LOG) appendFileSync(LOG, line + '\n');
};
const seen = new Set<string>();
const logOnce = (key: string, s: string) => { if (ONCE || !seen.has(key)) { seen.add(key); log(s); } };

// ---- keys: the client's function-call key only, verified on chain before the first signature
const secret = (FROM_ENV ? process.env.KEEPER_FC_KEY! : (JSON.parse(readFileSync(join(config.keysDir, `${CLIENT}.fc.json`), 'utf8')) as { private_key: string }).private_key).trim();
const publicKey = KeyPair.fromString(secret as KeyPairString).getPublicKey().toString();
const ak = await provider().viewAccessKey({ accountId: CLIENT, publicKey, finalityQuery: { finality: 'final' } });
assertFunctionCallOnly(CLIENT, (ak as { permission: unknown }).permission, config.redteamContract);
const acct = new Account(CLIENT, provider(), KeyPairSigner.fromSecretKey(secret as KeyPairString));

async function call<T = unknown>(method: string, args: Record<string, unknown>): Promise<{ value: T; tx: string }> {
  if (DRY) return { value: -1 as T, tx: `dry-run:${method}` };
  const r = await acct.callFunctionRaw({ contractId: config.redteamContract, methodName: method, args, deposit: 0n, gas: GAS });
  const ok = (r.status as { SuccessValue?: string }).SuccessValue;
  const s = ok ? Buffer.from(ok, 'base64').toString('utf8') : '';
  return { value: (s ? JSON.parse(s) : undefined) as T, tx: r.transaction.hash as string };
}

async function listAllJobs(): Promise<Job[]> {
  const out: Job[] = [];
  for (let from = 0; ; from += 50) {
    const page = (await view<Job[]>('list_jobs', { from, limit: 50 })) ?? [];
    out.push(...page);
    if (page.length < 50) return out;
  }
}

async function postJob(n: number, deadline: number): Promise<void> {
  const targetId = `${PREFIX}${Math.floor(Date.now() / 1000)}`;
  const agent = await view<{ x25519_pubkey: string } | null>('get_agent', { account_id: CLIENT });
  if (!agent || !/^[0-9a-f]{64}$/i.test(agent.x25519_pubkey)) throw new Error(`${CLIENT} has no registered x25519 key`);
  const prof = profile('treasury');
  const canary = prof.newCanary();
  const enc = encryptJson(await enclavePubkey(), { system_prompt: prof.systemPrompt(canary, 'v1'), canary, model: LIVE_TARGET_MODEL, client_pubkey: agent.x25519_pubkey.toLowerCase() });
  if (!FROM_ENV && !DRY) writeSecretFile(join(config.keysDir, 'keep-open', `${targetId}.canary`), canary + '\n');
  const t = await call('register_target', { target_id: targetId, enc_target: enc, categories: TARGET_CATEGORIES });
  const j = await call<number>('create_job', { target_id: targetId, budget: BUDGET.toString(), reward_per_finding: REWARD.toString(), categories: JOB_CATEGORIES, deadline_ms: deadline });
  log(`posted job #${j.value} (${n}/${MAX_POSTS}) target ${targetId} (Tilly v1, ${LIVE_TARGET_MODEL}) budget ${fmtUsdc(BUDGET)} reward ${fmtUsdc(REWARD)} deadline ${new Date(deadline).toISOString()} target-tx ${txLink(t.tx)} job-tx ${txLink(j.tx)}`);
}

/** One pass. Returns false when the watcher should stop for good (cap reached, funds low, period over). */
async function pass(): Promise<boolean> {
  const now = Date.now();
  if (now >= UNTIL_MS) { log(`noop: keeper period ended at ${new Date(UNTIL_MS).toISOString()}`); return false; }
  const mine = (await listAllJobs()).filter((j) => j.client === CLIENT && j.target_id.startsWith(PREFIX));
  const lastPost = Math.max(0, ...mine.map((j) => j.created_ms));
  let live = 0;
  for (const job of mine.filter((j) => j.status === 'Open')) {
    if (job.deadline_ms <= now) {
      if (job.pending > 0) { logOnce(`pending:${job.id}`, `skipped expire of job #${job.id}: ${job.pending} evaluation(s) pending`); continue; }
      const r = await call('expire_job', { job_id: job.id });
      log(`expired job #${job.id} (deadline passed with no accepted bid) tx ${txLink(r.tx)}`);
      continue;
    }
    const bids = (await view<Bid[]>('get_bids', { job_id: job.id })) ?? [];
    const verdicts = new Map<string, Verdict>();
    for (const b of bids.filter((x) => x.status === 'Open')) verdicts.set(b.bidder, await view<Verdict>('check_counterparty', { account_id: b.bidder }));
    const d = pickBid(bids, verdicts, REWARD, isOwnAgent);
    for (const s of d.skipped) logOnce(`${job.id}:${s.bidder}:${s.reason}`, `skipped job #${job.id} bidder ${s.bidder}: ${s.reason}${s.retry ? ' (will retry)' : ''}`);
    if (d.accept) {
      try {
        const r = await call('accept_bid', { job_id: job.id, bidder: d.accept.bidder });
        log(`accepted job #${job.id} bidder ${d.accept.bidder} price ${fmtUsdc(d.accept.price_per_finding)} tx ${txLink(r.tx)}`);
        continue; // now Assigned: no longer live
      } catch (e) {
        log(`skipped job #${job.id} bidder ${d.accept.bidder}: accept failed (${String((e as Error).message ?? e).match(/ERR_[A-Z_]+[^"\\]*/)?.[0] ?? (e as Error).message})`);
      }
    }
    live++;
    if (ONCE) log(`noop: job #${job.id} is Open (${bids.filter((b) => b.status === 'Open').length} open bid(s), none eligible), ${Math.round((job.deadline_ms - now) / 3_600_000)} h left`);
  }
  if (live > 0) return true;

  // no live tilly-open job: post a fresh one within the guards
  if (mine.length >= MAX_POSTS) { log(`stop: cap reached (${mine.length} ${PREFIX}* jobs posted, max ${MAX_POSTS})`); return false; }
  if (now - lastPost < MIN_POST_GAP_MS) { log(`skipped post: last post ${Math.round((now - lastPost) / 1000)} s ago (< 60 s)`); return true; }
  const deadline = Math.min(now + MAX_DEADLINE_MS, UNTIL_MS);
  if (deadline - now < MIN_LEFT_MS) { log(`stop: less than 1 h left before ${new Date(UNTIL_MS).toISOString()}; not posting`); return false; }
  const liquid = await viewAccountLiquid(CLIENT);
  if (liquid < MIN_NEAR) { log(`stop: client liquid NEAR ${fmtNear(liquid)} < ${fmtNear(MIN_NEAR)}`); return false; }
  const bal = await view<{ usdc: string }>('balance_of', { account_id: CLIENT });
  if (BigInt(bal.usdc) < BUDGET) { log(`stop: client escrow ${fmtUsdc(bal.usdc)} can't cover the next ${fmtUsdc(BUDGET)} job`); return false; }
  await postJob(mine.length + 1, deadline);
  return true;
}

log(`keep-open ${ONCE ? 'single pass' : 'watcher'}${DRY ? ' (DRY: nothing is signed)' : ''} for ${CLIENT} (fc key verified on chain${FROM_ENV ? ', keys from env' : ''}; until ${new Date(UNTIL_MS).toISOString()})`);
if (ONCE) {
  try {
    await pass();
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 300);
    log(`error: ${msg}`);
    if (process.env.GITHUB_ACTIONS) process.stdout.write(`::warning::keep-open error: ${msg}\n`);
  }
} else {
  for (;;) {
    let go = true;
    try {
      go = await pass();
    } catch (e) {
      log(`error: ${String((e as Error).message ?? e).slice(0, 300)} (retrying in ${POLL_MS / 1000} s)`);
    }
    if (!go) break;
    await sleep(POLL_MS);
  }
}
