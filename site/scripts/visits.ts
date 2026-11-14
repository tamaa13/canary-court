// pnpm visits [--days 7] [--json]: what GoatCounter (canarycourt.goatcounter.com) has counted for the site: totals and
// the count per page. Needs an API token in GOATCOUNTER_TOKEN
// (GoatCounter → your user name → API); it's never printed. Plain fetch, which talks HTTP/1.1 (curl can trip over
// HTTP/2 there).

export {};

const BASE = "https://canarycourt.goatcounter.com";
const args = process.argv.slice(2);
const days = Math.max(1, Math.min(365, Number(args[args.indexOf("--days") + 1]) || 7));
const json = args.includes("--json");

const token = process.env.GOATCOUNTER_TOKEN;
if (!token) {
  console.log("Set GOATCOUNTER_TOKEN to a GoatCounter API token first, e.g. GOATCOUNTER_TOKEN=$(security find-generic-password -s <item> -w) pnpm visits");
  process.exit(1);
}

type Hit = { count: number; event: boolean; path: string; title?: string; path_id: number };

async function get<T>(path: string, q: Record<string, string>): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams(q)}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  if (!r.ok) throw new Error(`GoatCounter ${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const end = new Date();
const start = new Date(end.getTime() - days * 86_400_000);
const range = { start: start.toISOString(), end: end.toISOString() };

const total = await get<{ total: number; total_events: number; total_utc: number }>("/api/v0/stats/total", range);
// (100 paths a page; the next page excludes the paths already listed)
const hits: Hit[] = [];
for (let more = true; more && hits.length < 1000; ) {
  const q: Record<string, string> = { ...range, limit: "100" };
  if (hits.length) q.exclude_paths = hits.map((h) => h.path_id).join(",");
  const page = await get<{ hits: Hit[]; more: boolean }>("/api/v0/stats/hits", q);
  hits.push(...page.hits);
  more = page.more && page.hits.length > 0;
}

const pages = hits.filter((h) => !h.event).sort((a, b) => b.count - a.count);

const summary = {
  range: { from: range.start, to: range.end, days },
  totals: { visits: total.total, events: total.total_events },
  pages: pages.map((h) => ({ path: h.path, count: h.count })),
};

if (json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`Canary Court on GoatCounter, the last ${days} day${days === 1 ? "" : "s"} (${range.start.slice(0, 10)} → ${range.end.slice(0, 10)})\n`);
  console.log(`Visits ${total.total} · events ${total.total_events}  (GoatCounter counts a visitor once per page per session)\n`);
  console.log("Pages");
  for (const p of pages.slice(0, 25)) console.log(`  ${String(p.count).padStart(6)}  ${p.path}`);
  if (!pages.length) console.log("  (none yet)");
}
