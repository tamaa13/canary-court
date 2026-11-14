import type { ReactNode } from "react";
import { Label } from "@/components/atoms";
import { cx } from "@/lib/cx";

/** A labelled value on one hairline row (an address, a hash, a version). Long values wrap, never overflow. */
export function KeyValue({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("grid gap-1 border-t border-rule py-3.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-6", className)}>
      <Label as="dt">{k}</Label>
      <dd className="min-w-0 break-all font-mono text-[13px] leading-relaxed text-fg">{children}</dd>
    </div>
  );
}
