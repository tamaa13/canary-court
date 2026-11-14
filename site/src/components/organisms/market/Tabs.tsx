"use client";
// The Proof tab: how the market defends itself, one part at a time (Security, with Verified as its last part).

import { useMarket } from "./MarketProvider";
import { Security } from "./Security";
import { Loading, TabHead } from "./TabHead";

export function ProofTab() {
  const m = useMarket();
  if (!m.snap) return <Loading />;
  return (
    <div className="wrap pb-24 pt-8">
      <TabHead title="Proof">
        How the market defends itself, for anyone who wants to check: our own attack tests, the counterparty checks, strikes, the contract&apos;s
        policy log, and the enclave (and, for live targets, the model) every verdict is pinned to. The contract enforces the rules, not an LLM; refused attempts revert,
        so they show up as receipts you can re-check on chain.
      </TabHead>
      <Security s={m.snap} env={m.env} contract={m.contract} attest={m.status.live} />
    </div>
  );
}
