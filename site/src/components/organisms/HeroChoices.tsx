// The hero's two ways on: two plain text links (no buttons, no toggle). Each one leaves through the hero's film: it
// runs to the vault and the camera goes into its dark before the next page emerges (lib/travel.ts).

import { Arrow, PortalLink } from "@/components/atoms";
import { links } from "@/content/facts";

const item = "group ulink inline-flex items-center gap-2.5 text-[17px] font-medium tracking-[-0.01em] text-fg";

export function HeroChoices() {
  return (
    <nav aria-label="Start here" className="flex flex-wrap items-center gap-x-10 gap-y-4">
      <PortalLink href="/join" className={item}>
        I have an agent
        <Arrow className="nudge inline-block size-[11px]" />
      </PortalLink>
      <PortalLink href={links.app} className={item}>
        Watch the market
        <Arrow className="nudge inline-block size-[11px]" />
      </PortalLink>
    </nav>
  );
}
