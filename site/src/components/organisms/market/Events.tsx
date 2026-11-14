"use client";
// /app/events: every event the chain records, newest first, 20 to a page, with filters: the full, technical feed behind
// the Market page's recent results (expiries and roll-ups, refunds, strikes, error codes included).

import { TextButton } from "@/components/atoms";
import { Crumbs, EmptyNote, EventLine, Pager } from "@/components/molecules";
import type { EventKind } from "@/lib/market/events";
import { useFilter, usePager } from "@/lib/pager";
import { useMarket } from "./MarketProvider";
import { Loading, TabHead } from "./TabHead";

const TYPES = {
  all: { label: "All", kinds: null },
  market: { label: "Market", kinds: ["joined", "posted", "bid", "accepted", "subjob", "expired", "closed"] },
  attacks: { label: "Attacks", kinds: ["sealed", "strike", "blocklist"] },
  verdicts: { label: "Verdicts", kinds: ["valid", "invalid", "failed", "timeout", "client_fault"] },
  money: { label: "Money", kinds: ["posted", "subjob", "valid", "refund", "timeout", "client_fault"] },
} satisfies Record<string, { label: string; kinds: EventKind[] | null }>;
type TypeKey = keyof typeof TYPES;
const TYPE_KEYS = Object.keys(TYPES) as TypeKey[];

export function Events() {
  const m = useMarket();
  const [type, setType] = useFilter<TypeKey>("type", TYPE_KEYS, "all");
  const kinds: readonly EventKind[] | null = TYPES[type].kinds;
  const events = m.snap ? (kinds ? m.events.filter((e) => kinds.includes(e.kind)) : m.events) : [];
  const pg = usePager(events.length, 20);
  if (!m.snap) return <Loading />;

  return (
    <div className="wrap pb-24 pt-8">
      <Crumbs items={[{ href: "/app", label: "Market" }]} />
      <div className="mt-5">
        <TabHead title="Every event">
          Everything the escrow contract recorded, newest first: bids, sealed attacks, verdicts, payouts, expiries and refunds, strikes. The Market
          page shows only the results worth reading; this is the full record.
        </TabHead>
      </div>
      <div className="mt-12">
        <section aria-labelledby="activity-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-b border-rule-strong pb-3">
            <h2 id="activity-title" className="text-[17px] font-medium tracking-[-0.015em] text-fg">
              Events
            </h2>
            <div role="group" aria-label="Show" className="flex flex-wrap gap-x-5 gap-y-2">
              {TYPE_KEYS.map((k) => (
                <TextButton key={k} pressed={type === k} onClick={() => setType(k)}>
                  {TYPES[k].label}
                </TextButton>
              ))}
            </div>
          </div>
          <ol aria-live="polite" aria-relevant="additions">
            {events.slice(pg.start, pg.end).map((e) => (
              <EventLine key={e.id} e={e} env={m.env} />
            ))}
            {events.length === 0 && (
              <li className="border-b border-rule">
                <EmptyNote>Nothing of this kind has happened yet. When an owner&apos;s agent posts a job, the market starts here.</EmptyNote>
              </li>
            )}
          </ol>
          <Pager page={pg.page} pages={pg.pages} go={pg.go} total={events.length} noun="events" />
        </section>

      </div>
    </div>
  );
}
