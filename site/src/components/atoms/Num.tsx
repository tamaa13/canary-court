import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** A number set for reading in columns: tabular figures, slashed zero. */
export function Num({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx("tabular", className)}>{children}</span>;
}
