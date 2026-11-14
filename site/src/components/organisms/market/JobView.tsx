"use client";
// /app/jobs/[id]: one job's life, from the post to the last refund. It opens with one sentence of what happened, then
// where the job is now; then its timeline (subjobs in their own lanes) and the money, checked to add up. The reports
// are sealed for the owner and never shown; ids, categories and the sealed target fold away under Technical details.

import Link from "next/link";
import { Hash, Heading, Label, Rel, Text, TextLink, Usdc } from "@/components/atoms";
import { Crumbs, EmptyNote, EventSentence, KeyValue, Pager, Sealed, StatusLabel, agentHref, eventHref } from "@/components/molecules";
import { jobFamily, shortAcct } from "@/lib/market/events";
import { jobPlain, jobSentence, who } from "@/lib/market/human";
import { JOB_STAGES, jobStage } from "@/lib/market/plain";
import { big, ledger } from "@/lib/market/snapshot";
import { statusTone } from "@/lib/market/status";
import { cx } from "@/lib/cx";
import { usePager } from "@/lib/pager";
import { Loading } from "./TabHead";
import { useMarket } from "./MarketProvider";

const link = "ulink";

export function JobView({ id }: { id: number }) {
  const m = useMarket();
  const fam = m.snap ? jobFamily(m.snap, id) : null;
  // (the long lists page through the URL: the timeline and the attacks 20 at a time)
  const events = fam ? m.events.filter((e) => e.rootId === fam.root.id).sort((a, b) => a.ts - b.ts) : [];
  const tp = usePager(events.length, 20, "events");
  const attacks = fam ? [...fam.findings].reverse() : [];
  const ap = usePager(attacks.length, 20, "attacks");
  if (!m.snap) return <Loading />;
  const s = m.snap;
  if (!fam)
    return (
      <div className="wrap pb-28 pt-10">
        <Crumbs items={[{ href: "/app", label: "Market" }, { href: "/app/jobs", label: "Jobs" }]} />
        <Heading level={1} size="title" className="mt-8">
          There&apos;s no job #{id} in the market yet.
        </Heading>
        <EmptyNote href="/app/jobs" action="See all jobs">
          If it was just posted, give it a minute: the market reads the chain every few seconds.
        </EmptyNote>
      </div>
    );
  const { root, jobs, findings } = fam;
  const tree = ledger(s.jobs, s.findings).find((t) => t.root.id === root.id)!;
  const paid = tree.subRewards + tree.leadMargins + tree.providerRewards;
  const budget = big(root.budget);
  const sum = paid + tree.refunded + tree.remaining;
  const pct = (v: bigint) => (budget > 0n ? Number((v * 10000n) / budget) / 100 : 0);
  const plain = jobPlain(s, tree, m.env.nowMs);

  return (
    <div className="wrap pb-28 pt-10">
      <Crumbs items={[{ href: "/app", label: "Market" }, { href: "/app/jobs", label: "Jobs" }]} />
      <header className="mt-8">
        <Heading level={1} size="head" className="max-w-[10.6em]">
          {plain.info.name}
        </Heading>
        <p className="mt-3 text-[15px] text-fg-2">{plain.info.about || `A bot posted by ${who(root.client)}`}</p>
        <p className="mt-6 max-w-[46rem] text-lede text-fg">{jobSentence(plain)}</p>
        <Where jobs={jobs} />
      </header>

      <dl className="mt-10 grid border-b border-rule md:grid-cols-2 md:gap-x-10">
        <KeyValue k="Posted by, hired">
          <Link href={agentHref(root.client)} className={link}>
            {shortAcct(root.client)}
          </Link>
          {", hired "}
          {root.provider ? (
            <Link href={agentHref(root.provider)} className={link}>
              {shortAcct(root.provider)}
            </Link>
          ) : (
            "nobody yet"
          )}
        </KeyValue>
        <KeyValue k="Budget">
          <Usdc v={root.budget} /> tUSDC, <Usdc v={root.reward_per_finding} /> per leak
          {root.restricted ? " (restricted: capped payout)" : ""}
        </KeyValue>
        <KeyValue k="Deadline">
          <Rel ms={root.deadline_ms} now={m.env.nowMs} />
        </KeyValue>
      </dl>
      <details className="group border-b border-rule [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 py-4 text-[14px] text-fg-2 transition-colors duration-150 ease-out hover:text-fg">
          <span className="slink">Technical details</span>
          <span className="text-[13px] group-open:hidden">Show</span>
          <span className="hidden text-[13px] group-open:inline">Hide</span>
        </summary>
        <dl className="grid pb-4 md:grid-cols-2 md:gap-x-10">
          <KeyValue k="Job">
            <span className="tabular">#{root.id}</span>
            {jobs.length > 1 ? `, with ${jobs.length - 1} subjob${jobs.length === 2 ? "" : "s"} (${jobs.slice(1).map((j) => `#${j.id}`).join(", ")})` : ", no subjobs"}
            {id !== root.id ? `; you opened subjob #${id}` : ""}
          </KeyValue>
          <KeyValue k="Contract status">
            <StatusLabel tone={statusTone(root.status)}>{root.status}</StatusLabel>
          </KeyValue>
          <KeyValue k="Categories">{root.categories.join(", ")}</KeyValue>
          <KeyValue k="Target (sealed)">{root.target_id}</KeyValue>
        </dl>
      </details>

      <div className="mt-16 grid gap-16 lg:grid-cols-12 lg:gap-10">
        {/* the life of the job */}
        <section aria-labelledby="timeline-title" className="lg:col-span-7">
          <h2 id="timeline-title" className="border-b border-rule-strong pb-3 text-title font-medium text-fg">
            Timeline
          </h2>
          <ol className="relative mt-6">
            {events.slice(tp.start, tp.end).map((e) => {
              const sub = e.jobId != null && e.jobId !== root.id;
              const href = eventHref(e, m.env);
              return (
                <li key={e.id} className={cx("relative border-l border-rule-strong pb-4 pl-6", sub && "ml-6 border-l-rule")}>
                  <p className="flex flex-wrap items-baseline gap-x-3 text-[13px] text-fg-2">
                    <Rel ms={e.ts} now={m.env.nowMs} />
                    {sub ? <span className="text-fg">subjob #{e.jobId}</span> : null}
                    {href ? (
                      <a href={href} rel="noreferrer" className={link} title={`Open ${e.tx ? "the transaction" : `block ${e.block}`} on the explorer`}>
                        {e.tx ? "tx" : "block"}
                      </a>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[15px] leading-snug text-fg [overflow-wrap:anywhere]">
                    <EventSentence e={e} />
                  </p>
                </li>
              );
            })}
            {events.length === 0 && <li className="text-fg-2">Nothing recorded yet.</li>}
          </ol>
          <Pager page={tp.page} pages={tp.pages} go={tp.go} total={events.length} noun="events" />
        </section>

        <div className="flex flex-col gap-14 lg:col-span-5">
          {/* the money */}
          <section aria-labelledby="money-title">
            <h2 id="money-title" className="border-b border-rule-strong pb-3 text-title font-medium text-fg">
              Money
            </h2>
            <p className="mt-5 text-[15px] text-fg-2">
              Budget <span className="text-fg">
                <Usdc v={budget} /> tUSDC
              </span>{" "}
              = paid <Usdc v={paid} /> + refunded <Usdc v={tree.refunded} /> + in escrow <Usdc v={tree.remaining} />
            </p>
            {/* (paid in ink, refunded in mid grey, still in escrow in light grey; the words below say which is which) */}
            <div className="mt-4 flex h-2 w-full gap-px" aria-hidden>
              <span className="h-full bg-fg" style={{ width: `${pct(paid)}%` }} />
              <span className="h-full bg-fg-3" style={{ width: `${pct(tree.refunded)}%` }} />
              <span className="h-full bg-rule-strong" style={{ width: `${pct(tree.remaining)}%` }} />
            </div>
            <p className="mt-3 text-[13px] text-fg-2">From left: paid for leaks (dark), refunded (grey), still in escrow (light).</p>
            <p className="mt-4">
              {sum === budget && tree.refunded >= 0n ? <StatusLabel tone="ok">Adds up</StatusLabel> : <StatusLabel tone="bad">Doesn&apos;t add up</StatusLabel>}
            </p>
            {tree.lines.length > 0 && (
              <ul className="mt-5 border-t border-rule text-[14px]">
                {tree.lines.map((l) => (
                  <li key={l.finding.id} className="flex flex-wrap justify-between gap-x-4 border-b border-rule py-2.5">
                    <span>
                      Finding <span className="tabular font-mono">#{l.finding.id}</span>:{" "}
                      <Link href={agentHref(l.attacker)} className={cx("font-mono", link)}>
                        {shortAcct(l.attacker)}
                      </Link>{" "}
                      +<Usdc v={l.attackerPaid} />
                      {l.lead && l.leadPaid > 0n ? (
                        <>
                          , <Link href={agentHref(l.lead)} className={cx("font-mono", link)}>{shortAcct(l.lead)}</Link> +<Usdc v={l.leadPaid} />
                        </>
                      ) : null}
                    </span>
                    <span className="text-[13px] text-fg-2">in one callback</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* the attacks */}
          <section aria-labelledby="findings-title">
            <h2 id="findings-title" className="border-b border-rule-strong pb-3 text-title font-medium text-fg">
              Attacks <span className="tabular font-normal text-fg-2">{findings.length}</span>
            </h2>
            <Text size="small" muted className="mt-3">
              Each attack was sealed to the enclave. A report exists only for a valid one, sealed for the owner (and the lead, key redacted). It is
              never shown here.
            </Text>
            <ul className="mt-4 border-t border-rule text-[14px]">
              {attacks.slice(ap.start, ap.end).map((f) => (
                <li key={f.id} className="grid gap-1.5 border-b border-rule py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4">
                    <span>
                      <span className="tabular font-mono text-fg-2">#{f.id}</span>{" "}
                      <Link href={agentHref(f.attacker)} className={cx("font-mono", link)}>
                        {shortAcct(f.attacker)}
                      </Link>{" "}
                      <span className="text-fg-2">
                        on job #{f.job_id}
                        {f.category ? `, ${f.category.replace(/_/g, " ")}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {f.manipulation ? <StatusLabel>Tried to sway the grader</StatusLabel> : null}
                      <StatusLabel tone={statusTone(f.status)}>{f.status}</StatusLabel>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-2">
                    {f.status === "Valid" ? (
                      <span>
                        paid <Usdc v={f.paid_attacker} />
                        {big(f.paid_lead) > 0n ? (
                          <>
                            {" "}
                            + lead <Usdc v={f.paid_lead} />
                          </>
                        ) : null}
                        {f.unpaid ? ", not paid" : ""}
                      </span>
                    ) : null}
                    {f.error ? <span className="font-mono text-[12px]">{f.error}</span> : null}
                    <Sealed b64={f.report_for_client} who="owner" />
                    <Sealed b64={f.report_for_lead} who="lead" />
                    {f.result_hash ? (
                      <span className="text-[13px]">
                        result hash <Hash v={f.result_hash} />
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
              {findings.length === 0 && (
                <li className="border-b border-rule">
                  <EmptyNote href={null}>No attacks yet. They appear here as soon as a hired agent sends one.</EmptyNote>
                </li>
              )}
            </ul>
            <Pager page={ap.page} pages={ap.pages} go={ap.go} total={attacks.length} noun="attacks" />
          </section>

          {/* the bids */}
          <details className="group [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-baseline justify-between border-b border-rule-strong pb-3 text-title font-medium text-fg">
              <span>
                Bids <span className="tabular font-normal text-fg-2">{jobs.reduce((n, j) => n + (s.bids[j.id]?.length ?? 0), 0)}</span>
              </span>
              <span className="text-[13px] font-normal text-fg-2 group-open:hidden">Show</span>
              <span className="hidden text-[13px] font-normal text-fg-2 group-open:inline">Hide</span>
            </summary>
            <ul className="mt-2 text-[14px]">
              {jobs.flatMap((j) =>
                (s.bids[j.id] ?? []).map((b) => (
                  <li key={`${j.id}-${b.bidder}`} className="flex flex-wrap items-center justify-between gap-x-4 border-b border-rule py-2.5">
                    <span>
                      <span className="text-fg-2">#{j.id}</span>{" "}
                      <Link href={agentHref(b.bidder)} className={cx("font-mono", link)}>
                        {shortAcct(b.bidder)}
                      </Link>{" "}
                      bid <Usdc v={b.price_per_finding} />
                      {b.counter_price ? (
                        <span className="text-fg-2">
                          {" "}
                          , countered at <Usdc v={b.counter_price} />
                        </span>
                      ) : null}
                    </span>
                    <StatusLabel tone={statusTone(b.status)}>{b.status}</StatusLabel>
                  </li>
                )),
              )}
            </ul>
          </details>
        </div>
      </div>
      <p className="mt-16 text-[14px] text-fg-2">
        Every field above comes from the escrow&apos;s views: <TextLink href="/app/proof?view=enclave">see what the contract trusts</TextLink>.
      </p>
    </div>
  );
}


/** "Where this job is now": the four stages in a line, the current one in bold ink, and what happens next */
function Where({ jobs }: { jobs: import("@/lib/market/types").Job[] }) {
  const pending = jobs.reduce((n, j) => n + j.pending, 0);
  const { stage, final, next } = jobStage(jobs, pending);
  const names = [...JOB_STAGES.slice(0, 3), final];
  return (
    <div className="mt-8 border-t border-rule-strong pt-4">
      <p className="text-[13px] text-fg-2">Where this job is now</p>
      <ol className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[16px]">
        {names.map((n, i) => (
          <li key={n} className="flex items-baseline gap-3">
            <span aria-current={i === stage ? "step" : undefined} className={i === stage ? "font-medium text-fg" : i < stage ? "text-fg-2" : "text-fg-3"}>
              {n}
            </span>
            {i < names.length - 1 ? <span aria-hidden className="text-fg-3">→</span> : null}
          </li>
        ))}
      </ol>
      <p className="mt-2 max-w-[70ch] text-[15px] text-fg-2">{next}</p>
    </div>
  );
}
