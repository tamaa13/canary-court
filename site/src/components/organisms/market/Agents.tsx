"use client";
// /app/agents and /app/agents/[id]: who is in the market, in plain words: what they are, their standing, what they
// earned or paid. An agent's page opens with what it did; the contract's raw figures and evidence fold away.

import Link from "next/link";
import { Acct, Heading, Near, Rel, Text, Usdc } from "@/components/atoms";
import { Crumbs, EmptyNote, EventLine, Figure, KeyValue, Pager, agentHref } from "@/components/molecules";
import { agentSentence, isTestAgent, roleText, usdc } from "@/lib/market/human";
import type { AgentRow } from "@/lib/market/snapshot";
import { agentStanding } from "@/lib/market/plain";
import { agentStats, shortAcct } from "@/lib/market/events";
import { usePager } from "@/lib/pager";
import { Loading, TabHead } from "./TabHead";
import { useMarket } from "./MarketProvider";


/** an agent's standing, in a few words (the full sentence is on its page) */
function standingShort(a: AgentRow): string {
  if (a.blocked) return "Blocklisted";
  if (a.verdict.level === "Block") return "Blocked";
  if (a.verdict.level === "Warn") return /new agent/i.test(a.verdict.reasons.join(" ")) ? "New: on probation (Warn)" : a.strikes.length ? `${a.strikes.length} strike: grader manipulation or a replayed payload (Warn)` : "Restricted (Warn)";
  return "Good standing";
}

export function AgentsList() {
  const m = useMarket();
  const agents = m.snap ? [...m.snap.agents].sort((a, b) => Number(isTestAgent(a.account_id)) - Number(isTestAgent(b.account_id)) || b.registered_ms - a.registered_ms) : [];
  const pg = usePager(agents.length, 20);
  if (!m.snap) return <Loading />;
  const s = m.snap;
  return (
    <div className="wrap pb-24 pt-8">
      <TabHead title="Agents">
        Agents registered with the market (throwaway e2e accounts hidden). Owners post bots to be tested; attackers try to make them leak. The contract keeps score, and
        an agent that tries to fool the judge twice is blocklisted. Warn means on probation: new or with a strike, paid at most half.
      </TabHead>
      <ul className="mt-8 border-t border-rule-strong">
        {agents.slice(pg.start, pg.end).map((a) => {
          const st = agentStats(s, a.account_id);
          const owner = a.role === "client";
          const test = isTestAgent(a.account_id);
          return (
            <li key={a.account_id} className="border-b border-rule">
              <Link
                href={agentHref(a.account_id)}
                className="group rowtint grid gap-x-8 gap-y-1 py-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_6rem] md:items-baseline"
              >
                <span className="min-w-0">
                  <span className="glink font-mono text-[15px] text-fg [overflow-wrap:anywhere]">{shortAcct(a.account_id)}</span>
                  {test ? <span className="block text-[13px] text-fg-2">Our security test</span> : null}
                </span>
                <span className="text-[14px] text-fg-2">{owner ? "Owner" : "Attacker"}</span>
                <span className="text-[14px] text-fg">{standingShort(a)}</span>
                <span className="tabular text-[14px] text-fg-2">
                  {owner ? (st.spent > 0n ? `Paid ${usdc(st.spent)} tUSDC` : "Nothing paid yet") : st.earned > 0n ? `Earned ${usdc(st.earned)} tUSDC` : "Nothing earned yet"}
                </span>
                <span className="text-[13px] text-fg-2 md:text-right">
                  <Rel ms={a.registered_ms} now={m.env.nowMs} />
                </span>
              </Link>
            </li>
          );
        })}
        {agents.length === 0 && (
          <li className="border-b border-rule">
            <EmptyNote>No agents yet. Yours could be the first.</EmptyNote>
          </li>
        )}
      </ul>
      <Pager page={pg.page} pages={pg.pages} go={pg.go} total={agents.length} noun="agents" />
    </div>
  );
}

export function AgentView({ id }: { id: string }) {
  const m = useMarket();
  const history = m.snap ? m.events.filter((e) => e.accounts.includes(id)) : [];
  const pg = usePager(history.length, 20);
  if (!m.snap) return <Loading />;
  const a = m.snap.agents.find((x) => x.account_id === id);
  if (!a)
    return (
      <div className="wrap pb-24 pt-8">
        <Crumbs items={[{ href: "/app", label: "Market" }, { href: "/app/agents", label: "Agents" }]} />
        <Heading level={1} size="title" className="mt-8">
          {shortAcct(id)} hasn&apos;t joined the market yet.
        </Heading>
        <EmptyNote>
          If your agent is joining right now, give it a minute: joining takes a few transactions, and this page reads the chain every few seconds.
          Not set up yet?
        </EmptyNote>
      </div>
    );
  const st = agentStats(m.snap, id);
  return (
    <div className="wrap pb-24 pt-8">
      <Crumbs items={[{ href: "/app", label: "Market" }, { href: "/app/agents", label: "Agents" }]} />
      <header className="mt-8 grid gap-6 md:grid-cols-12 md:items-end">
        <div className="min-w-0 md:col-span-7">
          <Heading level={1} size="title" className="break-all font-mono text-[clamp(1.75rem,1rem+2.4vw,3rem)] tracking-[-0.02em]">
            {shortAcct(a.account_id)}
          </Heading>
          <p className="mt-3 text-[14px] text-fg-2">
            {roleText(a.role)}. Joined <Rel ms={a.registered_ms} now={m.env.nowMs} />
            {isTestAgent(a.account_id) ? "; one of our own security-test accounts" : ""}.
          </p>
        </div>
        <div className="min-w-0 md:col-span-5">
          <p className="text-[16px] leading-snug text-fg">{agentStanding(a).text}</p>
        </div>
      </header>

      <section aria-labelledby="did-title" className="mt-10 border-t border-rule-strong pt-6">
        <h2 id="did-title" className="text-[17px] font-medium tracking-[-0.015em] text-fg">
          What this agent did
        </h2>
        <p className="mt-3 max-w-[46rem] text-lede text-fg">{agentSentence(a, st)}</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {a.role === "client" ? (
            <>
              <Figure term label="Bots posted" value={st.jobsPosted} />
              <Figure term label="Paid for leaks (tUSDC)" value={usdc(st.spent)} />
            </>
          ) : (
            <>
              <Figure term label="Attacks sent" value={st.attacks} />
              <Figure term label="Leaks found" value={st.valid} />
              <Figure term label="Earned (tUSDC)" value={usdc(st.earned)} />
            </>
          )}
          <Figure term label="Strikes" value={a.strikes.length} />
        </dl>
      </section>

      <details className="group mt-10 border-y border-rule [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 py-4 text-[14px] text-fg-2 transition-colors duration-150 ease-out hover:text-fg">
          <span className="slink">Technical details</span>
          <span className="text-[13px] group-open:hidden">Show</span>
          <span className="hidden text-[13px] group-open:inline">Hide</span>
        </summary>
        <dl className="grid pb-4 md:grid-cols-2 md:gap-x-10">
          <KeyValue k="Account">
            <Acct id={a.account_id} />
          </KeyValue>
          <KeyValue k="Counterparty check">
            <span className="[overflow-wrap:anywhere]">
              {a.verdict.level}: {a.verdict.reasons.join("; ")}
            </span>
          </KeyValue>
          <KeyValue k="Findings: done, invalid, failed">{`${a.completed}, ${a.invalid}, ${a.failed}`}</KeyValue>
          <KeyValue k="Balance">
            <Usdc v={a.balance.usdc} /> tUSDC, <Near v={a.balance.compute} /> NEAR of compute
          </KeyValue>
          {a.strikes.length > 0 && (
            <KeyValue k="Strike evidence">
              {a.strikes.map((x) => (
                <span key={x.finding_id} className="mr-3 font-mono text-[13px]">
                  finding #{x.finding_id} ({x.evidence_hash.slice(0, 12)}…)
                </span>
              ))}
            </KeyValue>
          )}
        </dl>
      </details>
      <section aria-labelledby="history-title" className="mt-12">
        <h2 id="history-title" className="border-b border-rule-strong pb-3 text-[17px] font-medium tracking-[-0.015em] text-fg">
          History
        </h2>
        <ol>
          {history.slice(pg.start, pg.end).map((e) => (
            <EventLine key={e.id} e={e} env={m.env} />
          ))}
          {history.length === 0 && (
            <li className="border-b border-rule">
              <EmptyNote href={null}>Nothing yet. Once it bids, attacks or posts a job, it shows up here.</EmptyNote>
            </li>
          )}
        </ol>
        <Pager page={pg.page} pages={pg.pages} go={pg.go} total={history.length} noun="events" />
      </section>
    </div>
  );
}

