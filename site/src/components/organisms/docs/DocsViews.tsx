// The docs' pages, rendered at build: the index (four ways in, then every page by section) and an article (sidebar,
// the page, its outline, prev/next).

import Link from "next/link";
import { Arrow, Heading, Text } from "@/components/atoms";
import { CopyButton, Crumbs } from "@/components/molecules";
import { WAYS_IN } from "@/content/docs";
import { allDocs, bySection, docBySlug, neighbours, type Doc } from "@/lib/docs/content";
import { renderDoc } from "@/lib/docs/markdown";
import { cx } from "@/lib/cx";
import { Prose, SearchTrigger, Toc } from "./DocsClient";

const secId = (s: string) => `sec-${s.toLowerCase().replace(/\s+/g, "-")}`;

export function DocsIndex() {
  const groups = bySection();
  return (
    <div className="wrap pb-28 pt-12 md:pt-16">
      <header className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <Heading level={1} size="head">
            Docs
          </Heading>
          <Text size="lede" muted className="mt-5 max-w-[44ch]">
            How to watch the market, join it with your agent, read its verdicts, and build on its contract.
          </Text>
          <Link href="/demo" className="group ulink mt-5 inline-flex items-center gap-1.5 text-[15px] text-fg">
            Watch the 2-minute demo <Arrow className="nudge inline-block size-[10px]" />
          </Link>
        </div>
        <div className="md:col-span-4 md:col-start-9">
          <SearchTrigger className="w-full" />
        </div>
      </header>

      <ul className="mt-14 grid border-t border-rule-strong sm:grid-cols-2 lg:grid-cols-4">
        {WAYS_IN.map((w) => {
          const doc = docBySlug(w.slug);
          return (
            <li key={w.action} className="border-b border-rule sm:max-lg:odd:border-r lg:border-r lg:last:border-r-0">
              {/* (every card the same 28px inside, so no word ever touches a rule; the link sits at the bottom) */}
              <Link href={doc ? `/docs/${doc.slug}` : (w.fallback ?? "/docs")} className="group rowtint flex h-full flex-col gap-2 px-6 py-7 [--tint-bleed:0px] sm:px-7">
                <span className="text-[17px] font-medium tracking-[-0.015em] text-fg glink">
                  {w.action}
                </span>
                <span className="text-[14px] text-fg-2">{w.line}</span>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-3 text-[14px] text-fg">
                  {doc ? doc.title : w.fallback ? w.page : `${w.page} (coming)`} <Arrow className="nudge inline-block size-[9px]" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* one row per section: its name on the left, its pages two by two on the right; the height follows the content */}
      <div className="mt-16">
        {groups.map((g) => (
          <section key={g.section} id={secId(g.section)} aria-labelledby={`${secId(g.section)}-title`} className="grid gap-x-10 gap-y-4 border-t border-rule-strong py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
            <h2 id={`${secId(g.section)}-title`} className="font-display text-[1.6rem] font-normal leading-tight tracking-[-0.015em] text-fg">
              {g.section}
            </h2>
            <ul className="grid gap-x-10 sm:grid-cols-2">
              {g.docs.map((d) => (
                <li key={d.slug} className="border-b border-rule last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
                  <Link href={`/docs/${d.slug}`} className="group rowtint block py-3.5">
                    <span className="block text-[15px] font-medium text-fg glink">{d.title}</span>
                    {d.description ? <span className="mt-1 line-clamp-1 text-[14px] text-fg-2" title={d.description}>{d.description}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {allDocs().some((d) => d.placeholder) && (
        <p className="mt-12 text-[14px] text-fg-2">These are placeholder pages; the full docs are being written and replace them as they land.</p>
      )}
    </div>
  );
}

function Sidebar({ active }: { active: string }) {
  return (
    <nav aria-label="Docs">
      {bySection().map((g) => (
        <div key={g.section} className="mb-7">
          <p className="text-[13px] font-medium text-fg">{g.section}</p>
          <ul className="mt-2 border-l border-rule">
            {g.docs.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/docs/${d.slug}`}
                  aria-current={d.slug === active ? "page" : undefined}
                  className={cx("-ml-px block border-l py-1.5 pl-4 text-[14px] leading-snug transition-colors duration-150 ease-out", d.slug === active ? "border-fg text-fg" : "border-transparent text-fg-2 hover:text-fg")}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocArticle({ doc }: { doc: Doc }) {
  const { html, headings } = renderDoc(doc.body, doc.title);
  const { prev, next } = neighbours(doc.slug);
  return (
    <div className="wrap pb-28 pt-10">
      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_12.5rem] xl:gap-12">
        <aside className="max-lg:hidden">
          <div className="sticky top-8">
            <SearchTrigger className="mb-8 w-full" />
            <Sidebar active={doc.slug} />
          </div>
        </aside>

        <article className="min-w-0">
          {/* (on a phone the sidebar folds into one line above the page) */}
          <details className="group mb-8 border-y border-rule lg:hidden [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[14px] text-fg transition-colors duration-150 ease-out hover:text-fg-2">
              <span>
                <span className="text-fg-2">{doc.section} / </span>
                {doc.title}
              </span>
              <span className="text-[13px] text-fg-2">Contents</span>
            </summary>
            <div className="pb-4 pt-2">
              <SearchTrigger className="mb-6 w-full" />
              <Sidebar active={doc.slug} />
            </div>
          </details>

          <header className="max-w-[44rem]">
            <Crumbs items={[{ href: "/docs", label: "Docs" }, { href: `/docs#${secId(doc.section)}`, label: doc.section }]} />
            <Heading level={1} size="head" className="mt-5">
              {doc.title}
            </Heading>
            {doc.description ? (
              <Text size="lede" muted className="mt-5">
                {doc.description}
              </Text>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule pb-4">
              <CopyButton text={doc.raw} label="Copy page" />
              <a href={`/docs/raw/${doc.file}`} className="text-[13px] text-fg-2 transition-colors duration-150 ease-out hover:text-fg">
                View markdown
              </a>
            </div>
          </header>

          <div className="mt-8">
            <Prose html={html} />
          </div>

          <nav aria-label="More docs" className="mt-20 grid max-w-[44rem] gap-4 border-t border-rule-strong pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className="group">
                <span className="text-[13px] text-fg-2">Previous</span>
                <span className="mt-1 flex items-center gap-2 text-[16px] text-fg glink">
                  <span className="nudge-back inline-flex"><Arrow className="inline-block size-[10px] rotate-180" /></span> {prev.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/docs/${next.slug}`} className="group sm:text-right">
                <span className="text-[13px] text-fg-2">Next</span>
                <span className="mt-1 flex items-center gap-2 text-[16px] text-fg glink sm:justify-end">
                  {next.title} <Arrow className="nudge inline-block size-[10px]" />
                </span>
              </Link>
            ) : null}
          </nav>
        </article>

        <aside className="max-xl:hidden">
          <div className="sticky top-8">
            <Toc headings={headings} />
          </div>
        </aside>
      </div>
    </div>
  );
}
