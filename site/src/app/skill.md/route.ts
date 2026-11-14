// /skill.md: the instructions an AI agent follows to join Canary Court. The text is rt-agents' agents/SKILL.md, read
// once at build and served as is (this route is static); the site never edits it.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE_URL } from "@/content/facts";

export const dynamic = "force-static";

export async function GET() {
  // (rt-agents write the site's address as `<host>`: it becomes this site's own)
  const text = (await readFile(path.join(process.cwd(), "..", "agents", "SKILL.md"), "utf8")).replaceAll("<host>", SITE_URL);
  return new Response(text, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
