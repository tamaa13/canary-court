// Links that leave the site. GitHub and the demo video (YouTube) open in a new tab, so the visitor keeps the app open
// beside them; every other outside link opens in place, as before. One place for the rule: the link atoms (TextLink, Action), the header and
// the docs renderer all ask here.

export const isGitHub = (href: string) => /^https?:\/\/(www\.)?github\.com(\/|$)/i.test(href);
const isYouTube = (href: string) => /^https?:\/\/(youtu\.be|(www\.)?youtube\.com)(\/|$)/i.test(href);

/** the attributes for an outside link, as props */
export function outsideLink(href: string): { target?: "_blank"; rel: string } {
  return isGitHub(href) || isYouTube(href) ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noreferrer" };
}

/** the same, as an HTML attribute string (for the docs' rendered markdown) */
export function outsideLinkAttrs(href: string): string {
  const p = outsideLink(href);
  return `${p.target ? ` target="${p.target}"` : ""} rel="${p.rel}"`;
}
