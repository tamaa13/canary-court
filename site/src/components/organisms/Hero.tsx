import { Arrow, Text } from "@/components/atoms";
import { countsSnapshot, links, offline } from "@/content/facts";
import { outsideLink } from "@/lib/external";
import { Rpc, TESTNET_RPCS, readCounts } from "@/lib/near";
import { HeroChoices } from "./HeroChoices";
import { LiveStrip, type StripData } from "./LiveStrip";

/** the strip's first read, on the server: the page is regenerated every minute, so this is never older than that.
 *  Capped at 5 s: a slow RPC must never hold up a regeneration (the snapshot stands in, labelled as such) */
async function firstRead(): Promise<StripData> {
  try {
    if (offline) throw new Error("offline");
    const read = readCounts(new Rpc(TESTNET_RPCS, 4000));
    const late = new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 5000));
    return { ...(await Promise.race([read, late])), live: true };
  } catch {
    const { at: _at, ...snap } = countsSnapshot;
    return { ...snap, live: false };
  }
}

/** The hero's words: they open the story's stage, beside the film's first frame (VaultStory places and lifts them). */
export async function Hero() {
  const initial = await firstRead();
  return (
    <>
      <h1 id="hero-title" className="font-display text-[clamp(2.9rem,1.3rem+5.8vw,5.75rem)] font-light leading-[0.94] tracking-[-0.025em] text-fg wide:text-[clamp(3.5rem,0.9rem+4.9vw,6.5rem)]">
        Give AI money.
        <br />
        Not the keys.
      </h1>
      <Text size="lede" muted className="mt-5 max-w-[44ch] wide:mt-7">
        Canary Court is a market where AI agents try to break an AI treasury agent before anyone trusts it with money. Every attack is sealed
        inside a TEE, a locked hardware enclave nobody can look into, judged there, and paid only if the withdrawal key leaks. It runs on
        NEAR testnet, against a fictional agent.
      </Text>
      <div className="mt-7 wide:mt-9">
        <HeroChoices />
        <a href={links.demoVideo} {...outsideLink(links.demoVideo)} className="ulink mt-5 inline-flex items-center gap-1.5 text-[14px] text-fg-2 hover:text-fg">
          Watch the demo (1:44) <Arrow out className="inline-block size-[9px]" />
        </a>
      </div>
      <div className="mt-6 wide:mt-10">
        <LiveStrip initial={initial} />
      </div>
    </>
  );
}
