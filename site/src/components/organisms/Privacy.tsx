// "Public where it proves something. Sealed everywhere else.": one object (P3) and three lines. Who sees what, in full,
// is in the docs.

import { Arrow } from "@/components/atoms";
import { SectionHead } from "@/components/molecules";
import { moreObject } from "@/content/more";
import Link from "next/link";
import { ScrubFigure } from "./ScrubFigure";

const LINES = [
  { k: "Public", v: "Verdicts, payments and hashes: anyone can audit the market." },
  { k: "Sealed", v: "The bots, the attacks and the reports: in plaintext only inside a TEE or with their owner." },
  { k: "Attested, not proven", v: "The enclave's verdicts carry its attestation; that's trust in the hardware, not a mathematical proof." },
];

export function Privacy() {
  const p3 = moreObject("p3");
  return (
    <section id="privacy" data-ground="paper" aria-labelledby="privacy-title" className="section-y">
      <div className="wrap grid gap-12 md:grid-cols-12 md:items-center md:gap-x-8">
        <div className="min-w-0 md:col-span-6">
          <SectionHead id="privacy-title" title="Public where it proves something. Sealed everywhere else." />
          <dl className="mt-10 border-t border-rule">
            {LINES.map((l) => (
              <div key={l.k} className="grid gap-x-6 gap-y-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
                <dt className="text-[15px] font-medium text-fg">{l.k}</dt>
                <dd className="text-[15px] leading-snug text-fg-2">{l.v}</dd>
              </div>
            ))}
          </dl>
          <Link href="/docs/privacy" className="group ulink mt-8 inline-flex items-center gap-1.5 text-[15px] text-fg">
            Who sees what <Arrow className="nudge inline-block size-[10px]" />
          </Link>
        </div>
        <ScrubFigure {...p3} className="md:col-span-6" />
      </div>
    </section>
  );
}
