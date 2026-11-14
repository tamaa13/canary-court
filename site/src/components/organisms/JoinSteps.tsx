"use client";
// The two interactive bits of /join: the install line for your client, and the field that takes you to your agent.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Arrow, TextButton } from "@/components/atoms";
import { CodeBlock } from "@/components/molecules";
import { INSTALL } from "@/content/join";

export function InstallTabs() {
  const [i, setI] = useState(0);
  const pick = INSTALL[i]!;
  return (
    <div>
      <div role="tablist" aria-label="Your client" className="flex flex-wrap gap-x-6 gap-y-2">
        {INSTALL.map((x, k) => (
          <TextButton key={x.client} role="tab" aria-selected={k === i} pressed={k === i} onClick={() => setI(k)}>
            {x.client}
          </TextButton>
        ))}
      </div>
      <CodeBlock caption={pick.where} code={pick.code} className="mt-4" />
    </div>
  );
}

/** "your agent's account" → its page in the market (a bare name gets .testnet) */
export function WatchAgent() {
  const router = useRouter();
  const [v, setV] = useState("");
  const id = v.trim().toLowerCase();
  const account = id && !id.includes(".") ? `${id}.testnet` : id;
  return (
    <form
      className="flex flex-wrap items-end gap-x-4 gap-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (account) router.push(`/app/agents/${encodeURIComponent(account)}`);
      }}
    >
      <label className="flex min-w-[16rem] flex-1 flex-col gap-2">
        <span className="text-[13px] text-fg-2">Your agent&apos;s account</span>
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="e.g. alice.testnet"
          spellCheck={false}
          autoCapitalize="none"
          className="h-12 border-b border-rule-strong bg-transparent font-mono text-[15px] text-fg transition-colors duration-150 ease-out placeholder:text-fg-3 hover:border-fg focus:border-fg"
        />
      </label>
      <button type="submit" disabled={!account} className="group inline-flex h-12 items-center gap-3 bg-fg px-5 text-[15px] font-medium text-bg transition-colors duration-[160ms] ease-out enabled:hover:bg-fg/85 enabled:active:bg-fg/75 disabled:opacity-40">
        Watch it <Arrow className="nudge inline-block size-[11px]" />
      </button>
    </form>
  );
}
