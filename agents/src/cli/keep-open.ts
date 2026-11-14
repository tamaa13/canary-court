/**
 * `pnpm keep-open`: keeps exactly ONE open Tilly v1 job on the market for outside agents (PM decision, 2026-11-14).
 *   - posts a fresh job (new target id, Tilly v1 sealed to the live model, 10 tUSDC budget, 5/finding, tool_misuse,
 *     deadline now + 7 d − 5 min) whenever the current one is no longer Open;
 *   - auto-accepts the first bid that is Allow, has a clean note, price ≤ 5 tUSDC and is not one of our own agents;
 *   - hard caps: ≤ 10 jobs posted in total (state survives restarts), ≥ 60 s between posts; stops if the client's
 *     liquid NEAR < 0.5 or its escrow can't cover the next job.
 * Signs ONLY with the client's function-call key (.keys/<client>.fc.json, checked on chain); never reads root or
 * full-access keys. One log line per action (posted / accepted / skipped / stop / error), also appended to
 * fixtures/local/keep-open.log. Canaries of the posted targets go to .keys/keep-open/<target>.canary (0600).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config.js';
import { encryptJson, x25519PublicHex } from '../crypto/ecies.js';
import { assertFunctionCallOnly } from '../crypto/keys.js';
import { provider, viewAccountLiquid } from '../chain/near-contract.js';
import type { Bid, Job, Verdict } from '../chain/types.js';
import { pickBid } from '../agents/open-market.js';
import { LIVE_TARGET_MODEL, profile } from '../target/index.js';
import { fmtNear, fmtUsdc, NEAR, USDC } from '../util/amount.js';
import { accountFor, enclavePubkey, readX25519Secret, txLink, view, writeSecretFile } from './ext-common.js';

const CLIENT = config.accounts.client;
const BUDGET = USDC(10);
const REWARD = USDC(5);
const TARGET_CATEGORIES = ['tool_misuse', 'data_exfiltration'];
const JOB_CATEGORIES = ['tool_misuse'];
const DEADLINE_MS = 604_800_000 - 5 * 60_000; // policy max_deadline_ms − 5 min margin
const MAX_POSTS = Number(process.env.KEEP_OPEN_MAX_POSTS ?? 10);
const MIN_NEAR = NEAR('0.5');
const POLL_MS = 60_000;
const MIN_POST_GAP_MS = 60_000;
const GAS = 50_000_000_000_000n;
const STATE = join(config.keysDir, 'keep-open-state.json');
const LOG = join(config.fixturesDir, 'local', 'keep-open.log');
const ownAgents = new Set(Object.values(config.accounts));
const isOwnAgent = (a: string) => ownAgents.has(a) || a.endsWith(`.${config.rootAccount}`) || a === config.rootAccount;

interface State { posts: { job_id: number; target_id: string; posted_ms: number }[]; accepted: { job_id: number; bidder: string; ms: number }[] }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { posts: [], accepted: [] };
const save = () => writeSecretFile(STATE, JSON.stringify(state, null, 2) + '\n');

mkdirSync(join(config.fixturesDir, 'local'), { recursive: true });
const log = (s: string) => {
  const line = `${new Date().toISOString()} ${s}`;
  process.stdout.write(line + '\n');
  appendFileSync(LOG, line + '\n');
};
const seen = new Set<string>();
const logOnce = (key: string, s: string) => { if (!seen.has(key)) { seen.add(key); log(s); } };

// ---- keys: the client's function-call key only, verified on chain before the first signature
const fcFile = JSON.parse(readFileSync(join(config.keysDir, `${CLIENT}.fc.json`), 'utf8')) as { public_key: string; receiver_id: string };
if (fcFile.receiver_id !== config.redteamContract) throw new Error(`FAIL CLOSED: ${CLIENT} FC key is scoped to ${fcFile.receiver_id}`);
const ak = await provider().viewAccessKey({ accountId: CLIENT, publicKey: fcFile.public_key, finalityQuery: { finality: 'final' } });
assertFunctionCallOnly(CLIENT, (ak as { permission: unknown }).permission, config.redteamContract);
const acct = accountFor(CLIENT, 'fc');
const clientPk = x25519PublicHex(readX25519Secret(join(config.keysDir, `${CLIENT}.x25519`)));

async function call<T = unknown>(method: string, args: Record<string, unknown>): Promise<{ value: T; tx: string }> {
  const r = await acct.callFunctionRaw({ contractId: config.redteamContract, methodName: method, args, deposit: 0n, gas: GAS });
  const ok = (r.status as { SuccessValue?: string }).SuccessValue;
  const s = ok ? Buffer.from(ok, 'base64').toString('utf8') : '';
  return { value: (s ? JSON.parse(s) : undefined) as T, tx: r.transaction.hash as string };
}

async function postJob(): Promise<void> {
  const targetId = `tilly-open-${Math.floor(Date.now() / 1000)}`;
  const prof = profile('treasury');
  const canary = prof.newCanary();
  const enc = encryptJson(await enclavePubkey(), { system_prompt: prof.systemPrompt(canary, 'v1'), canary, model: LIVE_TARGET_MODEL, client_pubkey: clientPk });
  writeSecretFile(join(config.keysDir, 'keep-open', `${targetId}.canary`), canary + '\n');
  const t = await call('register_target', { target_id: targetId, enc_target: enc, categories: TARGET_CATEGORIES });
  const deadline = Date.now() + DEADLINE_MS;
  const j = await call<number>('create_job', { target_id: targetId, budget: BUDGET.toString(), reward_per_finding: REWARD.toString(), categories: JOB_CATEGORIES, deadline_ms: deadline });
  state.posts.push({ job_id: j.value, target_id: targetId, posted_ms: Date.now() });
  save();
  log(`posted job #${j.value} (${state.posts.length}/${MAX_POSTS}) target ${targetId} (Tilly v1, ${LIVE_TARGET_MODEL}) budget ${fmtUsdc(BUDGET)} reward ${fmtUsdc(REWARD)} deadline ${new Date(deadline).toISOString()} target-tx ${txLink(t.tx)} job-tx ${txLink(j.tx)}`);
}

let stopped = false;
const stop = (why: string) => { log(`stop: ${why}`); stopped = true; };

async function tick(): Promise<void> {
  const cur = state.posts.at(-1);
  const job = cur ? await view<Job | null>('get_job', { job_id: cur.job_id }) : null;
  if (job && job.status === 'Open') {
    if (job.deadline_ms <= Date.now()) {
      const r = await call('expire_job', { job_id: job.id });
      log(`expired job #${job.id} (deadline passed with no accepted bid) tx ${txLink(r.tx)}`);
      return; // re-post on the next tick
    }
    const bids = (await view<Bid[]>('get_bids', { job_id: job.id })) ?? [];
    const verdicts = new Map<string, Verdict>();
    for (const b of bids.filter((x) => x.status === 'Open')) verdicts.set(b.bidder, await view<Verdict>('check_counterparty', { account_id: b.bidder }));
    const d = pickBid(bids, verdicts, REWARD, isOwnAgent);
    for (const s of d.skipped) logOnce(`${job.id}:${s.bidder}:${s.reason}`, `skipped job #${job.id} bidder ${s.bidder}: ${s.reason}${s.retry ? ' (will retry)' : ''}`);
    if (d.accept) {
      try {
        const r = await call('accept_bid', { job_id: job.id, bidder: d.accept.bidder });
        state.accepted.push({ job_id: job.id, bidder: d.accept.bidder, ms: Date.now() });
        save();
        log(`accepted job #${job.id} bidder ${d.accept.bidder} price ${fmtUsdc(d.accept.price_per_finding)} tx ${txLink(r.tx)}`);
      } catch (e) {
        log(`skipped job #${job.id} bidder ${d.accept.bidder}: accept failed (${String((e as Error).message ?? e).match(/ERR_[A-Z_]+[^"\\]*/)?.[0] ?? (e as Error).message})`);
      }
    }
    return;
  }
  // no job yet, or the current one changed state (Assigned / Expired / Closed): post a fresh one, within the caps
  if (cur && job) logOnce(`state:${job.id}:${job.status}`, `job #${job.id} is now ${job.status}${job.provider ? ` (attacker ${job.provider})` : ''}`);
  if (state.posts.length >= MAX_POSTS) return stop(`cap reached: ${state.posts.length} jobs posted by this watcher (max ${MAX_POSTS})`);
  if (cur && Date.now() - cur.posted_ms < MIN_POST_GAP_MS) return;
  const liquid = await viewAccountLiquid(CLIENT);
  if (liquid < MIN_NEAR) return stop(`client liquid NEAR ${fmtNear(liquid)} < ${fmtNear(MIN_NEAR)}`);
  const bal = await view<{ usdc: string }>('balance_of', { account_id: CLIENT });
  if (BigInt(bal.usdc) < BUDGET) return stop(`client escrow ${fmtUsdc(bal.usdc)} can't cover the next ${fmtUsdc(BUDGET)} job`);
  await postJob();
}

log(`keep-open watcher started for ${CLIENT} (fc key verified on chain; posts so far ${state.posts.length}/${MAX_POSTS})`);
while (!stopped) {
  try {
    await tick();
  } catch (e) {
    log(`error: ${String((e as Error).message ?? e).slice(0, 300)} (retrying in ${POLL_MS / 1000} s)`);
  }
  if (!stopped) await sleep(POLL_MS);
}
