import type { ReactNode } from "react";
import type { Tone } from "@/lib/market/status";
import { cx } from "@/lib/cx";

/** Status, said in a word: no dot, no colour, no symbol. In ink when it matters, muted when it's settled. */
export function StatusLabel({ tone = "fg", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("text-[14px] leading-snug", tone === "muted" ? "text-fg-2" : "text-fg", className)}>{children}</span>;
}
