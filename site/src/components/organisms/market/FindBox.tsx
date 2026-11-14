"use client";
// "Find an agent or job": a combobox drawn from the design system (paper panel, hairline border, the input's width).
// Empty: the open jobs (at most 5). Typing: up to 8 matches, grouped Agents / Jobs, each with one muted line. Keys:
// ↑ ↓ to move, Enter to open (an exact account or #id opens even without picking), Esc to close. e2e accounts never
// appear (the read is already filtered).

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { shortAcct, targetName } from "@/lib/market/events";
import { isTestJob } from "@/lib/market/human";
import { cx } from "@/lib/cx";
import { useMarket } from "./MarketProvider";

type Option = { key: string; group: "Agents" | "Jobs"; label: string; info: string; href: string };

const ROLE: Record<string, string> = { client: "Owner", provider: "Attacker", evaluator: "Evaluator" };

export function FindBox() {
  const m = useMarket();
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo<Option[]>(() => {
    const s = m.snap;
    if (!s) return [];
    const agent = (a: (typeof s.agents)[number]): Option => ({
      key: `a:${a.account_id}`,
      group: "Agents",
      label: shortAcct(a.account_id),
      info: `${ROLE[a.role] ?? a.role}, ${a.blocked ? "blocked" : a.verdict.level}`,
      href: `/app/agents/${encodeURIComponent(a.account_id)}`,
    });
    const roots = s.jobs.filter((j) => j.depth === 0).sort((a, b) => b.id - a.id);
    const job = (j: (typeof roots)[number]): Option => ({
      key: `j:${j.id}`,
      group: "Jobs",
      label: `#${j.id}`,
      info: `${targetName(j.target_id, j.client)}, ${j.status.toLowerCase()}`,
      href: `/app/jobs/${j.id}`,
    });
    const t = q.trim().toLowerCase().replace(/^#/, "");
    if (!t) return roots.filter((j) => (j.status === "Open" || j.status === "Assigned") && j.deadline_ms > m.env.nowMs && !isTestJob(j)).slice(0, 5).map(job);
    const agents = s.agents.filter((a) => a.account_id.toLowerCase().includes(t)).slice(0, 5).map(agent);
    const jobs = roots.filter((j) => String(j.id).startsWith(t) || targetName(j.target_id, j.client).toLowerCase().includes(t)).slice(0, 8 - agents.length).map(job);
    return [...agents, ...jobs];
  }, [m.snap, m.env.nowMs, q]);

  /** Enter with nothing picked: an exact #id or account goes straight there */
  const direct = () => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    const n = /^#?(\d+)$/.exec(t)?.[1];
    if (n) return `/app/jobs/${n}`;
    const known = m.snap?.agents.find((a) => a.account_id === t || shortAcct(a.account_id) === t);
    if (known) return `/app/agents/${encodeURIComponent(known.account_id)}`;
    if (/^[a-z0-9._-]+\.(testnet|near)$/.test(t)) return `/app/agents/${encodeURIComponent(t)}`;
    return null;
  };

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    router.push(href);
  };

  const listId = `${id}-list`;
  const showList = open && (options.length > 0 || q.trim() !== "");
  let lastGroup = "";

  return (
    <div className="relative w-full pb-3 sm:w-72 sm:pb-0">
      <label htmlFor={`${id}-input`} className="sr-only">
        Find an agent or job
      </label>
      <input
        ref={input}
        id={`${id}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${id}-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const exact = direct();
            const pick = options[active];
            if (exact && (!pick || !q.trim() || pick.label.toLowerCase() !== q.trim().toLowerCase())) go(exact);
            else if (pick) go(pick.href);
          }
        }}
        placeholder="Find an agent or #job"
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        className="h-9 w-full border-b border-rule-strong bg-transparent font-mono text-[13px] text-fg transition-colors duration-150 ease-out placeholder:text-fg-3 hover:border-fg focus:border-fg"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matches"
          // (a click on an option must not blur the input first)
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-[calc(100%-0.5rem)] z-20 max-h-[70svh] overflow-y-auto border border-rule-strong bg-bg py-1 sm:top-full"
        >
          {options.length === 0 && <li className="px-6 py-3 text-[14px] text-fg-2">No match. Try an account like alice.testnet or #80.</li>}
          {options.map((o, i) => {
            const head = o.group !== lastGroup ? (lastGroup = o.group) : null;
            return (
              <li key={o.key} role="presentation">
                {head ? <p className="px-6 pb-1 pt-3 text-[12.5px] text-fg-3">{q.trim() ? head : "Open jobs"}</p> : null}
                <div
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(o.href)}
                  className={cx("flex cursor-pointer items-baseline justify-between gap-3 px-6 py-2 transition-colors duration-150 ease-out active:bg-press", i === active && "bg-hover")}
                >
                  <span className="truncate font-mono text-[13px] text-fg">{o.label}</span>
                  <span className="truncate text-[12.5px] text-fg-2">{o.info}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
