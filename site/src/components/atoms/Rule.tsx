import { cx } from "@/lib/cx";

/** A hairline. `strong` for the rule that opens a section. */
export function Rule({ strong = false, className }: { strong?: boolean; className?: string }) {
  return <hr className={cx("h-px w-full", strong ? "bg-rule-strong" : "bg-rule", className)} />;
}
