// Read-only, independent verification of rt-agents' live demo fixture against the chain. Signs nothing.
//   npx tsx e2e/verify-demo.ts [path/to/demo-receipts.json] [out.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Limiter, Rpc, TESTNET_RPCS, TESTNET_ARCHIVAL_RPCS, txUrl } from '../lib/rpc';
import { ledger } from '../lib/ledger';
import { looksLikeEcies } from '../lib/ecies';
import type { Config, Finding, Job, PolicyLogEntry } from '../lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(process.argv[2] ?? [join(HERE, '../../agents/fixtures/demo-receipts.json'), join(homedir(), 'projects/near-redteam-agents/agents/fixtures/demo-receipts.json')].find(existsSync) ?? '');
const outPath = resolve(process.argv[3] ?? join(HERE, 'reports/demo-verify.md'));
const contract = process.env.REDTEAM_CONTRACT ?? 'redteam.arifnovrian.testnet';

interface FxFinding { id: number; job_id: number; attacker: string; status: string; unpaid: boolean; paid_attacker: string; paid_lead: string; result_hash: string | null; error: string | null; target: string }
interface FxReceipt { name: string; agent: string; signer: string; method: string; tx_hash: string | null; ok: boolean; error?: string | null }
interface Fixture { project: string; recorded_at: string; contract: string; ok: boolean; targets: { version: string; root_job: number; subjobs: number[] }[]; findings: FxFinding[]; infra: { resubmits: number[]; infra_timeouts?: number[]; submissions?: number; fee_spent_yocto: string }; receipts: FxReceipt[]; checks: { name: string; ok: boolean }[] }

const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
// one limiter with a shared cooldown for every RPC call this script makes (public endpoints rate-limit per IP)
const limiter = new Limiter(2);
const rpc = new Rpc(TESTNET_RPCS, 30_000, limiter);
const archival = new Rpc([...TESTNET_ARCHIVAL_RPCS, ...TESTNET_RPCS], 30_000, limiter);
const view = async <T>(m: string, a: object = {}) => (await rpc.view<T>(contract, m, a)).value;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const big = (v: string | null | undefined) => BigInt(v ?? 0);

type Row = { ok: boolean | null; label: string; detail?: string };
const sections: { title: string; rows: Row[] }[] = [];
const section = (title: string) => {
  const s = { title, rows: [] as Row[] };
  sections.push(s);
  return (ok: boolean | null, label: string, detail?: string) => s.rows.push({ ok, label, detail });
};

// ---------------------------------------------------------------- 0. fixture self-report
{
  const add = section('Fixture self-report');
  add(fx.ok === true, `fixture ok flag`, `${fx.checks.filter((c) => c.ok).length}/${fx.checks.length} checks`);
  add(fx.contract === contract, `fixture contract = ${contract}`, fx.contract);
}

// ---------------------------------------------------------------- 1. receipts → chain
{
  const add = section('Receipts re-fetched from chain (archival RPC)');
  for (const r of fx.receipts) {
    if (!r.tx_hash) {
      add(null, `${r.name}: ${r.method}`, 'no tx hash (decision / pre-inclusion)');
      continue;
    }
    await sleep(300);
    try {
      const o = await archival.txOutcome(r.tx_hash, r.signer);
      add(o.ok === r.ok, `${r.name}: ${r.method} → ${o.ok ? 'ok' : 'failed'} on chain (fixture: ${r.ok ? 'ok' : 'failed'})`, o.error ?? txUrl(r.tx_hash));
    } catch (e) {
      add(false, `${r.name}: fetch ${r.tx_hash.slice(0, 8)}…`, (e as Error).message.slice(0, 160));
    }
  }
}

// ---------------------------------------------------------------- 2. findings → get_finding
const chainFindings = new Map<number, Finding>();
{
  const add = section('Findings: fixture vs get_finding');
  for (const f of fx.findings) {
    const c = await view<Finding | null>('get_finding', { finding_id: f.id });
    if (!c) {
      add(false, `#${f.id} exists on chain`);
      continue;
    }
    chainFindings.set(f.id, c);
    const same =
      c.job_id === f.job_id && c.attacker === f.attacker && c.status === f.status && c.unpaid === f.unpaid && c.paid_attacker === f.paid_attacker && c.paid_lead === f.paid_lead && (c.result_hash ?? null) === (f.result_hash ?? null) && (c.error ?? null) === (f.error ?? null);
    add(same, `#${f.id} [${f.target}] job ${f.job_id} ${f.attacker.split('.')[0]}: ${c.status}${c.unpaid ? ' unpaid' : ''} paid ${c.paid_attacker}/${c.paid_lead}${c.error ? ` (${c.error})` : ''}`, same ? undefined : `fixture: ${JSON.stringify(f)}`);
    if (c.status === 'Valid' && !c.unpaid) add(looksLikeEcies(c.report_for_client), `#${f.id} report_for_client is a sealed ECIES envelope`);
  }
}

// ---------------------------------------------------------------- 3. infra timeouts → policy log + refund
const counts = await view<{ jobs: number; policy_log: number }>('get_counts');
const log: PolicyLogEntry[] = [];
for (let f = 0; f < counts.policy_log; f += 200) log.push(...(await view<PolicyLogEntry[]>('get_policy_log', { from: f, limit: 200 })));
const cfg = await view<Config & { infra_refund?: string }>('get_config');
{
  const add = section('OutLayer infra timeouts → infra_timeout refund');
  const timeouts = fx.findings.filter((f) => /^outlayer/i.test(f.error ?? ''));
  add(true, `${timeouts.length} finding(s) in the fixture failed with an OutLayer error`, timeouts.map((f) => `#${f.id}`).join(', '));
  for (const f of timeouts) {
    const e = log.find((x) => x.action === 'infra_timeout' && new RegExp(`\\bfinding ${f.id}\\b`).test(x.detail));
    add(!!e, `#${f.id}: infra_timeout logged`, e ? `seq ${e.seq}: ${e.detail}` : 'no entry');
    if (e) {
      add(e.actor === f.attacker, `#${f.id}: actor = attacker`, e.actor);
      add(e.detail.includes(String(cfg.infra_refund)), `#${f.id}: refund = get_config.infra_refund (${cfg.infra_refund})`);
    }
  }
  // infra.resubmits lists superseded timed-out findings (resubmitted once); findings[] keeps only final attempts
  const demoJobs = new Set(fx.targets.flatMap((t) => [t.root_job, ...t.subjobs]));
  const allTimeouts = log.filter((x) => x.action === 'infra_timeout' && x.job_id !== null && x.job_id !== undefined && demoJobs.has(x.job_id));
  add(true, `all OutLayer infra timeouts in the demo jobs: ${allTimeouts.length}`, allTimeouts.map((x) => `seq ${x.seq} → ${/finding \d+/.exec(x.detail)?.[0]}`).join(', '));
  for (const id of fx.infra.resubmits) {
    const e = allTimeouts.find((x) => new RegExp(`\\bfinding ${id}\\b`).test(x.detail));
    const old = await view<Finding | null>('get_finding', { finding_id: id });
    add(!!e && old?.status === 'Failed', `superseded #${id}: Failed with infra_timeout (refunded) and resubmitted`, e ? `seq ${e.seq}` : 'no infra_timeout entry');
  }
  add(allTimeouts.length === fx.infra.resubmits.length + timeouts.length, 'every timeout is either a superseded resubmit or a final finding in the fixture', `${fx.infra.resubmits.length} superseded + ${timeouts.length} final = ${allTimeouts.length}`);
  if (fx.infra.infra_timeouts) {
    const chainIds = allTimeouts.map((x) => Number(/finding (\d+)/.exec(x.detail)?.[1])).sort((a, b) => a - b);
    const fxIds = [...fx.infra.infra_timeouts].sort((a, b) => a - b);
    add(JSON.stringify(chainIds) === JSON.stringify(fxIds), `fixture infra.infra_timeouts = the on-chain infra_timeout findings`, `chain [${chainIds.join(', ')}] vs fixture [${fxIds.join(', ')}]`);
  }
  if (fx.infra.submissions !== undefined) add(fx.infra.submissions === fx.receipts.filter((r) => r.method === 'submit_finding').length, `fixture infra.submissions (${fx.infra.submissions}) = submit_finding receipts`);
}

// ---------------------------------------------------------------- 4. ledger + margin invariants per tree
{
  const add = section('Money: ledger and lead-margin invariants (both demo trees)');
  for (const t of fx.targets) {
    const ids = [t.root_job, ...t.subjobs];
    const jobs = (await Promise.all(ids.map((id) => view<Job | null>('get_job', { job_id: id })))).filter((j): j is Job => !!j);
    const fs = (await Promise.all(ids.map((id) => view<Finding[]>('get_findings', { job_id: id })))).flat();
    const [tree] = ledger(jobs, fs);
    const sum = tree.subRewards + tree.leadMargins + tree.providerRewards + tree.refunded + tree.remaining;
    add(sum === big(tree.root.budget) && tree.refunded >= 0n, `[${t.version}] job #${t.root_job}: budget ${tree.root.budget} = paid ${tree.subRewards + tree.leadMargins + tree.providerRewards} + refunded ${tree.refunded} + escrow ${tree.remaining}`);
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const f of fs.filter((x) => byId.get(x.job_id)!.depth > 0)) {
      const sub = byId.get(f.job_id)!;
      const parent = byId.get(sub.parent_id!)!;
      if (f.unpaid || big(f.paid_attacker) === 0n) add(f.paid_lead === '0', `[${t.version}] #${f.id} (${f.status}${f.unpaid ? ', unpaid' : ''}): no lead margin without a sub reward`, `paid_lead=${f.paid_lead}`);
      else add(big(f.paid_lead) === big(parent.reward_per_finding) - big(sub.reward_per_finding), `[${t.version}] #${f.id}: lead margin = parent reward − sub reward`, `${f.paid_lead}`);
    }
  }
}

// ---------------------------------------------------------------- 5. privacy spot check
{
  const add = section('Privacy spot check (views of the demo jobs)');
  const ids = fx.targets.flatMap((t) => [t.root_job, ...t.subjobs]);
  const corpus = JSON.stringify(await Promise.all(ids.map(async (id) => [await view('get_job', { job_id: id }), await view('get_findings', { job_id: id }), await view('get_bids', { job_id: id })])));
  add(!/CANARY-[A-Za-z0-9]/.test(corpus), 'no canary-shaped plaintext in jobs / findings / bids', `${corpus.length} bytes scanned`);
}

// ---------------------------------------------------------------- 6. attestation chain via enclave/verify
{
  const add = section('Attestation chain (enclave/verify) for every submit_finding tx');
  const verifyPath = [process.env.ENCLAVE_VERIFY, resolve(HERE, '../../enclave/verify/verify.mjs'), join(homedir(), 'projects/near-redteam-enclave/enclave/verify/verify.mjs')].find((p) => p && existsSync(p));
  if (!verifyPath) add(null, 'enclave/verify/verify.mjs not available');
  else {
    const v = (await import(pathToFileURL(verifyPath).href)) as {
      TESTNET: unknown;
      verifyFinding(cfg: unknown, tx: string, signer: string): Promise<{ ok: boolean | null; checks: { id: string; label: string; ok: boolean | null; detail: string }[]; output?: { finding_id?: number; llm?: string; model?: string; model_signatures?: { signing_address: string }[] } | null }>;
      verifyModelAttestation(cfg: unknown, model: string, addr?: string): Promise<{ ok: boolean | null; nonce?: string; checks: { id: string; label: string; ok: boolean | null; detail: string }[] }>;
    };
    // verify.mjs makes its own RPC calls without retries; on a 429 back off and rotate its RPC host
    const hosts = ['https://archival-rpc.testnet.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://test.rpc.fastnear.com'];
    const withRetry = async <T,>(fn: (cfg: unknown) => Promise<T>): Promise<T> => {
      for (let i = 0; ; i++) {
        try {
          return await fn({ ...(v.TESTNET as object), rpc: hosts[i % hosts.length] });
        } catch (e) {
          if (i >= 5 || !/429|Rate limits|fetch failed|ECONNRESET/i.test((e as Error).message)) throw e;
          await sleep(3000 * 2 ** Math.min(i, 3));
        }
      }
    };
    let attested = false;
    for (const r of fx.receipts.filter((x) => x.method === 'submit_finding' && x.tx_hash)) {
      await sleep(1500);
      try {
        const fid = Number((await archival.txOutcome(r.tx_hash!, r.signer)).value);
        const timedOut = log.some((x) => x.action === 'infra_timeout' && new RegExp(`\\bfinding ${fid}\\b`).test(x.detail));
        const res = await withRetry((cfg) => v.verifyFinding(cfg, r.tx_hash!, r.signer));
        if (timedOut) {
          // no worker ever produced output: only the request side can be attested
          const req = res.checks.filter((k) => k.id.startsWith('exec.') && !['exec.completed', 'exec.output'].includes(k.id));
          add(req.every((k) => k.ok === true), `${r.name}: finding #${fid} timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected`, req.map((k) => `${k.ok ? '✓' : '✗'} ${k.id}`).join(' '));
          continue;
        }
        const bad = res.checks.filter((k) => k.ok === false);
        add(bad.length === 0, `${r.name}: finding #${res.output?.finding_id ?? fid} ${res.output?.llm ?? 'no output'}: ${res.checks.filter((k) => k.ok === true).length} ✓, ${res.checks.filter((k) => k.ok === null).length} n/a`, bad.map((k) => `${k.label}: ${k.detail}`).join(' | ') || undefined);
        const sig = res.output?.model_signatures?.[0];
        if (!attested && res.output?.llm === 'live' && res.output.model && sig) {
          const a = await withRetry((cfg) => v.verifyModelAttestation(cfg, res.output!.model!, sig.signing_address));
          add(a.checks.every((k) => k.ok !== false), `fresh-nonce NEAR AI attestation for the demo's signing key (nonce ${a.nonce?.slice(0, 8)}…)`, a.checks.map((k) => `${k.ok === true ? '✓' : k.ok === null ? 'n/a' : '✗'} ${k.label}`).join('; '));
          attested = true;
        }
      } catch (e) {
        add(false, `${r.name}: verify ${r.tx_hash!.slice(0, 8)}…`, (e as Error).message.slice(0, 160));
      }
    }
  }
}

// ---------------------------------------------------------------- report
const all = sections.flatMap((s) => s.rows);
const fails = all.filter((r) => r.ok === false).length;
const L: string[] = [];
L.push(`# Canary Court: independent check of the live demo fixture: **${fails ? `${fails} mismatch(es)` : 'all consistent'}**`, '');
L.push(`- Fixture: \`${fixturePath.replace(homedir(), '~')}\` (${fx.project}, recorded ${fx.recorded_at}, ${fx.receipts.length} receipts, ${fx.findings.length} findings).`);
L.push(`- Checked against \`${contract}\` read-only (views, tx status, enclave/verify). Nothing signed. ${new Date().toISOString()}.`);
L.push(`- ${all.filter((r) => r.ok === true).length} ✓ · ${fails} ✗ · ${all.filter((r) => r.ok === null).length} n/a`, '');
for (const s of sections) {
  L.push(`## ${s.title}`, '');
  for (const r of s.rows) L.push(`- ${r.ok === true ? '✓' : r.ok === false ? '✗' : '·'} ${r.label}${r.detail ? `  \n  <sub>${r.detail.replace(/\|/g, '\\|').slice(0, 300)}</sub>` : ''}`);
  L.push('');
}
writeFileSync(outPath, L.join('\n'));
console.log(`${fails ? '✗' : '✓'} ${all.filter((r) => r.ok === true).length} ✓ / ${fails} ✗ / ${all.filter((r) => r.ok === null).length} n/a → ${outPath}`);
process.exit(fails ? 1 : 0);
