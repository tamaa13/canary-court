// Where a link written in docs/site/*.md goes on the site. Another docs page (03-quickstart.md#x, ./13-reputation.md)
// becomes /docs/<slug>#x. A path in the repo, relative to docs/site (../../contracts/redteam/src/eval.rs#L10), opens on
// GitHub: /blob/main/<path> for a file, /tree/main/<path> for a folder, the #hash kept. The .md files keep their
// relative links, so they work on GitHub too. Anything else is left as written.

export const REPO = "https://github.com/tamaa13/canary-court";

const DOC = /^(?:\.\/)?(?:\d+-)?([a-z0-9-]+)\.md(#.*)?$/;

export function docHref(href: string): string {
  const page = DOC.exec(href);
  if (page) return `/docs/${page[1]}${page[2] ?? ""}`;
  if (!href.startsWith("../")) return href;
  const hashAt = href.indexOf("#");
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  // (resolved from docs/site, the folder the page lives in)
  const parts = ["docs", "site"];
  for (const seg of path.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  const repoPath = parts.join("/");
  // (back inside docs/site after all: another docs page)
  const inside = /^docs\/site\/((?:\d+-)?[a-z0-9-]+)\.md$/.exec(repoPath);
  if (inside) return docHref(`${inside[1]}.md${hash}`);
  const last = parts[parts.length - 1] ?? "";
  const kind = /\.[a-z0-9]+$/i.test(last) ? "blob" : "tree";
  return `${REPO}/${kind}/main/${repoPath}${hash}`;
}
