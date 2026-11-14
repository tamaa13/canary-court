// Ordered, stateful test runner. Steps share one context; a step whose dependency did not pass is skipped.
// A step that finishes without error but ran 0 checks is 'na' (not exercised), never 'pass'.
import type { Chain, Signer, Tx, CallOpts } from './chain';
import type { Ctx } from './ctx';

export type Status = 'pass' | 'fail' | 'skip' | 'na';

export interface Check {
  label: string;
  ok: boolean;
  soft?: boolean; // soft = expectation beyond the spec text; failure is reported as a warning
  /** a failed rejection check: fails the step but does not block dependent steps */
  nonBlocking?: boolean;
  detail?: string;
}

export interface StepResult {
  id: string;
  area: number;
  title: string;
  status: Status;
  /** false when the step failed only on non-blocking checks (dependents still run) */
  blocking: boolean;
  warnings: number;
  ms: number;
  checks: Check[];
  txs: Tx[];
  notes: string[];
  error?: string;
}

export interface Step {
  id: string; // "05.2"
  title: string;
  needs?: string[];
  run(t: T, c: Ctx): Promise<void>;
}

export const step = (id: string, title: string, needs: string[], run: Step['run']): Step => ({ id, title, needs, run });

class Fail extends Error {}

const show = (v: unknown): string =>
  typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export class T {
  checks: Check[] = [];
  txs: Tx[] = [];
  notes: string[] = [];
  constructor(
    readonly chain: Chain,
    private log: (s: string) => void,
  ) {}

  ok(label: string, cond: unknown, detail?: string): void {
    this.checks.push({ label, ok: !!cond, detail });
    if (!cond) throw new Fail(`${label}${detail ? ` — ${detail}` : ''}`);
  }

  eq(label: string, actual: unknown, expected: unknown): void {
    const a = show(actual);
    const e = show(expected);
    this.checks.push({ label: `${label} = ${e}`, ok: a === e, detail: a === e ? undefined : `got ${a}` });
    if (a !== e) throw new Fail(`${label}: expected ${e}, got ${a}`);
  }

  soft(label: string, cond: unknown, detail?: string): boolean {
    this.checks.push({ label, ok: !!cond, soft: true, detail });
    if (!cond) this.log(`    ⚠ ${label}${detail ? ` — ${detail}` : ''}`);
    return !!cond;
  }

  note(s: string): void {
    this.notes.push(s);
  }

  /** Sends a tx that must succeed. */
  async call(label: string, s: Signer, method: string, args: object = {}, opts?: CallOpts): Promise<Tx> {
    const tx = { ...(await this.chain.call(s, method, args, opts)), label };
    this.txs.push(tx);
    this.checks.push({ label: `${label} succeeds`, ok: tx.ok, detail: tx.ok ? undefined : tx.error ?? '' });
    if (!tx.ok) throw new Fail(`${label} failed: ${tx.error}`);
    return tx;
  }

  /** Sends a tx that must be rejected with one of `expect` (ERR codes) or matching a RegExp. */
  async reject(label: string, s: Signer, method: string, args: object, expect: string[] | RegExp, opts?: CallOpts): Promise<Tx> {
    const tx = { ...(await this.chain.call(s, method, args, opts)), label };
    this.txs.push(tx);
    const matched =
      !tx.ok && (expect instanceof RegExp ? expect.test(tx.error ?? '') : tx.code !== null && expect.includes(tx.code));
    const want = expect instanceof RegExp ? expect.toString() : expect.join(' | ');
    // A rejection check that fails is recorded and fails the step, but execution continues and dependents still run:
    // one over-strict negative check must not cascade into skipping the rest of a live run. If an unexpected
    // success changed state, the step's own state assertions fail hard.
    this.checks.push({
      label: `${label} rejected with ${want}`,
      ok: matched,
      nonBlocking: true,
      detail: tx.ok ? 'tx SUCCEEDED (policy not enforced)' : matched ? tx.error ?? undefined : `got: ${tx.error}`,
    });
    if (!matched) this.log(`    ✗ ${label}: expected rejection ${want}, ${tx.ok ? 'but it succeeded' : `got ${tx.error}`} (non-blocking)`);
    return tx;
  }

  /** Raw tx (no expectation) — caller asserts. */
  async send(label: string, s: Signer, method: string, args: object = {}, opts?: CallOpts): Promise<Tx> {
    const tx = { ...(await this.chain.call(s, method, args, opts)), label };
    this.txs.push(tx);
    return tx;
  }

  record(tx: Tx, label?: string) {
    this.txs.push(label ? { ...tx, label } : tx);
  }

  /** Polls `probe` until `done` holds (or throws after timeout). Uses chain.sleep → instant on mock. */
  async waitFor<V>(label: string, probe: () => Promise<V>, done: (v: V) => boolean, timeoutMs: number, everyMs = 3000): Promise<V> {
    const start = await this.chain.head();
    let waited = 0;
    for (;;) {
      const v = await probe();
      if (done(v)) {
        this.checks.push({ label: `${label} (after ~${Math.round(waited / 1000)}s)`, ok: true });
        return v;
      }
      if (waited >= timeoutMs) {
        this.checks.push({ label, ok: false, detail: `timeout after ${timeoutMs / 1000}s (from block ${start.height}); last: ${show(v).slice(0, 300)}` });
        throw new Fail(`${label}: timeout after ${timeoutMs / 1000}s`);
      }
      await this.chain.sleep(everyMs);
      waited += everyMs;
    }
  }
}

export async function runSteps(steps: Step[], c: Ctx, log: (s: string) => void, only?: Set<string>): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const byId = new Map<string, StepResult>();
  const wanted = only ? withDeps(steps, only) : null;
  for (const s of steps) {
    if (wanted && !wanted.has(s.id)) continue;
    const area = Number(s.id.split('.')[0]);
    const unmet = (s.needs ?? []).filter((d) => {
      const r = byId.get(d);
      return !r || r.status === 'skip' || (r.status === 'fail' && r.blocking);
    });
    if (unmet.length) {
      const r: StepResult = { id: s.id, area, title: s.title, status: 'skip', blocking: true, warnings: 0, ms: 0, checks: [], txs: [], notes: [`skipped: needs ${unmet.join(', ')}`] };
      results.push(r);
      byId.set(s.id, r);
      log(`  - ${s.id} ${s.title} … SKIP (needs ${unmet.join(', ')})`);
      continue;
    }
    const t = new T(c.chain, log);
    const t0 = Date.now();
    log(`  ▸ ${s.id} ${s.title}`);
    let status: Status = 'pass';
    let error: string | undefined;
    try {
      await s.run(t, c);
    } catch (e) {
      status = 'fail';
      error = e instanceof Error ? e.message : String(e);
      if (!(e instanceof Fail)) t.checks.push({ label: 'unexpected error', ok: false, detail: error });
    }
    const nonBlockingFails = t.checks.filter((k) => k.nonBlocking && !k.ok);
    if (status === 'pass' && nonBlockingFails.length) {
      status = 'fail';
      error = `${nonBlockingFails.length} rejection check(s) failed: ${nonBlockingFails.map((k) => k.label).join('; ')}`;
    }
    // nothing was asserted (e.g. a path that can't be forced on testnet and didn't occur naturally): not exercised
    if (status === 'pass' && t.checks.length === 0) status = 'na';
    const blocking = t.checks.some((k) => !k.ok && !k.soft && !k.nonBlocking);
    const r: StepResult = {
      id: s.id,
      area,
      title: s.title,
      blocking,
      status,
      warnings: t.checks.filter((k) => k.soft && !k.ok).length,
      ms: Date.now() - t0,
      checks: t.checks,
      txs: t.txs,
      notes: t.notes,
      error,
    };
    results.push(r);
    byId.set(s.id, r);
    c.history.push(...t.txs);
    log(`    ${status === 'pass' ? '✓ pass' : status === 'na' ? '– n/a (0 checks: not exercised)' : '✗ FAIL'}${r.warnings ? ` (${r.warnings} warning)` : ''}${error ? ` — ${error}` : ''}`);
  }
  return results;
}

function withDeps(steps: Step[], only: Set<string>): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    const s = byId.get(id);
    if (!s) return;
    out.add(id);
    for (const d of s.needs ?? []) visit(d);
  };
  for (const s of steps) if ([...only].some((o) => s.id === o || s.id.startsWith(`${o}.`))) visit(s.id);
  return out;
}
