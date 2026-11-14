// Live mode: poll NEAR RPC views, every read pinned to one final block height.
// Public RPCs rate-limit per IP (a 429 arrives without CORS headers and looks like a network error), so all requests
// share one limiter (≤ 4 in flight) with jittered backoff; hidden e2e accounts are not fetched; and the attack-receipt
// re-checks run lazily after the first render, one at a time, cached in localStorage.
import { useEffect, useMemo, useRef, useState } from 'react';
import receipts from '../../../../agents/fixtures/attack-receipts.json';
import { Limiter, Rpc, TESTNET_RPCS, TESTNET_ARCHIVAL_RPCS } from '@/lib/near';
import { isE2eAccount, isFinished, loadSnapshot, newCache, type LoadCache, type Snapshot, type ReceiptRow } from './snapshot';
import type { AttackReceipt, Bid, Finding, Job } from './types';

// rt-agents' attack receipts (agents/fixtures/attack-receipts.json), bundled at build time. Each receipt's tx is re-checked
// on chain in the browser (below), so the bundle is only a list of what to check, never trusted as is.
export const BUNDLED_RECEIPTS: AttackReceipt[] = receipts as AttackReceipt[];

export interface LiveState {
  snapshot: Snapshot | null;
  /** true while showing the last snapshot from a previous visit (localStorage) until the first fresh poll lands */
  cached: boolean;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  /** attack receipts re-checked on chain so far / total with a tx hash */
  receiptsChecked: [number, number];
}

type Check = NonNullable<ReceiptRow['onchain']>;
const CACHE_KEY = 'canary-court.receipt-checks.v1';
const readCache = (): Record<string, Check> => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
};
const writeCache = (c: Record<string, Check>) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* private mode / quota: fine, checks just rerun next visit */
  }
};

// Finished jobs never change: keep their findings/bids across visits so reloads (and video retakes) are cheap.
const HISTORY_KEY = (contract: string) => `canary-court.history.v1.${contract}`;
type HistoryEntry = { key: string; findings: Finding[]; bids: Bid[] };
function seedCache(contract: string): LoadCache {
  const cache = newCache();
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY(contract)) ?? '{}') as Record<string, HistoryEntry>;
    for (const [id, e] of Object.entries(h)) {
      cache.jobKey.set(Number(id), e.key);
      cache.findings.set(Number(id), e.findings);
      cache.bids.set(Number(id), e.bids);
    }
  } catch {
    /* no storage: start cold */
  }
  return cache;
}
const SNAP_KEY = (contract: string, e2e: boolean) => `canary-court.snapshot.v1.${contract}.${e2e ? 'e2e' : 'main'}`;
function readSnapshot(contract: string, e2e: boolean): Snapshot | null {
  try {
    return JSON.parse(localStorage.getItem(SNAP_KEY(contract, e2e)) ?? 'null');
  } catch {
    return null;
  }
}
function writeSnapshot(contract: string, e2e: boolean, s: Snapshot) {
  try {
    localStorage.setItem(SNAP_KEY(contract, e2e), JSON.stringify(s));
  } catch {
    /* quota: fine */
  }
}

function persistHistory(contract: string, jobs: Job[], cache: LoadCache) {
  try {
    const h: Record<string, HistoryEntry> = {};
    for (const j of jobs.filter(isFinished)) {
      const key = cache.jobKey.get(j.id);
      if (key && key === JSON.stringify(j)) h[j.id] = { key, findings: cache.findings.get(j.id) ?? [], bids: cache.bids.get(j.id) ?? [] };
    }
    localStorage.setItem(HISTORY_KEY(contract), JSON.stringify(h));
  } catch {
    /* quota / private mode: fine */
  }
}

export function useLive(enabled: boolean, contractId: string, rpcUrl: string | null, archivalUrl: string | null, showE2e: boolean, pollMs = 10_000): LiveState {
  const [base, setBase] = useState<Omit<LiveState, 'receiptsChecked'>>({ snapshot: null, cached: false, error: null, loading: false, updatedAt: null });
  const [checks, setChecks] = useState<Record<string, Check>>(() => readCache());
  const limiter = useRef(new Limiter(3));

  // snapshot polling
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rpc = new Rpc(rpcUrl ? [rpcUrl] : TESTNET_RPCS, 15_000, limiter.current);
    const cache = seedCache(contractId);
    const skipAccount = showE2e ? undefined : isE2eAccount;
    // show the last snapshot from a previous visit right away (labelled as cached) while the first fresh poll runs
    const prev = readSnapshot(contractId, showE2e);
    setBase((s) => ({ ...s, loading: true, ...(prev && !s.snapshot ? { snapshot: prev, cached: true, updatedAt: null } : {}) }));
    let first = true;
    const tick = async () => {
      try {
        const head = await rpc.block({ finality: 'final' });
        const view = async <T,>(method: string, args: Record<string, unknown> = {}) => (await rpc.view<T>(contractId, method, args, { block_id: head.height })).value;
        // first poll: active jobs only → render fast; history of finished jobs fills in over the next polls
        const s = await loadSnapshot(view, { height: head.height, timeMs: head.timeMs }, cache, 3, { skipAccount, historyBudget: first ? 0 : 15, agentEvery: 3 });
        first = false;
        persistHistory(contractId, s.jobs, cache);
        const snap = { ...s, receipts: [] };
        writeSnapshot(contractId, showE2e, snap);
        if (!stop) setBase({ snapshot: snap, cached: false, error: null, loading: false, updatedAt: Date.now() });
      } catch (e) {
        if (!stop) setBase((prev) => ({ ...prev, error: (e as Error).message, loading: false }));
      }
      if (!stop) timer = setTimeout(tick, pollMs);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [enabled, contractId, rpcUrl, showE2e, pollMs]);

  // receipt re-checks: only after the first snapshot rendered, one at a time, never blocking the page
  const haveSnapshot = !!base.snapshot;
  useEffect(() => {
    if (!enabled || !haveSnapshot) return;
    let stop = false;
    const archival = new Rpc(archivalUrl ? [archivalUrl] : rpcUrl ? [rpcUrl] : [...TESTNET_ARCHIVAL_RPCS, ...TESTNET_RPCS], 30_000, limiter.current);
    (async () => {
      const done = readCache();
      for (const r of BUNDLED_RECEIPTS) {
        if (stop) return;
        if (!r.tx_hash || done[r.tx_hash]) continue;
        try {
          const o = await archival.txOutcome(r.tx_hash, r.signer);
          done[r.tx_hash] = { ok: o.ok, error: o.error };
          writeCache(done);
        } catch (e) {
          done[r.tx_hash] = { failed: (e as Error).message }; // not cached: retried on the next visit
        }
        if (!stop) setChecks({ ...done });
        await new Promise((ok) => setTimeout(ok, 1200));
      }
    })();
    return () => {
      stop = true;
    };
  }, [enabled, haveSnapshot, archivalUrl, rpcUrl]);

  return useMemo(() => {
    const withHash = BUNDLED_RECEIPTS.filter((r) => r.tx_hash);
    const snapshot = base.snapshot ? { ...base.snapshot, receipts: BUNDLED_RECEIPTS.map((r) => ({ ...r, onchain: r.tx_hash ? checks[r.tx_hash] : undefined })) } : null;
    return { ...base, snapshot, receiptsChecked: [withHash.filter((r) => checks[r.tx_hash!] && !('failed' in checks[r.tx_hash!])).length, withHash.length] as [number, number] };
  }, [base, checks]);
}
