import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/cx";

type Size = "lede" | "body" | "small";
const SIZE: Record<Size, string> = { lede: "text-lede", body: "text-body", small: "text-small" };

/** Running text. `muted` for the second voice under a heading. */
export function Text({
  as: As = "p",
  size = "body",
  muted = false,
  className,
  children,
}: {
  as?: ElementType;
  size?: Size;
  muted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <As className={cx(SIZE[size], muted ? "text-fg-2" : "text-fg", "max-w-[62ch]", className)}>{children}</As>;
}
