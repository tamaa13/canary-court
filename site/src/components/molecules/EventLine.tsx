import Link from "next/link";
import { Rel, type Env } from "@/components/atoms";
import { fmtNear, fmtUsdc } from "@/lib/market/amount";
import { shortAcct, type MarketEvent, type Part } from "@/lib/market/events";
import { EXPLORER, txUrl } from "@/lib/near";
import { cx } from "@/lib/cx";

const link = "ulink";

export const agentHref = (id: string) => `/app/agents/${encodeURIComponent(id)}`;
export const jobHref = (id: number) => `/app/jobs/${id}`;

export function Piece({ p }: { p: Part }) {
  if (typeof p === "string") return <>{p}</>;
  if ("acct" in p)
    return (
      <Link href={agentHref(p.acct)} className={cx("font-mono text-[0.92em]", link)} title={p.acct}>
        {shortAcct(p.acct)}
      </Link>
    );
  if ("job" in p)
    return (
      <Link href={jobHref(p.job)} className={cx("whitespace-nowrap", link)}>
        job <span className="tabular font-mono text-[0.92em]">#{p.job}</span>
      </Link>
    );
  if ("usdc" in p) return <span className="tabular">{fmtUsdc(p.usdc)}</span>;
  if ("near" in p) return <span className="tabular">{fmtNear(p.near)}</span>;
  // (a verdict word is the sentence's emphasis: ink, medium weight, no colour)
  return <span className="font-medium text-fg">{p.word}</span>;
}

/** One thing that happened, in a sentence: when, what, and where to check it (the tx, or the block it was logged in). */
export function EventLine({ e, env }: { e: MarketEvent; env: Env }) {
  const href = eventHref(e, env);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-rule py-3 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
      <span className="text-[13px] text-fg-2 max-sm:order-first max-sm:col-span-2 sm:pt-[2px]">
        <Rel ms={e.ts} now={env.nowMs} />
      </span>
      <p className="min-w-0 text-[15px] leading-snug text-fg">
        <span className="[overflow-wrap:anywhere]">
          <EventSentence e={e} />
        </span>
      </p>
      <span className="text-right text-[13px] text-fg-2 sm:pt-[2px]">
        {href ? (
          // (no ↗ here: one on every row of the feed is noise; the title says it opens the explorer)
          <a href={href} rel="noreferrer" className={link} title={`Open ${e.tx ? "the transaction" : `block ${e.block}`} on the explorer`}>
            {e.tx ? "tx" : "block"}
          </a>
        ) : null}
      </span>
    </li>
  );
}

/** an event's sentence, its accounts and jobs linked into the app */
export function EventSentence({ e }: { e: MarketEvent }) {
  return (
    <>
      {e.parts.map((p, i) => (
        <Piece key={i} p={p} />
      ))}
    </>
  );
}

/** where to check an event on the explorer, if anywhere: its transaction, or the block it was logged in */
export function eventHref(e: MarketEvent, env: Env) {
  return e.tx ? txUrl(e.tx) : e.block && env.live ? `${EXPLORER}/blocks/${e.block}` : null;
}
