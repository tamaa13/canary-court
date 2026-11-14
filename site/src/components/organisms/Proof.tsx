// "Receipts, not claims.": one object (P1, the receipt spindle) and four figures that count up as they come into view,
// each with its source. The full record (every run, what went wrong) lives in the docs and the reports.

import { Arrow, CountUp, TextLink } from "@/components/atoms";
import { SectionHead } from "@/components/molecules";
import { moreObject } from "@/content/more";
import { proof } from "@/content/facts";
import Link from "next/link";
import { ScrubFigure } from "./ScrubFigure";

const FIGURES = [
  { fact: proof.e2e, label: proof.e2e.label },
  { fact: proof.attacks, label: "attack expectations held, scenarios S1–S5" },
  { fact: proof.secrets, label: "plaintext secrets in the run's 47 views and logs" },
  { fact: proof.demo, label: "paid in the treasury demo, only for proven leaks" },
];

export function Proof() {
  const p1 = moreObject("p1");
  return (
    <section id="proof" data-ground="paper" aria-labelledby="proof-title" className="section-y">
      <div className="wrap grid gap-12 md:grid-cols-12 md:items-center md:gap-x-8">
        <div className="min-w-0 md:col-span-5">
          <SectionHead
            id="proof-title"
            title="Receipts, not claims."
            lede="The final release run, on testnet, re-checkable: fresh accounts, live TEE inference, and money conservation checked at 8 sampled blocks during evaluation and again at the end."
          />
          <Link href="/docs/build-and-test#re-check-our-published-results" className="group ulink mt-8 inline-flex items-center gap-1.5 text-[15px] text-fg">
            Details <Arrow className="nudge inline-block size-[10px]" />
          </Link>
        </div>
        <ScrubFigure {...p1} className="md:col-span-7" />
      </div>
      <div className="wrap">
        <dl className="mt-16 grid gap-x-8 gap-y-12 border-t border-rule-strong pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {FIGURES.map(({ fact, label }) => (
            <div key={label} className="flex flex-col">
              <dd className="tabular font-display text-[clamp(2.75rem,1.9rem+2.6vw,4.25rem)] font-light leading-none tracking-[-0.03em] text-fg">
                <CountUp value={fact.value} />
              </dd>
              <dt className="mt-4 text-[15px] text-fg">{label}</dt>
              <p className="mt-2 text-[13px] text-fg-2">
                <TextLink href={fact.source.href}>{fact.source.label}</TextLink>
              </p>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
