import Link from "next/link";

/** where a page sits, in plain small text: "Docs / Concepts". Links, never a label. */
export function Crumbs({ items }: { items: { href: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 text-[14px] text-fg-2">
        {items.map((c, i) => (
          <li key={c.href} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden className="text-fg-3">/</span> : null}
            <Link href={c.href} className="nlink hover:text-fg">
              {c.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
