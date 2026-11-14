"use client";
// The docs' moving parts: the article's code-copy buttons, the "On this page" outline that follows the reader, and
// the search palette (press /).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/cx";

/** the rendered markdown, with its code blocks' Copy buttons working */
export function Prose({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-copy]");
      if (!btn) return;
      const code = btn.closest("figure")?.querySelector("pre")?.textContent ?? "";
      navigator.clipboard?.writeText(code).then(() => {
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy"), 1400);
      });
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);
  return <div ref={ref} className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** "On this page": the h2/h3 outline; the section being read is set in ink with a thin rule */
export function Toc({ headings }: { headings: { depth: number; text: string; id: string }[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? "");
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [headings]);
  if (!headings.length) return null;
  return (
    <nav aria-label="On this page">
      <p className="text-[13px] font-medium text-fg">On this page</p>
      <ul className="mt-3 border-l border-rule text-[13.5px] leading-snug">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              aria-current={active === h.id ? "location" : undefined}
              className={cx("-ml-px block border-l py-1.5 transition-colors duration-150 ease-out", h.depth === 3 ? "pl-8" : "pl-4", active === h.id ? "border-fg text-fg" : "border-transparent text-fg-2 hover:text-fg")}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type Entry = { slug: string; title: string; section: string; description: string; headings: { id: string; text: string }[]; text: string };
type Hit = { href: string; title: string; sub: string; score: number };

/** opens the search palette from anywhere on the docs */
export function SearchTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("docs:search"))}
      className={cx("inline-flex h-10 items-center justify-between gap-6 border-b border-rule-strong text-[14px] text-fg-2 transition-colors duration-150 ease-out hover:border-fg hover:text-fg", className)}
    >
      Search the docs
      <kbd className="font-mono text-label text-fg-3">/</kbd>
    </button>
  );
}

/** Search: press / (or the trigger), type, ↑ ↓ Enter, Esc. The index is built at build time (/docs/search.json). */
export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<Entry[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("docs:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("docs:search", onOpen);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (!index)
      fetch("/docs/search.json")
        .then((r) => r.json())
        .then(setIndex)
        .catch(() => setIndex([]));
  }, [open, index]);

  const hits = useMemo<Hit[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!index || !words.length) return [];
    const out: Hit[] = [];
    for (const d of index) {
      const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
      if (has(d.title)) out.push({ href: `/docs/${d.slug}`, title: d.title, sub: d.section, score: 10 });
      for (const h of d.headings) if (has(h.text)) out.push({ href: `/docs/${d.slug}#${h.id}`, title: h.text, sub: d.title, score: 6 });
      if (!has(d.title) && (has(d.description) || has(d.text))) out.push({ href: `/docs/${d.slug}`, title: d.title, sub: d.description || d.section, score: has(d.description) ? 4 : 1 });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }, [q, index]);

  const close = () => {
    setOpen(false);
    setQ("");
    setActive(0);
  };
  const go = (h: Hit) => {
    close();
    router.push(h.href);
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--scrim)] px-4 pt-[12svh]" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label="Search the docs" className="w-full max-w-xl border border-rule-strong bg-bg" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(hits.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && hits[active]) go(hits[active]);
          }}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="docs-hits"
          aria-activedescendant={hits[active] ? `docs-hit-${active}` : undefined}
          placeholder="Search the docs"
          className="h-14 w-full border-b border-rule bg-transparent px-6 text-[16px] text-fg placeholder:text-fg-3"
        />
        <ul id="docs-hits" role="listbox" className="max-h-[60svh] overflow-y-auto py-1">
          {q && index && hits.length === 0 && <li className="px-6 py-4 text-[14px] text-fg-2">Nothing matches “{q}”. Try a word like verdict, join or refund.</li>}
          {!q && <li className="px-6 py-4 text-[14px] text-fg-2">Type to search every page, heading and paragraph.</li>}
          {hits.map((h, i) => (
            <li key={h.href + i} id={`docs-hit-${i}`} role="option" aria-selected={i === active}>
              <Link
                href={h.href}
                onClick={(e) => {
                  e.preventDefault();
                  go(h);
                }}
                onMouseEnter={() => setActive(i)}
                className={cx("block px-6 py-2.5 transition-colors duration-150 ease-out active:bg-press", i === active && "bg-hover")}
              >
                <span className="block text-[15px] text-fg">{h.title}</span>
                <span className="block truncate text-[13px] text-fg-2">{h.sub}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
