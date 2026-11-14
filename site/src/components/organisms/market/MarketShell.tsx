"use client";
// The frame every /app page shares: what the page is reading and how fresh it is, and the app's tabs (each its own
// route). The page's own content goes under it.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StatusLabel } from "@/components/molecules";
import { cx } from "@/lib/cx";
import { shortAcct } from "@/lib/market/events";
import { FindBox } from "./FindBox";
import { useMarket } from "./MarketProvider";

const NAV = [
  { href: "/app", label: "Market", match: (p: string) => p === "/app" || p.startsWith("/app/events") },
  { href: "/app/jobs", label: "Jobs", match: (p: string) => p.startsWith("/app/jobs") },
  { href: "/app/agents", label: "Agents", match: (p: string) => p.startsWith("/app/agents") },
  { href: "/app/proof", label: "Proof", match: (p: string) => p.startsWith("/app/proof") },
];

export function MarketShell({ children }: { children: ReactNode }) {
  const m = useMarket();
  const path = usePathname();
  const s = m.snap;
  return (
    <>
      <div className="wrap pt-8 md:pt-10">
        {/* what this is reading, and how fresh it is */}
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-rule pb-4">
          {/* (one quiet line: where the data comes from, and how fresh it is) */}
          <p className="truncate text-[14px] text-fg-2">
            {m.status.live
              ? `Testnet · updated ${m.status.updatedAt ? new Date(m.status.updatedAt).toLocaleTimeString("en-US", { hour12: false }) : "now"} · block ${s?.height?.toLocaleString("en-US") ?? "…"}`
              : m.status.stale && s
                ? `Testnet · cached read from ${snapTime(s.timeMs)}, refreshing`
                : "Testnet · loading the market"}
          </p>
        </div>
        {m.status.error && !m.status.live && (
          <p className="border-b border-rule py-3" role="status">
            <StatusLabel tone="muted">{`Public RPC is busy (${m.status.error.slice(0, 80)}); retrying, the snapshot stands in`}</StatusLabel>
          </p>
        )}

        {/* the app's sections */}
        <div className="flex flex-wrap items-center justify-between gap-x-8 border-b border-rule">
        <nav aria-label="App tabs" className="min-w-0 max-w-full">
          <ul className="flex gap-7 overflow-x-auto py-3.5 text-[15px] [scrollbar-width:none]">
            {NAV.map((n) => {
              const on = n.match(path);
              return (
                <li key={n.href} className="shrink-0">
                  <Link
                    href={n.href}
                    aria-current={on ? "page" : undefined}
                    className={cx("border-b pb-0.5 transition-colors duration-150 ease-out", on ? "border-fg text-fg [border-bottom-width:2px]" : "border-transparent text-fg-2 hover:text-fg")}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <FindBox />
        </div>
      </div>
      {children}
    </>
  );
}

/** "Nov 14, 04:43": short enough for one line on a phone */
const snapTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
