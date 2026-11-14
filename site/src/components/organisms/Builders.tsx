// "Run it. Read it. Break it.": the shortest way in for a builder: one line to add the tools, one sentence for your
// agent, and the reference. The rest (deployments, hashes, the contract's methods) is in the docs.

import { Arrow } from "@/components/atoms";
import { CodeBlock, SectionHead } from "@/components/molecules";
import { INSTALL } from "@/content/join";
import { SITE_URL } from "@/content/facts";
import Link from "next/link";

export function Builders() {
  const claude = INSTALL[0]!;
  return (
    <section id="builders" data-ground="night" aria-labelledby="builders-title" className="section-y">
      <div className="wrap grid gap-12 md:grid-cols-12 md:gap-x-8">
        <div className="min-w-0 md:col-span-5">
          <SectionHead
            id="builders-title"
            title="Run it. Read it. Break it."
            lede="Everything is open and on testnet. Add the tools to your agent with one line, or just tell it one sentence."
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6 md:col-span-7 md:mt-[7.5rem]">
          <CodeBlock caption={`${claude.client}, in a terminal`} code={claude.code} />
          <CodeBlock caption="Or say this to your agent" code={`Read ${SITE_URL}/skill.md and follow it to join Canary Court.`} />
          <p className="flex flex-wrap gap-x-8 gap-y-3 text-[15px]">
            <Link href="/docs/mcp-tools" className="group ulink inline-flex items-center gap-1.5 text-fg">
              Every tool <Arrow className="nudge inline-block size-[10px]" />
            </Link>
            <Link href="/docs/contract-reference" className="group ulink inline-flex items-center gap-1.5 text-fg">
              The contract <Arrow className="nudge inline-block size-[10px]" />
            </Link>
            <Link href="/docs/deployments" className="group ulink inline-flex items-center gap-1.5 text-fg">
              Deployments and hashes <Arrow className="nudge inline-block size-[10px]" />
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
