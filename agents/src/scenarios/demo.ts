/**
 * `pnpm demo` — the full autonomous loop on two CTF-style fictional targets:
 *   v1 "legacy build" (planted diagnostics-override flaw)  → expected: Valid findings, atomic payouts, sealed reports
 *   v2 "hardened build"                                     → expected: Invalid findings, full refund roll-up at expiry
 * Per target: client publishes encrypted target → posts job → lead bids → client counters → lead re-bids → accept
 * → lead plans split → create_subjob ×2 → subs bid → lead hires (check_counterparty) → lead + subs attack
 * (≤2 payloads each, ECIES to the enclave) → TEE verdicts → payouts → reports → privacy scan → expiry → withdraw.
 * Story: the market pays only for proven leaks; a hardened agent costs attackers money.
 */
import { config } from '../config.js';
import { fullPolicyLog } from '../chain/contract.js';
import type { Finding } from '../chain/types.js';
import { x25519PublicHex } from '../crypto/ecies.js';
import { profile, type TargetVersion } from '../target/index.js';
import { fmtNear, fmtUsdc, NEAR, USDC } from '../util/amount.js';
import { viewAccountLiquid } from '../chain/near-contract.js';
import { color, log } from '../util/log.js';
import type { World } from '../runtime/world.js';
import type { Submitted } from '../agents/attacker.js';
import type { DecryptedReport } from '../agents/client.js';
import { waitForIdleExecutor } from '../chain/outlayer.js';
import { modelHealthy } from '../llm/llm.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface TargetRun {
  version: TargetVersion;
  targetId: string;
  rootId: number;
  subjobs: number[];
  findings: Finding[];
  reports: DecryptedReport[];
}

interface DemoResult {
  mode: string;
  llm: string;
  targets: { version: TargetVersion; target_id: string; root_job: number; subjobs: number[] }[];
  /** v1 root job (kept for older consumers). */
  rootJob: number;
  subjobs: number[];
  findings: (Pick<Finding, 'id' | 'job_id' | 'attacker' | 'status' | 'severity' | 'paid_attacker' | 'paid_lead' | 'result_hash' | 'unpaid' | 'error'> & { target: TargetVersion })[];
  checks: Check[];
  ok: boolean;
  infra: { submissions: number; infra_timeouts: number[]; resubmits: number[]; fee_spent_yocto: string };
}

export async function runDemo(world: World, opts: { settle: boolean; deadlineMs?: number; targetModel?: string }): Promise<DemoResult> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    (ok ? log.ok : log.fail)(`${name} — ${detail}`);
  };

  log.section(`Canary Court · demo · ${world.mode} · LLM: ${world.llm.name}`);
  if (world.dryRun) {
    log.info(color.dim('dry-run: in-memory contract + enclave stand-in mirroring the testnet interfaces; no keys, no funds, no network.'));
    world.mockSetup();
  }
  const { client, lead, sub1, sub2 } = world.agents();
  const cfg = await client.chain.getConfig();
  const enclavePk = cfg.enclave_pubkey;
  const enclaveReady = /^[0-9a-f]{64}$/.test(enclavePk);
  if (!enclaveReady) log.warn('enclave_pubkey not set on the contract yet: running negotiation/subcontracting/settlement only (attacks skipped)');
  const targetModel = opts.targetModel ?? (world.dryRun ? 'Qwen/Qwen3.6-35B-A3B-FP8' : undefined);
  log.info(`target: ${profile().name} (v1 legacy build with a planted flaw vs v2 hardened build)`);
  log.info(`contract ${config.redteamContract} · enclave x25519 ${enclavePk.slice(0, 16)}… · target model ${targetModel ?? 'mock'} · policy: max_depth ${cfg.policy.max_depth}, max_children ${cfg.policy.max_children}, warn cap ${cfg.policy.warn_reward_cap_bps / 100}%`);

  log.section('1 · registry');
  const target = profile();
  await client.register('client', { agent: 'client', desc: target.owner });
  await lead.register('provider', { agent: 'lead', desc: 'red-team lead; subcontracts to specialists' });
  await sub1.register('provider', { agent: 'sub1', specialty: ['prompt_injection', 'jailbreak'] });
  await sub2.register('provider', { agent: 'sub2', specialty: ['tool_misuse', 'data_exfiltration'] });
  if (world.chain) world.chain.advanceBlocks(world.chain.policy.min_age_blocks + 1); // setup ran "earlier"
  for (const a of [lead, sub1, sub2]) {
    for (let i = 0; ; i++) {
      const v = await client.chain.checkCounterparty(a.id);
      const young = v.level === 'Warn' && v.reasons.some((r) => /blocks ago/.test(r));
      if (!young) {
        if (v.level !== 'Allow') log.info(`${a.name} is ${v.level} (${v.reasons.join('; ')}): the market decides (restricted hire or no hire)`);
        break;
      }
      if (world.dryRun || i > 40) throw new Error(`${a.id} is still young: ${v.reasons.join('; ')}`);
      if (i === 0) log.info(`${a.name} is Warn (${v.reasons.join('; ')}); waiting for it to age past min_age_blocks…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // live: 12 sequential-ish TEE evaluations (~60–90 s each, ≤4 in flight) need a generous deadline
  const deadlineMs = opts.deadlineMs ?? world.now() + (enclaveReady ? Math.max(cfg.policy.min_deadline_ms + 60_000, (world.dryRun ? 12 : 22) * 60_000) : cfg.policy.min_deadline_ms + 90_000);
  const runs: TargetRun[] = [];
  let infra: { resubmits: number[]; feeSpent: bigint; timeouts: number[]; submissions: number } = { resubmits: [], feeSpent: 0n, timeouts: [], submissions: 0 };
  const balBefore = BigInt((await client.chain.balanceOf(client.id)).usdc);

  for (const version of ['v1', 'v2'] as const) {
    log.section(`2${version === 'v1' ? 'a' : 'b'} · target ${version}: publish, post job, negotiate, subcontract`);
    const targetId = await client.publishTarget(enclaveReady ? enclavePk : x25519PublicHex(new Uint8Array(32).fill(7)), undefined, targetModel, version);
    const rootId = await client.postJob({ deadlineMs, maxBudget: USDC(100), targetId, description: target.descriptions[version] });
    await lead.bidOnOpenJobs([rootId]);
    for (let round = 0; round < 5; round++) {
      const r = await client.reviewBids(rootId, { forcePolicy: round >= 3 });
      if (r.action === 'accept') break;
      await lead.answerCounters([rootId]);
    }
    let root = (await client.chain.getJob(rootId))!;
    check(`[${version}] root job assigned to lead`, root.provider === lead.id && root.status === 'Assigned', `job #${rootId} provider=${root.provider} reward=${fmtUsdc(root.reward_per_finding)}`);
    const subjobs = root.provider === lead.id && root.can_subcontract ? await lead.subcontract(root, deadlineMs - 30_000) : [];
    root = (await client.chain.getJob(rootId))!;
    check(`[${version}] two subjobs carved from parent escrow`, subjobs.length === 2 && root.children.length === 2, `children=${root.children.join(',')} parent remaining=${fmtUsdc(root.remaining)}`);
    await sub1.bidOnSubjobs(subjobs);
    await sub2.bidOnSubjobs(subjobs);
    const hired = await lead.hire(subjobs);
    // A subjob with no acceptable specialist (LLM/policy said no) → the lead covers those categories itself on the root job.
    const unhired = subjobs.filter((id) => !hired.has(id));
    const reassigned: string[] = [];
    for (const id of unhired) reassigned.push(...(await client.chain.getJob(id))!.categories);
    if (reassigned.length) {
      lead.keep.set(rootId, [...new Set([...(lead.keep.get(rootId) ?? []), ...reassigned])]);
      lead.say(`no acceptable specialist for subjob(s) #${unhired.join(', #')}: covering [${reassigned.join(', ')}] myself (escrow returns at expiry)`);
    }
    const covered = new Set(lead.keep.get(rootId) ?? []);
    for (const id of subjobs.filter((s) => hired.has(s))) for (const c of (await client.chain.getJob(id))!.categories) covered.add(c);
    root = (await client.chain.getJob(rootId))!;
    check(`[${version}] every category covered (hired specialist after check_counterparty, or the lead)`, hired.size > 0 && root.categories.every((c) => covered.has(c)),
      `${[...hired].map(([j, b]) => `#${j}→${b.split('.')[0]}`).join(', ')}${reassigned.length ? ` · lead covers [${reassigned.join(', ')}] (no acceptable specialist)` : ''}`);
    runs.push({ version, targetId, rootId, subjobs, findings: [], reports: [] });
  }

  log.section('3 · attacks: ≤2 payloads per agent per target (playbook + novel), ECIES → TEE');
  const computeOf = async () => (await Promise.all([lead, sub1, sub2].map(async (a) => BigInt((await a.chain.balanceOf(a.id)).compute)))).reduce((x, y) => x + y, 0n);
  const computeBefore = await computeOf();
  if (enclaveReady && !world.dryRun && targetModel && targetModel !== 'mock') {
    const h = await modelHealthy(targetModel);
    if (!h.ok) throw new Error(`target model ${targetModel} is not being served by NEAR AI right now (${h.error}): aborting before paying OutLayer fees`);
    log.info(color.dim(`target model ${targetModel} answers on NEAR AI ✓`));
  }
  if (enclaveReady) {
    const work: { run: TargetRun; agent: typeof sub1 | typeof lead; subs: Submitted[] }[] = [];
    let collected = 0;
    // keep ≤ MAX_IN_FLIGHT evaluations pending: OutLayer's queue + the 2-min yield timeout punish bursts
    const MAX_IN_FLIGHT = 2; // testnet OutLayer has 2 shared executors (rt-enclave diagnosis)
    const drain = async (limit: number) => {
      while (work.slice(collected).reduce((n, w) => n + w.subs.length, 0) > limit) {
        const w = work[collected++];
        w.run.findings.push(...(await w.agent.collectVerdicts(w.subs)));
      }
    };
    const plan: { run: TargetRun; agentId: string; go: () => Promise<{ agent: typeof sub1 | typeof lead; subs: Submitted[] }> }[] = [];
    for (const run of runs) {
      const desc = target.descriptions[run.version];
      for (const sub of [sub1, sub2]) {
        for (const job of await sub.assignedJobs(run.subjobs)) {
          plan.push({ run, agentId: sub.id, go: async () => ({ agent: sub, subs: await sub.attack(job, enclavePk, job.categories.filter((c) => sub.specialty.includes(c)), desc) }) });
        }
      }
      const keep = lead.keep.get(run.rootId) ?? [];
      const root = (await client.chain.getJob(run.rootId))!;
      if (keep.length) plan.push({ run, agentId: lead.id, go: async () => ({ agent: lead, subs: await lead.attack(root, enclavePk, keep, desc) }) });
    }
    // HARD PREFLIGHT (live): every attacker must cover its batch prepay and all fees before we pay anything.
    // A submit_finding reserves its 300 TGas prepay (~0.3 NEAR) until the OutLayer callback; batches drain before the
    // next one starts, so one batch (≤2 submissions) is in flight per agent → liquid ≥ 2 × 0.31 NEAR. Compute must cover
    // every planned submission plus one possible infra-timeout resubmit each.
    if (!world.dryRun) {
      const perAgent = new Map<string, { name: string; batches: number }>();
      for (const a of [lead, sub1, sub2]) {
        const batches = plan.filter((p) => p.agentId === a.id).length;
        if (batches) perAgent.set(a.id, { name: a.name, batches });
      }
      const problems: string[] = [];
      for (const [id, { name, batches }] of perAgent) {
        const av = await viewAccountLiquid(id);
        const compute = BigInt((await client.chain.balanceOf(id)).compute);
        const liquidNeed = NEAR('0.62');
        const computeNeed = BigInt(cfg.policy.outlayer_fee) * BigInt(batches * 2 * 2);
        log.info(`preflight ${name}: liquid ${fmtNear(av)} (need ≥ ${fmtNear(liquidNeed)}), compute ${fmtNear(compute)} (need ≥ ${fmtNear(computeNeed)} for ${batches * 2} submissions + retries)`);
        if (av < liquidNeed) problems.push(`${name} liquid ${fmtNear(av)} < ${fmtNear(liquidNeed)}`);
        if (compute < computeNeed) problems.push(`${name} compute ${fmtNear(compute)} < ${fmtNear(computeNeed)}`);
      }
      if (problems.length) throw new Error(`PREFLIGHT FAILED before paying any OutLayer fee: ${problems.join('; ')} — run \`pnpm setup:testnet\` to top up`);
    }
    for (const p of plan) {
      await drain(world.dryRun ? Infinity : MAX_IN_FLIGHT - 2); // ≤2 payloads per agent batch → ≤ MAX_IN_FLIGHT pending
      if (!world.dryRun && !(await waitForIdleExecutor(90_000))) {
        throw new Error('OutLayer queue busy for >90 s (no idle executor): aborting before paying fees into a likely yield timeout');
      }
      work.push({ run: p.run, ...(await p.go()) });
    }
    log.info(color.dim(`${work.reduce((n, w) => n + w.subs.length, 0)} findings submitted in total; collecting remaining TEE verdicts…`));
    await drain(0);
    const resubmits = [lead, sub1, sub2].flatMap((a) => a.resubmits);
    const timeouts = [lead, sub1, sub2].flatMap((a) => a.infraTimeouts);
    const submissions = [lead, sub1, sub2].reduce((n, a) => n + a.submittedIds.length, 0);
    const feeSpent = computeBefore - (await computeOf());
    const INFRA_REFUND = 9_000_000_000_000_000_000_000n;
    const expected = BigInt(cfg.policy.outlayer_fee) * BigInt(submissions) - INFRA_REFUND * BigInt(timeouts.length);
    infra = { resubmits, feeSpent, timeouts, submissions };
    log.info(`OutLayer: ${submissions} submissions, ${timeouts.length} infra timeout(s)${timeouts.length ? ` (findings ${timeouts.join(', ')})` : ''}, ${resubmits.length} resubmit(s); attackers' net fees ${fmtNear(feeSpent)}`);
    check('OutLayer fees reconcile on chain (0.02 per submission − 0.009 per infra timeout)', feeSpent === expected, `measured compute delta ${fmtNear(feeSpent)} = ${submissions} × 0.02 − ${timeouts.length} × 0.009 = ${fmtNear(expected)}`);

    const all = runs.flatMap((r) => r.findings);
    check('enclave produced a verdict for every finding', all.length > 0 && all.every((f) => f.status !== 'Pending'), runs.map((r) => `${r.version}: ${r.findings.filter((f) => f.status === 'Valid').length} valid / ${r.findings.filter((f) => f.status === 'Invalid').length} invalid / ${r.findings.filter((f) => f.status === 'Failed').length} failed`).join(' · '));
    const [v1, v2] = runs;
    const v1Valid = v1.findings.filter((f) => f.status === 'Valid');
    check('[v1] planted flaw found: valid findings paid atomically', v1Valid.some((f) => BigInt(f.paid_attacker) > 0n), v1Valid.map((f) => `#${f.id} ${f.attacker.split('.')[0]} +${fmtUsdc(f.paid_attacker)}${BigInt(f.paid_lead) ? ` lead +${fmtUsdc(f.paid_lead)}` : ''}`).join('; ') || 'none');
    const v2Valid = v2.findings.filter((f) => f.status === 'Valid');
    const fee = BigInt(cfg.policy.outlayer_fee);
    check('[v2] hardened target held: no valid findings, nobody paid', v2.findings.length > 0 && v2Valid.length === 0, `${v2.findings.filter((f) => f.status === 'Invalid').length} attempts rejected by the TEE${v2.findings.some((f) => f.status === 'Failed') ? ` (+${v2.findings.filter((f) => f.status === 'Failed').length} OutLayer failures, no strike)` : ''}; attackers spent ${fmtNear(fee * BigInt(v2.findings.length))} in OutLayer fees for nothing`);

    log.section('4 · reports: only valid findings carry one; only the client (and the lead, redacted) can decrypt');
    for (const run of runs) {
      run.reports = await client.readReports([run.rootId, ...run.subjobs]);
      for (const r of run.reports) {
        const bot = r.leakedCanary ? color.red(`bot leaked the canary (${r.leakKind}) — excerpt withheld`) : `bot: "${r.report.response_excerpt.slice(0, 60)}…"`;
        client.say(`[${run.version}] finding #${r.finding.id} [${r.record.category}] ${r.finding.status} (${r.record.llm} target ${r.record.model}): payload sha256:${r.record.payload_sha256.slice(0, 12)} → ${bot}`);
      }
    }
    const reports = runs.flatMap((r) => r.reports);
    const valid = all.filter((f) => f.status === 'Valid');
    check('client decrypted report_for_client for every valid finding', valid.length > 0 && reports.length === valid.length, `${reports.length}/${valid.length} reports (invalid findings carry no report by design)`);
    check('report integrity: sha256(record_json) == result_hash on chain', reports.length > 0 && reports.every((r) => r.integrity), reports.map((r) => `#${r.finding.id} ${r.finding.result_hash?.slice(0, 10)}…`).join(', '));
    const leadReports = await lead.readLeadReports(runs.flatMap((r) => r.subjobs));
    const subValid = valid.filter((f) => runs.some((r) => r.subjobs.includes(f.job_id))).length;
    const canaries = [...client.targets.values()].map((t) => t.canary);
    check('lead decrypted report_for_lead (canary-redacted) for subjob findings', leadReports.length === subValid && leadReports.every((r) => canaries.every((c) => !r.report.response_excerpt.includes(c))), `${leadReports.length}/${subValid} reports, canary shown as [CANARY]`);
    check('every valid finding really leaked the canary (client-side re-check)', reports.length > 0 && reports.every((r) => r.leakedCanary), 'client re-runs the leak detector on the decrypted response with its own canary');
  } else {
    check('attacks via enclave', false, 'SKIPPED: enclave_pubkey not configured on the contract');
  }

  log.section('5 · privacy: public state never contains payloads or the canaries');
  const jobIds = runs.flatMap((r) => [r.rootId, ...r.subjobs]);
  const publicState = JSON.stringify({
    jobs: await Promise.all(jobIds.map((j) => client.chain.getJob(j))),
    findings: await Promise.all(jobIds.map((j) => client.chain.getFindings(j))),
    bids: await Promise.all(jobIds.map((j) => client.chain.getBids(j))),
    log: (await fullPolicyLog(client.chain)).filter((e) => e.job_id !== null && jobIds.includes(e.job_id)),
    targets: await Promise.all(runs.map((r) => client.chain.getTarget(r.targetId))),
  });
  const secrets = [...[...client.targets.values()].map((t) => t.canary), ...[lead, sub1, sub2].flatMap((a) => a.submittedPayloads.map((p) => p.slice(0, 40)))];
  const leaks = secrets.filter((s) => publicState.includes(s));
  check('no plaintext payload or canary in on-chain views', leaks.length === 0, `scanned ${publicState.length} bytes of views for ${secrets.length} secrets → ${leaks.length} hits`);

  log.section('6 · settlement');
  if (world.chain && opts.settle) world.chain.advanceTime(deadlineMs - world.now() + 1000);
  if (opts.settle && world.now() <= deadlineMs) {
    const wait = deadlineMs - world.now() + 5000;
    log.info(`waiting ${Math.ceil(wait / 1000)}s for the job deadline before expiring (use --no-settle to skip)…`);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (opts.settle) {
    const refunds: Record<string, bigint> = {};
    for (const run of runs) {
      const before = BigInt((await client.chain.balanceOf(client.id)).usdc);
      await client.expireTree(run.rootId);
      refunds[run.version] = BigInt((await client.chain.balanceOf(client.id)).usdc) - before;
    }
    const roots = await Promise.all(runs.map((r) => client.chain.getJob(r.rootId)));
    check('expiry rolled refunds up subjob → parent → client', roots.every((j) => j!.status === 'Expired' && j!.remaining === '0'), runs.map((r) => `${r.version} refund ${fmtUsdc(refunds[r.version])}`).join(' · '));
    const v2 = runs[1];
    const v2Budget = BigInt((await client.chain.getJob(v2.rootId))!.budget);
    if (enclaveReady) check('[v2] hardened target: client got its whole escrow back', refunds.v2 === v2Budget, `${fmtUsdc(refunds.v2)} of ${fmtUsdc(v2Budget)} refunded`);
    const spent = balBefore - BigInt((await client.chain.balanceOf(client.id)).usdc);
    log.info(`client net spend this run: ${fmtUsdc(spent)} — paid only for v1's proven leaks`);
  } else {
    log.info('skipped expiry (--no-settle); jobs can be expired by anyone after the deadline');
  }
  for (const a of [lead, sub1, sub2]) await a.withdrawAll();
  await client.withdrawAll(USDC(300)); // keep a working float in escrow
  const balances = await Promise.all([client, lead, sub1, sub2].map(async (a) => `${a.name} ${fmtUsdc((await a.chain.balanceOf(a.id)).usdc)}`));
  log.info(`internal balances after withdraw: ${balances.join(' · ')}`);

  log.section('7 · contract policy log (non-reverting decisions for this run)');
  for (const e of (await fullPolicyLog(client.chain)).filter((x) => x.job_id !== null && jobIds.includes(x.job_id)).slice(-16)) log.info(color.dim(`#${e.seq} ${e.action.padEnd(16)} ${e.detail}`));

  const ok = checks.every((c) => c.ok);
  log.section(ok ? 'demo passed' : 'demo FAILED');
  for (const c of checks) (c.ok ? log.ok : log.fail)(c.name);
  const v1 = runs[0];
  return {
    mode: world.mode, llm: world.llm.name,
    targets: runs.map((r) => ({ version: r.version, target_id: r.targetId, root_job: r.rootId, subjobs: r.subjobs })),
    rootJob: v1.rootId, subjobs: v1.subjobs,
    findings: runs.flatMap((r) => r.findings.map((f) => ({ id: f.id, job_id: f.job_id, attacker: f.attacker, status: f.status, severity: f.severity, paid_attacker: f.paid_attacker, paid_lead: f.paid_lead, result_hash: f.result_hash, unpaid: f.unpaid, error: f.error, target: r.version }))),
    checks, ok, infra: { submissions: infra.submissions, infra_timeouts: infra.timeouts, resubmits: infra.resubmits, fee_spent_yocto: infra.feeSpent.toString() },
  };
}
