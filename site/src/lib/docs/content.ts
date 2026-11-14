// The docs' content: markdown files with a small frontmatter (title, description, section, order), written by the
// team in the repo's docs/site/NN-slug.md and read here at build. Until those exist, the placeholders in
// site/src/content/docs stand in, so the framework can be seen and checked.

import fs from "node:fs";
import path from "node:path";
import { SITE_URL } from "@/content/facts";

export const SECTIONS = ["Get started", "Concepts", "Reference", "Operate", "Background"] as const;
export type Section = (typeof SECTIONS)[number];

export interface Doc {
  slug: string;
  file: string;
  title: string;
  description: string;
  section: Section;
  order: number;
  /** the markdown without its frontmatter */
  body: string;
  /** the file as written (what "Copy page" and /docs/raw serve) */
  raw: string;
  placeholder: boolean;
}

const TEAM_DIR = path.join(process.cwd(), "..", "docs", "site");
const PLACEHOLDER_DIR = path.join(process.cwd(), "src", "content", "docs");

/** `key: value` lines between two `---` fences; values may be quoted */
export function frontmatter(raw: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) data[kv[1]!] = kv[2]!.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return { data, body: raw.slice(m[0].length) };
}

function read(dir: string, placeholder: boolean): Doc[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      // (rt-agents write the site's address as `<host>`: it becomes this site's own)
      const raw = fs.readFileSync(path.join(dir, file), "utf8").replaceAll("<host>", SITE_URL);
      const { data, body } = frontmatter(raw);
      const prefix = /^(\d+)-/.exec(file)?.[1];
      const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
      const section = (SECTIONS as readonly string[]).includes(data.section ?? "") ? (data.section as Section) : "Background";
      return {
        slug,
        file,
        title: data.title ?? slug.replace(/-/g, " "),
        description: data.description ?? "",
        section,
        order: Number(data.order ?? prefix ?? 999),
        body,
        raw,
        placeholder,
      };
    });
}

let cache: Doc[] | null = null;

/** every page, in reading order: by section, then order */
export function allDocs(): Doc[] {
  // (read once per build; in development every time, so new or edited pages show without a restart)
  if (cache && process.env.NODE_ENV === "production") return cache;
  const team = read(TEAM_DIR, false);
  const docs = team.length ? team : read(PLACEHOLDER_DIR, true);
  cache = docs.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order || a.slug.localeCompare(b.slug));
  return cache;
}

export const docBySlug = (slug: string) => allDocs().find((d) => d.slug === slug) ?? null;
export const docByFile = (file: string) => allDocs().find((d) => d.file === file) ?? null;

export function bySection(): { section: Section; docs: Doc[] }[] {
  return SECTIONS.map((section) => ({ section, docs: allDocs().filter((d) => d.section === section) })).filter((g) => g.docs.length);
}

export function neighbours(slug: string): { prev: Doc | null; next: Doc | null } {
  const list = allDocs();
  const i = list.findIndex((d) => d.slug === slug);
  return { prev: i > 0 ? list[i - 1]! : null, next: i >= 0 && i < list.length - 1 ? list[i + 1]! : null };
}
