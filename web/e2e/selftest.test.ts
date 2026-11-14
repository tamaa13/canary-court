// Harness self-test: the suite must pass on a spec-faithful mock and must FAIL the right step
// when the mock is given a specific spec violation. Proves the e2e checks have teeth.
import { describe, it, expect } from 'vitest';
import { MockChain } from './harness/chain';
import { makeCtx } from './harness/ctx';
import { runSteps, step } from './harness/suite';
import { steps } from './tests/steps';
import { MockNet, type Fault } from '../lib/mock-net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function run(faults: Fault[] = []) {
  const chain = new MockChain(new MockNet({ faults }));
  const ctx = makeCtx(chain, `t${Math.random().toString(36).slice(2, 7)}`, { keep: false, receiptsPath: join(tmpdir(), `rt-receipts-${Date.now()}.json`), model: 'mock' });
  return runSteps(steps, ctx, () => {});
}

describe('e2e harness self-test (mock)', () => {
  it('passes every step on the spec-faithful mock', async () => {
    const results = await run();
    // testnet-only steps assert nothing on the mock (no OutLayer receipts, no TEE): they must report n/a, not pass
    const NA_ON_MOCK = new Set(['05.7', '05.8']);
    const bad = results
      .filter((r) => (NA_ON_MOCK.has(r.id) ? r.status !== 'na' : r.status !== 'pass') || r.warnings > 0)
      .map((r) => `${r.id}: ${r.status} ${r.error ?? (r.warnings ? 'warnings' : '')}`);
    expect(bad).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(40);
  });

  it('reports a step that ran 0 checks as n/a (not exercised), never as pass', async () => {
    const chain = new MockChain(new MockNet({}));
    const ctx = makeCtx(chain, 'tna', { keep: false, receiptsPath: join(tmpdir(), `rt-receipts-na-${Date.now()}.json`), model: 'mock' });
    const results = await runSteps(
      [
        step('99.1', 'asserts nothing', [], async (t) => t.note('nothing to check this run')),
        step('99.2', 'asserts one thing, needs 99.1', ['99.1'], async (t) => t.ok('one check', true)),
      ],
      ctx,
      () => {},
    );
    expect(results.map((r) => r.status)).toEqual(['na', 'pass']); // n/a does not skip its dependents
  });

  // [fault, step(s) that must catch it (first listed is the primary), description]
  const cases: [Fault, string, string][] = [
    ['no-lead-margin', '05.3', 'lead margin not paid'],
    ['mint-on-payout', '05.2', 'payout without debiting escrow (conservation)'],
    ['plaintext-log', '05.6', 'plaintext payload in callback logs'],
    ['no-blocklist', '06.2', '2 strikes do not block'],
    ['no-depth-cap', '04.5', 'subjob of a subjob allowed'],
    ['no-escalation', '03.2', 'Warn does not restrict'],
    ['no-cascade', '08.3', 'expiring parent leaves child active'],
    ['fc-any-receiver', '10.1', 'FC key not scoped'],
    ['margin-on-unpaid', '05.9|05.10|05.11', 'lead margin paid on an unpaid sub finding (duplicate or budget exhausted)'],
    ['infra-blames-attacker', '07.5', 'OutLayer timeout counted against the attacker, no refund'],
    ['no-binding', '07.3|07.4|05.1', 'enclave accepts replayed targets/payloads (05.1 sees the missing client-fault refund first)'],
    ['error-as-invalid', '07.1|05.1', 'enclave error counted as Invalid (05.1 sees the missing client-fault refund first)'],
  ];
  for (const [fault, stepIds, what] of cases) {
    it(`catches "${what}" in step ${stepIds}`, async () => {
      const results = await run([fault]);
      const catchers = stepIds.split('|').map((id) => results.find((x) => x.id === id));
      // some listed step fails on a real assertion (not a harness crash)
      const caught = catchers.some((r) => r?.status === 'fail' && r.checks.some((k) => !k.ok && !k.soft && k.label !== 'unexpected error'));
      expect(caught, `${stepIds} should fail under fault ${fault}: ${catchers.map((r) => `${r?.id}=${r?.status} ${r?.error ?? ''}`).join('; ')}`).toBe(true);
    });
  }
});
