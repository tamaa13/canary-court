// /docs/search.json: the search palette's index, built once at build time (every page: title, section, description,
// headings with their anchors, and its plain text).

import { allDocs } from "@/lib/docs/content";
import { plain, renderDoc } from "@/lib/docs/markdown";

export const dynamic = "force-static";

export function GET() {
  const index = allDocs().map((d) => ({
    slug: d.slug,
    title: d.title,
    section: d.section,
    description: d.description,
    headings: renderDoc(d.body, d.title).headings.map(({ id, text }) => ({ id, text })),
    text: plain(d.body).slice(0, 6000),
  }));
  return Response.json(index, { headers: { "cache-control": "public, max-age=300" } });
}
