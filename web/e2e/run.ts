// e2e entrypoint.
//   pnpm e2e:mock                       # offline, in-process mock of the spec (instant)
//   pnpm e2e:testnet --yes              # live testnet: creates & funds 6 throwaway accounts, ~12 min
// Flags: --only=05,08 (areas or step ids; dependencies auto-included) --keep (no teardown)
//        --receipts=<path> (default ../agents/fixtures/attack-receipts.json) --run=<id>
// Env:   ROOT_ACCOUNT, REDTEAM_CONTRACT, TUSDC_CONTRACT, NEAR_RPC_URL, E2E_*_S timings
//        E2E_TARGET_MODEL: 'mock' (default: enclave's deterministic target on real OutLayer, no NEAR AI spend)
//                          or a NEAR AI model id, e.g. Qwen/Qwen3.6-35B-A3B-FP8 (live TEE inference, ~7 calls/run)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockChain, TestnetChain, type Chain } from './harness/chain';
import { makeCtx, ACTORS, AMOUNTS } from './harness/ctx';
import { runSteps } from './harness/suite';
import { renderMarkdown } from './harness/report';
import { steps } from './tests/steps';
import { MockNet } from '../lib/mock-net';
import { fmtNear } from '../lib/amount';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const val = (name: string) => flag(name)?.split('=').slice(1).join('=');

async function main() {
  const target = (val('target') ?? 'mock') as 'mock' | 'testnet';
  const run = val('run') ?? Date.now().toString(36).slice(-6);
  const root = process.env.ROOT_ACCOUNT ?? 'arifnovrian.testnet';
  const contractId = process.env.REDTEAM_CONTRACT ?? `redteam.${root}`;
  const tokenId = process.env.TUSDC_CONTRACT ?? `tusdc.${root}`;
  const only = val('only') ? new Set(val('only')!.split(',').map((s) => s.trim().padStart(2, '0'))) : undefined;
  const log = (s: string) => console.log(s);

  let chain: Chain;
  // merged repo: ../agents next to web/; split worktrees: the agents checkout
  const receiptCandidates = [join(HERE, '..', '..', 'agents', 'fixtures', 'attack-receipts.json'), join(homedir(), 'projects', 'near-redteam-agents', 'agents', 'fixtures', 'attack-receipts.json')];
  let receiptsPath = resolve(val('receipts') ?? receiptCandidates.find((p) => existsSync(p)) ?? receiptCandidates[0]);
  if (target === 'testnet') {
    const near = Object.values(AMOUNTS.initialNear).reduce((a, b) => a + b, 0n);
    if (!flag('yes')) {
      console.log(`Live testnet run against ${contractId}.`);
      console.log(`Creates ${ACTORS.length} accounts e${run}-*.${root}, moving ~${fmtNear(near)} NEAR from ${root} (most is returned at teardown; ~0.2 NEAR is spent on fees).`);
      console.log('Re-run with --yes to proceed.');
      process.exit(2);
    }
    const tc = new TestnetChain(root, contractId, tokenId, join(HERE, '.keys'), process.env.NEAR_RPC_URL ? [process.env.NEAR_RPC_URL] : undefined);
    await tc.init();
    chain = tc;
  } else {
    chain = new MockChain(new MockNet({ root, contractId, tokenId }));
    receiptsPath = join(HERE, '.state', `mock-receipts-${run}.json`);
  }

  const ctx = makeCtx(chain, run, { keep: !!flag('keep'), receiptsPath, model: process.env.E2E_TARGET_MODEL ?? 'mock' });
  const startedAt = new Date();
  log(`Canary Court e2e · run ${run} · ${target} · ${contractId}`);
  const results = await runSteps(steps, ctx, log, only);
  const finishedAt = new Date();

  let contractCodeHash: string | null = null;
  let enclaveHash: string | null = null;
  let enclavePubkey: string | null = null;
  let enclaveVersion: string | null = null;
  if (chain instanceof TestnetChain) {
    try {
      contractCodeHash = b58ToHex((await chain.rpc.viewAccount(contractId)).code_hash);
      const cfg = await chain.view<{ enclave_code?: { WasmUrl?: { hash?: string } }; enclave_pubkey?: string }>('get_config');
      enclaveHash = cfg.enclave_code?.WasmUrl?.hash ?? null;
      enclavePubkey = cfg.enclave_pubkey ?? null;
      enclaveVersion = enclaveHash ? enclaveVersionOf(enclaveHash) : null;
    } catch (e) {
      log(`(could not read deployment hashes: ${(e as Error).message})`);
    }
  }
  const md = renderMarkdown(results, { run, chain, startedAt, finishedAt, accounts: ctx.acct, receiptsPath, infraTimeouts: ctx.infraTimeouts, contractCodeHash, enclaveHash, enclavePubkey, enclaveVersion });
  const dir = join(HERE, 'reports');
  mkdirSync(dir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(dir, `${stamp}-${target}-${run}.md`);
  writeFileSync(file, md);
  writeFileSync(join(dir, `latest-${target}.md`), md);
  writeFileSync(join(dir, `latest-${target}.json`), JSON.stringify({ run, target, startedAt, finishedAt, results }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  const failed = results.filter((r) => r.status === 'fail' || r.status === 'skip').length;
  const na = results.filter((r) => r.status === 'na').length;
  log(`\n${failed ? '✗' : '✓'} ${results.filter((r) => r.status === 'pass').length}/${results.length} steps passed${na ? `, ${na} n/a (not exercised)` : ''} → ${file}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/** NEAR RPC reports code_hash as base58(sha256(wasm)); the team quotes the hex form. */
function b58ToHex(s: string): string {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(A.indexOf(ch));
  return n.toString(16).padStart(64, '0');
}

/** Enclave version for a wasm hash, from the enclave's deploy record enclave/deployments/<sha>.json (authoritative). */
function enclaveVersionOf(hash: string): string | null {
  const dirs = [process.env.ENCLAVE_DIR, join(HERE, '..', '..', 'enclave'), join(homedir(), 'projects', 'near-redteam-enclave', 'enclave')].filter((d): d is string => !!d);
  for (const d of dirs) {
    const f = join(d, 'deployments', `${hash}.json`);
    if (existsSync(f)) {
      try {
        const v = (JSON.parse(readFileSync(f, 'utf8')) as { version?: string }).version;
        if (v) return v.startsWith('v') ? v : `v${v}`;
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}
