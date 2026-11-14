"use client";
// A moment, said relative to now ("5m ago", "in 26m") while the page shows a live read. While it shows a cached or
// bundled snapshot (SnapshotTime), "now" would be the snapshot's time, which reads as wrong hours later: then it's the
// clock time instead ("12:31", or "Nov 13, 22:10" on another day), and the status line says when the read was.

import { createContext, useContext } from "react";

/** true while the market on screen is a snapshot, not a fresh read (set by MarketProvider) */
export const SnapshotTime = createContext(false);

export const clock = (ms: number, ref = Date.now()) => {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date(ref).toDateString();
  const hm = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return sameDay ? hm : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${hm}`;
};

export function Rel({ ms, now }: { ms: number | null | undefined; now: number }) {
  const snapshot = useContext(SnapshotTime);
  if (!ms) return <span className="text-fg-3">—</span>;
  if (snapshot)
    return (
      <span className="tabular whitespace-nowrap" title={new Date(ms).toISOString()}>
        {clock(ms)}
      </span>
    );
  const d = ms - now;
  const a = Math.abs(d);
  const txt =
    a < 60_000 ? `${Math.round(a / 1000)}s` : a < 3_600_000 ? `${Math.round(a / 60_000)}m` : a < 86_400_000 ? `${(a / 3_600_000).toFixed(1)}h` : `${(a / 86_400_000).toFixed(1)}d`;
  return (
    <span className="tabular whitespace-nowrap" title={new Date(ms).toISOString()}>
      {d >= 0 ? `in ${txt}` : `${txt} ago`}
    </span>
  );
}
