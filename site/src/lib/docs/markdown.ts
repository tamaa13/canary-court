// Markdown → HTML for the docs, at build. Headings get ids and a quiet anchor; code blocks become a captioned figure
// with a copy button (plain mono: the site sets code in one ink, comments muted); tables scroll in their own box;
// links to other pages' .md files become /docs links, repo paths (../../contracts/…) open on GitHub; outside links say so.

import { Marked, type Tokens } from "marked";
import { docHref } from "./href";
import { outsideLinkAttrs } from "@/lib/external";

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") || "section";

/** render one page; returns the HTML and its h2/h3 outline (for "On this page") */
export function renderDoc(body: string, title: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const unique = (base: string) => {
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  };
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Heading["tokens"]) => string } }, { tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        // (the page's title is already its h1)
        if (depth === 1) return text.trim() === title.trim() ? "" : `<h2 id="${unique(slugify(text))}">${inner}</h2>`;
        const id = unique(slugify(text));
        if (depth <= 3) headings.push({ depth, text: text.replace(/[`*_]/g, ""), id });
        return `<h${depth} id="${id}"><a class="doc-anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</h${depth}>`;
      },
      code({ text, lang }: Tokens.Code) {
        const label = (lang ?? "").split(/\s/)[0] || "text";
        const lines = text
          .split("\n")
          .map((l) => `<span class="${/^\s*(#|\/\/|--)/.test(l) ? "doc-comment" : ""}">${esc(l) || " "}</span>`)
          .join("\n");
        return `<figure class="doc-code"><figcaption><span>${esc(label)}</span><button type="button" data-copy>Copy</button></figcaption><pre><code>${lines}</code></pre></figure>`;
      },
      table(this: unknown, token: Tokens.Table) {
        const self = this as { parser: { parseInline: (t: Tokens.TableCell["tokens"]) => string } };
        const cell = (c: Tokens.TableCell, tag: "th" | "td") => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ""}>${self.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${token.header.map((c) => cell(c, "th")).join("")}</tr>`;
        const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
        return `<div class="doc-table" role="region" tabindex="0"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
      },
      image({ href, title, text }: Tokens.Image) {
        // (sizes known up front where they can be, so a picture never moves the text when it loads)
        const size = /^\/how\/step\d\/(poster|f\d{3})\.webp/.test(href) ? ' width="1200" height="900"' : "";
        return `<img src="${esc(href)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ""}${size} loading="lazy" decoding="async" />`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Link["tokens"]) => string } }, { href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        // (another docs page → /docs/<slug>; a repo path like ../../contracts/… → its page on GitHub: lib/docs/href.ts)
        const to = docHref(href);
        const ext = /^https?:\/\//.test(to);
        return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ""}${ext ? `${outsideLinkAttrs(to)} class="doc-out"` : ""}>${inner}</a>`;
      },
    },
  });
  const html = md.parse(body, { async: false }) as string;
  return { html, headings };
}

/** plain text of a markdown body, for search */
export function plain(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_>|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
