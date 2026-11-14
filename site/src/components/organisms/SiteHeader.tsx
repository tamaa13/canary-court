import Link from "next/link";
import { Arrow, Wordmark } from "@/components/atoms";
import { ThemeSwitch, TravelLink } from "@/components/molecules";
import { links } from "@/content/facts";
import { cx } from "@/lib/cx";

/** The top of every page: the mark, and the places to go (the market, the docs, joining, the code). Not sticky: the
 *  story owns the screen while it plays. */
export function SiteHeader({ current }: { current?: "app" | "join" | "docs" }) {
  const item = "nlink hover:text-fg";
  return (
    <header className="wrap flex h-[var(--header-h)] items-center justify-between gap-4 sm:gap-6">
      <Link href="/" aria-label="Canary Court, home" className="-m-2 p-2">
        <Wordmark />
      </Link>
      <nav aria-label="Main">
        <ul className="flex items-center gap-4 text-[14px] tracking-[-0.005em] sm:gap-8">
          <li>
            <TravelLink href={links.app} aria-current={current === "app" ? "page" : undefined} className={cx(item, current === "app" ? "text-fg" : "text-fg-2")}>
              Market
            </TravelLink>
          </li>
          <li>
            <Link href="/docs" aria-current={current === "docs" ? "page" : undefined} className={cx(item, current === "docs" ? "text-fg" : "text-fg-2")}>
              Docs
            </Link>
          </li>
          <li>
            <TravelLink
              href="/join"
              aria-current={current === "join" ? "page" : undefined}
              className="ulink font-medium text-fg"
            >
              Join
            </TravelLink>
          </li>
          {/* (on a phone GitHub lives in the footer: four items would push the name onto two lines) */}
          <li className="max-sm:hidden">
            <a href={links.repo} rel="noreferrer" className={cx(item, "inline-flex items-center gap-1 text-fg-2")}>
              GitHub <Arrow out className="inline-block size-[9px]" />
            </a>
          </li>
          {/* (below 375px the switch lives in the footer: the name, three links and the switch don't fit on one line) */}
          <li className="flex max-[374px]:hidden">
            <ThemeSwitch />
          </li>
        </ul>
      </nav>
    </header>
  );
}
