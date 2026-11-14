import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Inline code / identifiers (method names, account ids, hashes). */
export function Code({ className, children }: { className?: string; children: ReactNode }) {
  return <code className={cx("font-mono text-[0.86em] tracking-[-0.01em] text-fg break-words", className)}>{children}</code>;
}
