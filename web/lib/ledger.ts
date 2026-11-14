// Money accounting of a job tree (root + its subjobs): paid out, refunded, and still in escrow.
// Used by e2e/verify-demo.ts to check budget = paid + refunded + escrow on live fixtures.
import type { Finding, Job } from './types';

const big = (v: string | number | bigint | null | undefined) => BigInt(v ?? 0);

interface TreeLedger {
  root: Job;
  subRewards: bigint; // paid_attacker in subjobs
  leadMargins: bigint; // paid_lead
  providerRewards: bigint; // paid_attacker in the root job
  remaining: bigint; // Σ remaining across the tree (still in escrow)
  refunded: bigint; // derived: budget − paid − remaining
}

export function ledger(jobs: Job[], findings: Finding[]): TreeLedger[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return jobs
    .filter((j) => j.parent_id === null || j.parent_id === undefined)
    .map((root) => {
      const tree = [root, ...root.children.map((c) => byId.get(c)).filter((x): x is Job => !!x)];
      const ids = new Set(tree.map((j) => j.id));
      const fs = findings.filter((f) => ids.has(f.job_id));
      const subRewards = fs.filter((f) => byId.get(f.job_id)!.depth > 0).reduce((x, f) => x + big(f.paid_attacker), 0n);
      const providerRewards = fs.filter((f) => f.job_id === root.id).reduce((x, f) => x + big(f.paid_attacker), 0n);
      const leadMargins = fs.reduce((x, f) => x + big(f.paid_lead), 0n);
      const remaining = tree.reduce((x, j) => x + big(j.remaining), 0n);
      return { root, subRewards, leadMargins, providerRewards, remaining, refunded: big(root.budget) - subRewards - providerRewards - leadMargins - remaining };
    });
}
