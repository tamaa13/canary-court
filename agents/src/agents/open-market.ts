/**
 * Accept rule of the client's keep-open watcher (`pnpm keep-open`), kept pure for tests: the first Open bid (oldest
 * first) whose bidder is not one of our own operator agents, whose note is clean, whose price ≤ the reward and whose
 * check_counterparty verdict is Allow. Everything else is skipped with a reason (Warn bidders are retried later).
 */
import type { Bid, Verdict } from '../chain/types.js';
import { isInjectionNote } from './screen.js';

interface BidDecision { accept: Bid | null; skipped: { bidder: string; reason: string; retry: boolean }[] }

export function pickBid(bids: Bid[], verdicts: Map<string, Verdict>, maxPrice: bigint, isOwnAgent: (account: string) => boolean): BidDecision {
  const skipped: BidDecision['skipped'] = [];
  const open = bids.filter((b) => b.status === 'Open').sort((a, b) => (a.created_ms ?? 0) - (b.created_ms ?? 0));
  for (const b of open) {
    const v = verdicts.get(b.bidder);
    const reason = isOwnAgent(b.bidder) ? 'own operator agent (kept off this job)'
      : isInjectionNote(b.note) ? 'note looks like a prompt injection'
        : BigInt(b.price_per_finding) > maxPrice ? `price ${Number(b.price_per_finding) / 1e6} tUSDC above the reward`
          : !v ? 'no verdict'
            : v.level !== 'Allow' ? `verdict ${v.level}` : null;
    if (!reason) return { accept: b, skipped };
    skipped.push({ bidder: b.bidder, reason, retry: reason === 'verdict Warn' || reason === 'no verdict' });
  }
  return { accept: null, skipped };
}
