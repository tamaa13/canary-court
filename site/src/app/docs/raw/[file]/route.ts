// /docs/raw/<file>.md: a page exactly as written (what "Copy page" copies), for people and agents alike.

import { allDocs, docByFile } from "@/lib/docs/content";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().map((d) => ({ file: d.file }));
}

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const doc = docByFile((await params).file);
  if (!doc) return new Response("not found", { status: 404 });
  return new Response(doc.raw, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
}
