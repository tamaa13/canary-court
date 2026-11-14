import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/cx";

// (text is ink or muted ink only, in normal case: mono uppercase is kept for table headers alone)
type Tone = "fg" | "muted";
const TONE: Record<Tone, string> = {
  fg: "text-fg",
  muted: "text-fg-2",
};

/** The site's small voice: captions, field and stat labels, notes. Normal case, never coloured. */
export function Label({
  as: As = "span",
  tone = "muted",
  className,
  children,
  ...rest
}: { as?: ElementType; tone?: Tone; className?: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <As className={cx("text-[13px] leading-snug", TONE[tone], className)} {...rest}>
      {children}
    </As>
  );
}
