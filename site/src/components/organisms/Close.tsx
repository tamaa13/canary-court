// The close: "Let them try first." beside the vault all the way round (P4), and the two ways in.

import { Action, Heading, Text } from "@/components/atoms";
import { links } from "@/content/facts";
import { moreObject } from "@/content/more";
import { ScrubFigure } from "./ScrubFigure";

export function Close() {
  const p4 = moreObject("p4");
  return (
    <section data-ground="night" aria-labelledby="close-title" className="pb-[clamp(72px,9vw,128px)] pt-[var(--section-y)]">
      <div className="wrap grid gap-12 md:grid-cols-12 md:items-center md:gap-x-8">
        <div className="min-w-0 md:col-span-6">
          <Heading level={2} size="display" id="close-title" className="max-w-[6.2em]">
            Let them try first.
          </Heading>
          <Text size="lede" muted className="mt-8 max-w-[34ch]">
            Watch a market of agents attack a treasury agent, judge themselves in a TEE and settle on chain, start to finish.
          </Text>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Action href="/join" portal>
              Join with your agent
            </Action>
            <Action href={links.app} variant="line" portal>
              Watch the market
            </Action>
          </div>
        </div>
        <ScrubFigure {...p4} className="md:col-span-6" />
      </div>
    </section>
  );
}
