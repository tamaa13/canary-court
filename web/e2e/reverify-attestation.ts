// Read-only re-run of step 05.8 (attestation chain) against a finished run's own on-chain submit_finding txs.
// For when 05.8 failed on RPC rate limits rather than on the chain: no new evaluations, nothing signed.
//   npx tsx e2e/reverify-attestation.ts <run.json> <out.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Limiter, Rpc, TESTNET_RPCS, TESTNET_ARCHIVAL_RPCS } from '../lib/rpc';
import type { Finding } from '../lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const [runPath, outPath] = process.argv.slice(2);
if (!runPath || !outPath) {
  console.error('usage: reverify-attestation.ts <run.json> <out.json>');
  process.exit(2);
}
interface Tx {
  label?: string;
  hash: string | null;
  ok: boolean;
  method: string;
  signer: string;
  value?: unknown;
}
const run = JSON.parse(readFileSync(runPath, 'utf8')) as { run: string; results: { id: string; title: string; txs: Tx[] }[] };
const contract = process.env.REDTEAM_CONTRACT ?? 'redteam.arifnovrian.testnet';
const limiter = new Limiter(2);
const rpc = new Rpc(TESTNET_RPCS, 30_000, limiter);
const archival = new Rpc([...TESTNET_ARCHIVAL_RPCS, ...TESTNET_RPCS], 30_000, limiter);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const verifyPath = [process.env.ENCLAVE_VERIFY, resolve(HERE, '../../enclave/verify/verify.mjs'), join(homedir(), 'projects/near-redteam-enclave/enclave/verify/verify.mjs')].find((p) => p && existsSync(p));
if (!verifyPath) throw new Error('enclave/verify/verify.mjs not found');
type Check = { id: string; label: string; ok: boolean | null; detail: string };
type R = { ok: boolean | null; checks: Check[]; nonce?: string; output?: { llm?: string; model?: string; model_signatures?: { signing_address: string }[] } | null };
const v = (await import(pathToFileURL(verifyPath).href)) as {
  TESTNET: object;
  verifyEnclave(cfg: unknown): Promise<R>;
  verifyFinding(cfg: unknown, tx: string, signer: string): Promise<R>;
  verifyModelAttestation(cfg: unknown, model: string, addr?: string): Promise<R>;
};
const hosts = ['https://archival-rpc.testnet.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://test.rpc.fastnear.com'];
const withRetry = async <X,>(fn: (cfg: unknown) => Promise<X>): Promise<X> => {
  for (let i = 0; ; i++) {
    try {
      return await fn({ ...v.TESTNET, rpc: hosts[i % hosts.length] });
    } catch (e) {
      if (i >= 6 || !/429|Rate limits|fetch failed|ECONNRESET/i.test((e as Error).message)) throw e;
      await sleep(3000 * 2 ** Math.min(i, 3));
    }
  }
};

const checks: { label: string; ok: boolean; soft?: boolean; detail?: string }[] = [];
const notes: string[] = [`read-only re-verification after run ${run.run} (its 05.8 hit an RPC rate limit); no evaluations re-run, nothing signed`];
const record = (prefix: string, r: R) => {
  for (const k of r.checks) {
    if (k.ok === null) notes.push(`${prefix} ${k.label}: n/a (${k.detail})`);
    else checks.push({ label: `${prefix} ${k.label}`, ok: k.ok, detail: k.detail });
  }
};
const startedAt = new Date();
record('enclave:', await withRetry((cfg) => v.verifyEnclave(cfg)));

// every submit_finding tx of the run whose finding ended Valid (incl. resubmits)
const submits = run.results.flatMap((s) => s.txs.filter((t) => t.method === 'submit_finding' && t.ok && t.hash));
let attested = false;
for (const t of submits) {
  const fid = Number(t.value);
  const f = (await rpc.view<Finding | null>(contract, 'get_finding', { finding_id: fid })).value;
  if (f?.status !== 'Valid') continue;
  await sleep(1500);
  const r = await withRetry((cfg) => v.verifyFinding(cfg, t.hash!, t.signer));
  record(`finding ${fid} (${t.label}):`, r);
  const sig = r.output?.model_signatures?.[0];
  if (!attested && r.output?.llm === 'live' && r.output.model && sig) {
    const a = await withRetry((cfg) => v.verifyModelAttestation(cfg, r.output!.model!, sig.signing_address));
    record(`model (fresh nonce ${a.nonce?.slice(0, 8)}…):`, a);
    attested = true;
  }
}
void archival;
const ok = checks.every((k) => k.ok);
const step = run.results.find((s) => s.id === '05.8');
const out = {
  run: `${run.run}-reverify`,
  target: 'testnet',
  startedAt,
  finishedAt: new Date(),
  results: [{ id: '05.8', area: 5, title: step?.title ?? 'attestation chain (enclave/verify)', status: ok ? 'pass' : 'fail', blocking: !ok, warnings: 0, ms: 0, checks, txs: [], notes }],
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`${ok ? '✓' : '✗'} 05.8 re-verified: ${checks.filter((k) => k.ok).length}/${checks.length} checks → ${outPath}`);
