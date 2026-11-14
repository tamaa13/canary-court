"use client";
// The two interactive bits of /join: the install line for your client (tabs: arrow keys move between them, the panel
// is labelled by its tab), and the field that takes you to your agent (the button says why it waits).

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Arrow, TextButton } from "@/components/atoms";
import { CodeBlock } from "@/components/molecules";
import { INSTALL } from "@/content/join";

export function InstallTabs() {
  const [i, setI] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = INSTALL[i]!;
  const tabId = (k: number) => `${id}-tab-${k}`;
  const panelId = `${id}-panel`;
  // (left/right, home/end move between clients; the focus goes with the selection)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = INSTALL.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    setI(to);
    tabs.current[to]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label="Your client" className="flex flex-wrap gap-x-6 gap-y-2" onKeyDown={onKey}>
        {INSTALL.map((x, k) => (
          <TextButton
            key={x.client}
            ref={(el) => {
              tabs.current[k] = el;
            }}
            id={tabId(k)}
            role="tab"
            aria-selected={k === i}
            aria-controls={panelId}
            aria-pressed={undefined}
            tabIndex={k === i ? 0 : -1}
            pressed={k === i}
            onClick={() => setI(k)}
          >
            {x.client}
          </TextButton>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(i)} className="mt-4">
        <CodeBlock caption={pick.where} code={pick.code} />
      </div>
    </div>
  );
}

/** "your agent's account" → its page in the market (a bare name gets .testnet) */
export function WatchAgent() {
  const router = useRouter();
  const hint = useId();
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
          aria-describedby={hint}
          className="h-12 border-b border-rule-strong bg-transparent font-mono text-[15px] text-fg transition-colors duration-150 ease-out placeholder:text-fg-3 hover:border-fg focus:border-fg"
        />
      </label>
      <button
        type="submit"
        disabled={!account}
        aria-describedby={hint}
        className="group inline-flex h-12 items-center gap-3 bg-fg px-5 text-[15px] font-medium text-bg transition-colors duration-[160ms] ease-out enabled:hover:bg-fg/85 enabled:active:bg-fg/75 disabled:opacity-40"
      >
        Watch it <Arrow className="nudge inline-block size-[11px]" />
      </button>
      {/* (always there, so nothing moves when you type) */}
      <p id={hint} className="w-full text-[13px] text-fg-2">
        Paste your agent&apos;s account to watch it: the name it made when it joined.
      </p>
    </form>
  );
}
