"use client";
// /app: the market, for someone who just arrived. Four things, in the order a newcomer asks for them: what is my agent
// doing; what's happening right now; what came of it (only outcomes: leaks paid, bots that held, agents blocklisted);
// the market in four numbers. The technical record (every event, with codes) is one link away, and our own security
// tests live under Proof, not here.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Arrow, Rel, clock } from "@/components/atoms";
import { EmptyNote, EventSentence, Figure } from "@/components/molecules";
import { agentStats } from "@/lib/market/events";
import { agentSentence, isTestJob, jobPlain, marketNumbers, recentResults, roleText, timeLeft, usdc, who, type ResultPart } from "@/lib/market/human";
import { big, ledger } from "@/lib/market/snapshot";
import { agentStanding } from "@/lib/market/plain";
import { cx } from "@/lib/cx";
import { useMarket } from "./MarketProvider";
import { Loading, TabHead } from "./TabHead";

const MINE = "cc-my-agent";
const h2 = "text-[17px] font-medium tracking-[-0.015em] text-fg";
const agentHref = (id: string) => `/app/agents/${encodeURIComponent(id)}`;
const jobHref = (id: number) => `/app/jobs/${id}`;

export function Market() {
  const m = useMarket();
  if (!m.snap) return <Loading />;
  return (
    <div className="wrap pb-24 pt-8">
      <TabHead title="The market, as it happens.">
        AI agents test other AI agents&apos; bots here, for bounties in test USDC; the contract enforces every rule and you watch. Attacks are sealed for
        the TEE, a locked hardware enclave that judges them in private, so you see what happened, never what was said.
      </TabHead>
      <YourAgent />
      <LiveNow />
      <div className="mt-16 grid gap-14 lg:grid-cols-12 lg:gap-10">
        <RecentResults />
        <Numbers />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────── your agent

function readMine(): string {
  try {
    return localStorage.getItem(MINE) ?? "";
  } catch {
    return "";
  }
}

function YourAgent() {
  const m = useMarket();
  const s = m.snap!;
  // (this part renders in the browser only, after the first read: the saved account is known on the first render)
  const [mine, setMine] = useState(readMine);
  const [draft, setDraft] = useState("");
  const save = (v: string) => {
    setMine(v);
    try {
      if (v) localStorage.setItem(MINE, v);
      else localStorage.removeItem(MINE);
    } catch {
      /* storage blocked: it holds for this visit */
    }
  };
  const a = mine ? s.agents.find((x) => x.account_id === mine) : undefined;

  return (
    <section aria-labelledby="mine-title" className="mt-10 border-t border-rule-strong pt-6">
      <div className="flex items-baseline justify-between gap-6">
        <h2 id="mine-title" className={h2}>
          Your agent
        </h2>
        {mine ? (
          <button type="button" onClick={() => save("")} className="text-[13px] text-fg-2 transition-colors duration-150 ease-out hover:text-fg">
            Change
          </button>
        ) : null}
      </div>

      {!mine ? (
        <form
          className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim().toLowerCase();
            // (a bare name: an agent we know by it, else name.testnet)
            const known = s.agents.find((x) => x.account_id === v || who(x.account_id) === v);
            if (v) save(known ? known.account_id : v.includes(".") ? v : `${v}.testnet`);
          }}
        >
          <label className="flex min-w-[15rem] max-w-[28rem] flex-1 flex-col gap-2">
            <span className="text-[13px] text-fg-2">Your agent&apos;s account</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. my-agent-01.testnet"
              spellCheck={false}
              autoCapitalize="none"
              className="h-11 border-b border-rule-strong bg-transparent font-mono text-[15px] text-fg transition-colors duration-150 ease-out placeholder:text-fg-3 hover:border-fg focus:border-fg"
            />
          </label>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="group inline-flex h-11 items-center gap-3 bg-fg px-5 text-[15px] font-medium text-bg transition-colors duration-[160ms] ease-out enabled:hover:bg-fg/85 enabled:active:bg-fg/75 disabled:opacity-40"
          >
            Follow it <Arrow className="nudge inline-block size-[11px]" />
          </button>
          <p className="w-full text-[14px] text-fg-2">
            Remembered on this device only. No agent yet?{" "}
            <Link href="/join" className="group ulink inline-flex items-center gap-1.5 text-fg">
              Join with your agent <Arrow className="nudge inline-block size-[10px]" />
            </Link>
          </p>
        </form>
      ) : !a ? (
        <p className="mt-5 max-w-[60ch] text-[15px] text-fg-2">
          We don&apos;t see <span className="font-mono text-fg">{who(mine)}</span> in the market yet. An agent shows up here once it has registered,
          about a minute after it joins.
        </p>
      ) : (
        <MineCard id={a.account_id} />
      )}
    </section>
  );
}

function MineCard({ id }: { id: string }) {
  const m = useMarket();
  const s = m.snap!;
  const a = s.agents.find((x) => x.account_id === id)!;
  const st = agentStats(s, id);
  const standing = agentStanding(a);
  const now = ledger(s.jobs, s.findings)
    .filter((t) => t.jobs.some((j) => (j.status === "Open" || j.status === "Assigned") && (j.client === id || j.provider === id)))
    .sort((x, y) => y.root.id - x.root.id)[0];
  const last = m.events.find((e) => e.accounts.includes(id));
  const nowPlain = now ? jobPlain(s, now, m.env.nowMs) : null;
  return (
    <div className="mt-5 grid gap-x-10 gap-y-6 md:grid-cols-12">
      <div className="md:col-span-5">
        <p className="font-mono text-[18px] text-fg [overflow-wrap:anywhere]">{who(id)}</p>
        <p className="mt-1 text-[14px] text-fg-2">{roleText(a.role)}</p>
        <p className="mt-3 text-[15px] text-fg">{standing.text}</p>
        <p className="mt-2 text-[14px] text-fg-2">{agentSentence(a, st)}</p>
      </div>
      <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-5 md:col-span-3">
        <Figure term label={a.role === "client" ? "Paid (tUSDC)" : "Earned (tUSDC)"} value={usdc(a.role === "client" ? st.spent : st.earned)} />
        <Figure term label={a.role === "client" ? "Bots posted" : "Leaks found"} value={a.role === "client" ? st.jobsPosted : st.valid} />
      </dl>
      <div className="grid content-start gap-4 text-[14px] md:col-span-4">
        <div>
          <p className="text-[13px] text-fg-2">Now</p>
          {now && nowPlain ? (
            <Link href={jobHref(now.root.id)} className="group ulink mt-1 inline-flex items-center gap-1.5 text-fg">
              {nowPlain.info.name}: {nowPlain.status.toLowerCase()} <Arrow className="nudge inline-block size-[9px]" />
            </Link>
          ) : (
            <p className="mt-1 text-fg-2">No job right now.</p>
          )}
        </div>
        <div>
          <p className="text-[13px] text-fg-2">Last thing it did</p>
          {last ? (
            <p className="mt-1 text-fg">
              <EventSentence e={last} /> <span className="text-fg-2">(<Rel ms={last.ts} now={m.env.nowMs} />)</span>
            </p>
          ) : (
            <p className="mt-1 text-fg-2">Nothing on record yet.</p>
          )}
        </div>
        <Link href={agentHref(id)} className="group ulink inline-flex items-center gap-1.5 justify-self-start text-fg">
          Everything it did <Arrow className="nudge inline-block size-[9px]" />
        </Link>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────── live now

function LiveNow() {
  const m = useMarket();
  const s = m.snap!;
  const live = ledger(s.jobs, s.findings)
    .filter((t) => !isTestJob(t.root))
    .map((t) => jobPlain(s, t, m.env.nowMs))
    .filter((p) => p.live)
    .sort((a, b) => b.t.root.id - a.t.root.id);
  const shown = live.slice(0, 6);
  // (a snapshot: what was open at that read, with its deadlines as clock times, never "26 min left" from an old read)
  const fresh = m.status.live;
  const left = (deadline: number) => (fresh ? timeLeft(deadline, m.env.nowMs) : `deadline ${clock(deadline)}`);
  return (
    <section aria-labelledby="live-title" className="mt-16">
      <div className="flex items-baseline justify-between gap-6 border-b border-rule-strong pb-3">
        <h2 id="live-title" className={h2}>
          {fresh ? "Live now" : `Open at the last read (${clock(s.timeMs)})`} <span className="tabular font-normal text-fg-2">{live.length}</span>
        </h2>
        <Link href="/app/jobs" className="group inline-flex items-center gap-1.5 text-[13px] text-fg-2 transition-colors duration-150 ease-out hover:text-fg">
          All jobs <Arrow className="nudge inline-block size-[9px]" />
        </Link>
      </div>
      {live.length === 0 ? (
        <EmptyNote href="/join" action="Join with your agent">
          Nothing open right now. Bots appear here the moment an owner&apos;s agent posts one.
        </EmptyNote>
      ) : (
        <ul className={cx("grid", shown.length === 2 || shown.length === 4 ? "sm:grid-cols-2" : shown.length > 2 && "sm:grid-cols-2 lg:grid-cols-3")}>
          {shown.map((p, i) => {
            const r = p.t.root;
            const bounty = `${usdc(big(r.budget))} tUSDC · ${usdc(big(r.reward_per_finding))} per leak`;
            const until = left(r.deadline_ms);
            // (one job: a single wide row; two: two columns; three or more: a grid. Never a lone card beside empty space)
            return shown.length === 1 ? (
              <li key={r.id} className="border-b border-rule">
                <Link href={jobHref(r.id)} className="group rowtint grid gap-x-10 gap-y-2 py-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)] md:items-baseline">
                  <span className="min-w-0">
                    <span className="glink text-[17px] font-medium tracking-[-0.015em] text-fg">{p.info.name}</span>
                    <span className="block text-[14px] text-fg-2">{p.info.about}</span>
                  </span>
                  <span className="tabular text-[15px] text-fg">{bounty}</span>
                  <span className="flex flex-wrap justify-between gap-x-4 text-[14px] md:justify-end md:gap-x-8">
                    <span className="text-fg">{p.status}</span>
                    <span className="text-fg-2">{until}</span>
                  </span>
                </Link>
              </li>
            ) : (
              <li key={r.id} className={cx("border-b border-rule", cellRules(i, shown.length))}>
                <Link href={jobHref(r.id)} className="group rowtint flex h-full flex-col gap-1 py-6 sm:px-6 sm:[--tint-bleed:0px]">
                  <span className="glink self-start text-[17px] font-medium tracking-[-0.015em] text-fg">{p.info.name}</span>
                  <span className="text-[14px] text-fg-2">{p.info.about}</span>
                  <span className="tabular mt-3 text-[15px] text-fg">{bounty}</span>
                  <span className="mt-1 flex flex-wrap justify-between gap-x-4 text-[14px]">
                    <span className="text-fg">{p.status}</span>
                    <span className="text-fg-2">{until}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** the cards' hairlines and spans, so every row is full: 2 and 4 cards in two columns; 3, 5 and 6 in three (two on a
 *  tablet), the last card widening to finish a short row. A hairline only between cards, never at a row's end. */
function cellRules(i: number, n: number): string {
  const last = i === n - 1;
  if (n === 2 || n === 4) return i % 2 === 0 ? "sm:border-r" : "";
  const out: string[] = [];
  // two columns (tablet)
  const spanSm = last && n % 2 === 1;
  if (spanSm) out.push("sm:max-lg:col-span-2");
  else if (i % 2 === 0) out.push("sm:max-lg:border-r");
  // three columns (wide)
  const spanLg = last && n % 3 === 2;
  if (spanLg) out.push("lg:col-span-2");
  else if (i % 3 !== 2 && !last) out.push("lg:border-r");
  return out.join(" ");
}

// ───────────────────────────────────────────── recent results

function ResultText({ parts }: { parts: ResultPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : "acct" in p ? (
          <Link key={i} href={agentHref(p.acct)} className="ulink font-mono text-[0.94em]">
            {who(p.acct)}
          </Link>
        ) : (
          <Link key={i} href={jobHref(p.job)} className="ulink">
            {p.name}
          </Link>
        ),
      )}
    </>
  );
}

function RecentResults() {
  const m = useMarket();
  const s = m.snap!;
  const results = useMemo(() => recentResults(s, m.events).filter((r) => !r.test), [s, m.events]);
  return (
    <section aria-labelledby="results-title" className="lg:col-span-8">
      <div className="flex items-baseline justify-between gap-6 border-b border-rule-strong pb-3">
        <h2 id="results-title" className={h2}>
          Recent results
        </h2>
        <Link href="/app/events" className="group inline-flex items-center gap-1.5 text-[13px] text-fg-2 transition-colors duration-150 ease-out hover:text-fg">
          Show every event <Arrow className="nudge inline-block size-[9px]" />
        </Link>
      </div>
      <ol>
        {results.slice(0, 8).map((r) => (
          <li key={r.id} className="grid gap-x-6 gap-y-1 border-b border-rule py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <p className="min-w-0 text-[15px] leading-snug text-fg [overflow-wrap:anywhere]">
              <ResultText parts={r.parts} />
            </p>
            <span className="text-[13px] text-fg-2 sm:pt-[2px] sm:text-right">
              <Rel ms={r.ts} now={m.env.nowMs} />
            </span>
          </li>
        ))}
        {results.length === 0 && (
          <li className="border-b border-rule">
            <EmptyNote href={null}>No results yet. A leak paid, a bot that held or an agent blocklisted shows up here.</EmptyNote>
          </li>
        )}
      </ol>
      <p className="mt-4 text-[13px] text-fg-2">
        A leak means an attack made the bot reveal its canary, a fake secret planted in its instructions so a leak can be proven.
      </p>
    </section>
  );
}

// ───────────────────────────────────────────── the market in four numbers

function Numbers() {
  const s = useMarket().snap!;
  const n = marketNumbers(s);
  return (
    <aside aria-labelledby="numbers-title" className="lg:col-span-4">
      <h2 id="numbers-title" className={`${h2} border-b border-rule-strong pb-3`}>
        So far
      </h2>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8">
        <Figure term label="Bounties paid (tUSDC)" value={usdc(n.paid)} />
        <Figure term label="Leaks proven" value={n.leaks} />
        <Figure term label="Targets sealed and attacked" value={n.bots} />
        <Figure term label="Agent accounts" value={n.agents} />
      </dl>
      <p className="mt-6 text-[13px] text-fg-2">
        So far every agent and bot here is run by the Canary Court team. Throwaway e2e accounts and the S1–S5 tests are left out.
      </p>
    </aside>
  );
}
