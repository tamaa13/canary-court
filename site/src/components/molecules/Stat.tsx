import type { ReactNode } from "react";
import { Label } from "@/components/atoms";
import { cx } from "@/lib/cx";

/** A number that can be checked: the figure, what it counts, a line of context and its source. */
export function Figure({ label, value, className, term = false }: { label: ReactNode; value: ReactNode; className?: string; term?: boolean }) {
  const V = term ? "dd" : "span";
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <Label as={term ? "dt" : "span"}>{label}</Label>
      <V className="tabular text-[clamp(1.25rem,0.9rem+1.1vw,1.75rem)] font-medium leading-none tracking-[-0.03em] text-fg">{value}</V>
    </div>
  );
}
