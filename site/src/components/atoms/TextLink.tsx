import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Arrow } from "./Arrow";
import { outsideLink } from "@/lib/external";

/** A link inside text or a list: underlined on a hairline, ↗ when it leaves the site. */
export function TextLink({ href, className, children, mono = false }: { href: string; className?: string; children: ReactNode; mono?: boolean }) {
  const ext = /^https?:\/\//.test(href);
  const cls = cx(
    "ulink inline-flex items-baseline gap-1",
    mono && "font-mono text-[0.86em]",
    className,
  );
  return ext ? (
    <a href={href} className={cls} {...outsideLink(href)}>
      {children}
      <Arrow out className="inline-block size-[0.62em] shrink-0 translate-y-[-0.05em] self-center" />
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
