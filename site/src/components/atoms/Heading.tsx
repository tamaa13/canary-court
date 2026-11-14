import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type Level = 1 | 2 | 3 | 4;
type Size = "display" | "head" | "title" | "lede";
const SIZE: Record<Size, string> = {
  // (the two big sizes are set in Erode, light; the smaller ones stay in the text face)
  display: "font-display text-display font-light",
  head: "font-display text-head font-normal",
  title: "text-title font-medium",
  lede: "text-lede font-medium",
};

/** A heading: its level is the document outline, its size is the look; the two are chosen separately. */
export function Heading({
  level,
  size,
  id,
  className,
  children,
}: {
  level: Level;
  size: Size;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className={cx(SIZE[size], "text-fg", className)}>
      {children}
    </Tag>
  );
}
