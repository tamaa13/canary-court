import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Arrow } from "./Arrow";
import { PortalLink } from "./PortalLink";

type Variant = "solid" | "line";
const VARIANT: Record<Variant, string> = {
  // a filled block of ink; on hover it lightens a step
  solid: "bg-fg text-bg hover:bg-fg/85 active:bg-fg/75 px-5",
  // words on a hairline: the rule thickens on hover
  line: "ulink text-fg",
};

const isExternal = (href: string) => /^https?:\/\//.test(href);

/** A call to action: a link that looks like a decision. External links say so (↗) and open in place. */
export function Action({
  href,
  variant = "solid",
  portal = false,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  /** leave the travel way (lib/travel.ts): through the hero's film when it's on screen, else the arrival only */
  portal?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ext = isExternal(href);
  const cls = cx(
    "group inline-flex h-12 items-center gap-3 text-[15px] font-medium tracking-[-0.01em] transition-colors duration-[160ms] ease-out",
    VARIANT[variant],
    className,
  );
  const inner = (
    <>
      <span>{children}</span>
      <Arrow out={ext} className="nudge inline-block size-[11px]" />
    </>
  );
  return ext ? (
    <a href={href} className={cls} rel="noreferrer">
      {inner}
    </a>
  ) : portal ? (
    <PortalLink href={href} className={cls}>
      {inner}
    </PortalLink>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}
