"use client";
// The hero's stat strip: the escrow contract's totals, read-only from testnet (get_counts at the final block).
// It renders with the server's read (or the snapshot in facts.ts), then refreshes every 30 s in the browser. The cells
// keep their size whatever the numbers do, so a refresh never moves the page.

import { useEffect, useState } from "react";
import { TextLink } from "@/components/atoms";
import { Figure } from "@/components/molecules";
import { links, network, offline } from "@/content/facts";
import { int } from "@/lib/format";
import { Limiter, Rpc, TESTNET_RPCS, readCounts, type Counts } from "@/lib/near";

export type StripData = Counts & { block: number; live: boolean };

const rpc = typeof window === "undefined" ? null : new Rpc(TESTNET_RPCS, 8000, new Limiter(2));

export function LiveStrip({ initial }: { initial: StripData }) {
  const [d, setD] = useState(initial);
  useEffect(() => {
    // (a video capture, ?capture=1, keeps the server's numbers still: no polling)
    if (!rpc || offline || new URLSearchParams(window.location.search).get("capture") === "1") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const c = await readCounts(rpc);
        if (!stop) setD({ ...c, live: true });
      } catch {
        /* keep the last read; the label says which it is */
      }
      if (!stop) timer = setTimeout(poll, 30_000);
    };
    timer = setTimeout(poll, document.visibilityState === "visible" ? 4000 : 30_000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div>
      {/* (one quiet line: live or a snapshot, of which contract, at which block) */}
      <p className="border-t border-rule-strong pt-3 text-[13px] text-fg-2">
        {d.live ? "Live from " : "A snapshot of "}
        <TextLink href={links.contract}>{network.contract}</TextLink>
        <span className="tabular narrow:hidden">, block {int(d.block)}</span>
      </p>
      {/* (a compact row of four on a phone, two by two beside the film on a wide screen) */}
      <dl className="mt-3 grid grid-cols-4 gap-x-4 gap-y-4 wide:mt-5 wide:grid-cols-2 wide:gap-x-8">
        <Figure term label={<Short short="Accounts" long="Accounts registered (incl. test runs)" />} value={int(d.agents)} />
        <Figure term label={<Short short="Jobs" long="Jobs posted" />} value={int(d.jobs)} />
        <Figure term label={<Short short="Attacks" long="Attacks submitted" />} value={int(d.findings)} />
        <Figure term label={<Short short="Rulings" long="Policy decisions" />} value={int(d.policy_log)} />
      </dl>
    </div>
  );
}

function Short({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className="wide:hidden">{short}</span>
      <span className="narrow:hidden">{long}</span>
    </>
  );
}
