import { describe, expect, it } from 'vitest';
import { logToStderr } from '../src/util/log.js';
import { World } from '../src/runtime/world.js';
import { runDemo } from '../src/scenarios/demo.js';
import { runAttacks } from '../src/scenarios/attacks.js';

process.env.NO_COLOR = '1';
logToStderr(true);

describe('dry-run scenarios (in-memory contract + mock enclave + mock LLM)', () => {
  it('demo: full loop passes every check', async () => {
    const res = await runDemo(new World({ dryRun: true }), { settle: true });
    expect(res.checks.filter((c) => !c.ok)).toEqual([]);
    expect(res.targets.map((t) => t.subjobs.length)).toEqual([2, 2]);
    expect(res.findings.some((f) => f.status === 'Valid')).toBe(true);
  }, 30_000);

  it('demo: ledger is conserved (budget = payouts + refunds)', async () => {
    const w = new World({ dryRun: true });
    const res = await runDemo(w, { settle: true });
    const budgets = res.targets.reduce((s, t) => s + BigInt(w.chain!.jobs[t.root_job].budget), 0n);
    const paid = res.findings.reduce((s, f) => s + BigInt(f.paid_attacker) + BigInt(f.paid_lead), 0n);
    const refunds = w.chain!.policyLog.filter((e) => e.action === 'refund' && /refunded to root client/.test(e.detail)).reduce((s, e) => s + BigInt(e.detail.split(' ')[0]), 0n);
    expect(paid + refunds).toBe(budgets);
    expect(res.findings.filter((f) => f.target === 'v2' && f.status === 'Valid')).toHaveLength(0);
    expect(res.findings.filter((f) => f.target === 'v1' && f.status === 'Valid').length).toBeGreaterThan(0);
  }, 30_000);

  it('attacks: all 4 scenarios hold', async () => {
    const res = await runAttacks(new World({ dryRun: true }));
    expect(res.receipts.filter((r) => !r.ok)).toEqual([]);
    expect(new Set(res.receipts.map((r) => r.scenario))).toEqual(new Set([1, 2, 3, 4, 5]));
    const keyScope = res.receipts.filter((r) => ['s1-ft-transfer', 's1-near-transfer', 's1-add-key', 's1-forge-deposit', 's1-withdraw-deposit'].includes(r.name));
    expect(keyScope).toHaveLength(5);
    expect(keyScope.every((r) => r.tx_hash === null && r.stage === 'rpc')).toBe(true);
  }, 30_000);
});
