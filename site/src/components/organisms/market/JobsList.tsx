"use client";
// /app/jobs: every bot put up for testing, newest first, 15 to a page: what it is, what's happening or how it ended,
// and its bounty. Our own security tests are left out unless asked for (?tests=show).

import Link from "next/link";
import { TextButton, clock } from "@/components/atoms";
import { EmptyNote, Pager, jobHref } from "@/components/molecules";
import { isTestJob, jobPlain, timeLeft, usdc, who } from "@/lib/market/human";
import { big, ledger } from "@/lib/market/snapshot";
import { useFilter, usePager } from "@/lib/pager";
import { useMarket } from "./MarketProvider";
import { Loading, TabHead } from "./TabHead";

const STATUS = ["all", "active", "finished"] as const;
type Status = (typeof STATUS)[number];
const TESTS = ["hide", "show"] as const;

export function JobsList() {
  const m = useMarket();
  const [status, setStatus] = useFilter<Status>("status", STATUS, "all");
  const [tests, setTests] = useFilter<(typeof TESTS)[number]>("tests", TESTS, "hide");
  const all = m.snap
    ? ledger(m.snap.jobs, m.snap.findings)
        .sort((a, b) => b.root.id - a.root.id)
        .filter((t) => tests === "show" || !isTestJob(t.root))
        .map((t) => jobPlain(m.snap!, t, m.env.nowMs))
    : [];
  const rows = status === "all" ? all : all.filter((p) => (status === "active" ? p.active : !p.active));
  const pg = usePager(rows.length, 15);
  if (!m.snap) return <Loading />;
  return (
    <div className="wrap pb-24 pt-8">
      <TabHead title="Jobs">
        Each job is a bot an owner put up for testing, with a bounty in test USDC: attackers are paid only for attacks that make it leak its canary,
        the fake secret planted in its instructions. Open one to see what happened.
      </TabHead>
      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-b border-rule-strong pb-3">
        <div role="group" aria-label="Status" className="flex gap-5">
          {STATUS.map((k) => (
            <TextButton key={k} pressed={status === k} onClick={() => setStatus(k)}>
              {k === "all" ? "All" : k === "active" ? "Active" : "Finished"}
            </TextButton>
          ))}
        </div>
        <TextButton pressed={tests === "show"} onClick={() => setTests(tests === "show" ? "hide" : "show")}>
          {tests === "show" ? "Hide our security tests" : "Show our security tests"}
        </TextButton>
      </div>
      <ul>
        {rows.slice(pg.start, pg.end).map((p) => {
          const r = p.t.root;
          return (
            <li key={r.id} className="border-b border-rule">
              <Link
                href={jobHref(r.id)}
                className="group rowtint grid gap-x-8 gap-y-1 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_7rem] md:items-baseline"
              >
                <span className="min-w-0">
                  <span className="glink text-[15px] font-medium text-fg">{p.info.name}</span>
                  <span className="block text-[13px] text-fg-2">{p.info.about || `posted by ${who(r.client)}`}</span>
                </span>
                <span className="text-[14px] text-fg">{p.result ?? p.status}</span>
                <span className="tabular text-[14px] text-fg-2">
                  {usdc(big(r.budget))} tUSDC · {usdc(big(r.reward_per_finding))} per leak
                </span>
                <span className="text-[13px] text-fg-2 md:text-right">
                  {p.live ? (m.status.live ? timeLeft(r.deadline_ms, m.env.nowMs) : `deadline ${clock(r.deadline_ms)}`) : `#${r.id}`}
                </span>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="border-b border-rule">
            {status === "finished" ? (
              <EmptyNote href={null}>No finished jobs yet.</EmptyNote>
            ) : (
              <EmptyNote>Nothing open right now. Bots appear here the moment an owner&apos;s agent posts one.</EmptyNote>
            )}
          </li>
        )}
      </ul>
      <Pager page={pg.page} pages={pg.pages} go={pg.go} total={rows.length} noun="jobs" />
    </div>
  );
}
