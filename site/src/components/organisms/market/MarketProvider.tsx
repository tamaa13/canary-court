"use client";
// The app's one source of truth, shared by every /app page (it lives in the /app layout, so moving between pages keeps
// the same data). It is always the chain: the escrow's views, polled (lib/market/live.ts: one shared RPC limiter,
// history cache, lazy receipt re-checks). Until a fresh read lands it shows the last snapshot it has, which is chain
// data too: this browser's cache, else the one bundled at build (public/snapshot/market.json, `pnpm snapshot`),
// labelled with its time.
// URL params: ?contract=…&rpc=…&archival=…&e2e=1

import { useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Env } from "@/components/atoms";
import { offline } from "@/content/facts";
import { deriveEvents, type MarketEvent } from "@/lib/market/events";
import { filterE2e } from "@/lib/market/filter";
import { BUNDLED_RECEIPTS, useLive } from "@/lib/market/live";
import type { Snapshot } from "@/lib/market/snapshot";

export interface Market {
  contract: string;
  /** throwaway e2e run accounts are hidden; ?e2e=1 (a developer's param, not in the UI) shows them */
  showE2e: boolean;
  /** what's on screen: the live read, or the stand-in snapshot until one lands (e2e runs filtered) */
  snap: Snapshot | null;
  env: Env;
  events: MarketEvent[];
  /** events that appeared since the previous read */
  fresh: Set<string>;
  status: {
    /** a read from this minute is on screen */
    live: boolean;
    /** a stand-in is on screen (cache or bundled snapshot) */
    stale: boolean;
    error: string | null;
    updatedAt: number | null;
    receiptsChecked: [number, number];
    missingHistory: number;
  };
}

const Ctx = createContext<Market | null>(null);

export function useMarket(): Market {
  const m = useContext(Ctx);
  if (!m) throw new Error("useMarket outside MarketProvider");
  return m;
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const q = useSearchParams();
  const contract = q.get("contract") ?? "redteam.arifnovrian.testnet";
  const rpc = q.get("rpc");
  const archival = q.get("archival");
  const showE2e = q.get("e2e") === "1";
  const live = useLive(!offline, contract, rpc, archival, showE2e);

  // the stand-in for a live read: the bundled snapshot, fetched at once (a first visit has no cache to show)
  const [bundled, setBundled] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (bundled) return;
    let stop = false;
    fetch("/snapshot/market.json")
      .then((r) => r.json() as Promise<{ contract: string; snapshot: Snapshot }>)
      .then((d) => {
        if (!stop && d.contract === contract) setBundled({ ...d.snapshot, receipts: BUNDLED_RECEIPTS });
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [bundled, contract]);

  const current = live.snapshot ?? bundled;
  const snap = useMemo(() => (current ? filterE2e(current, showE2e) : null), [current, showE2e]);
  const freshRead = !!live.snapshot && !live.cached;
  const env: Env = useMemo(() => ({ live: true, nowMs: current?.timeMs ?? Date.now() }), [current?.timeMs]);
  const events = useMemo(() => (snap ? deriveEvents(snap, { links: true }) : []), [snap]);

  // what's new since the last read (not on the first one: everything would be "new")
  const seen = useRef<{ e2e: boolean; ids: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(events.map((e) => e.id));
    const prev = seen.current;
    if (prev && prev.e2e === showE2e && prev.ids.size) setFresh(new Set([...ids].filter((i) => !prev.ids.has(i))));
    else setFresh(new Set());
    seen.current = { e2e: showE2e, ids };
  }, [events, showE2e]);

  const value: Market = {
    contract,
    showE2e,
    snap,
    env,
    events,
    fresh,
    status: {
      live: freshRead,
      stale: !!current && !freshRead,
      error: live.error,
      updatedAt: live.updatedAt,
      receiptsChecked: live.receiptsChecked,
      missingHistory: live.snapshot?.missingHistory ?? 0,
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
