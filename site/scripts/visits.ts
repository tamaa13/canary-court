// pnpm visits [--days 7] [--json]: what the visit counter (src/lib/visits/record.ts) has seen, read straight from the
// same Upstash Redis over its REST API. Credentials: UPSTASH_REDIS_REST_URL / _TOKEN (or the Marketplace's
// KV_REST_API_URL / _TOKEN), else the macOS Keychain items "canary-court-upstash-url" / "canary-court-upstash-token".
// Days are UTC. Nothing here is personal: counts per page, referring site, country, device, video step, and a daily
// estimate of unique visitors.

import { execFileSync } from "node:child_process";

type Counts = Record<string, number>;
interface Day {
  day: string;
  visitors: number;
  views: number;
  page: Counts;
  ref: Counts;
  country: Counts;
  device: Counts;
  video: Counts;
}

const args = process.argv.slice(2);
const days = Math.max(1, Math.min(90, Number(args[args.indexOf("--days") + 1]) || 7));
const json = args.includes("--json");
const siteHost = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://canary-court.vercel.app").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

function keychain(service: string): string | undefined {
  try {
    return execFileSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? keychain("canary-court-upstash-url");
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? keychain("canary-court-upstash-token");
if (!url || !token) {
  console.error(
    "No Redis credentials: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN),\n" +
      "or add them to the Keychain as canary-court-upstash-url / canary-court-upstash-token.",
  );
  process.exit(1);
}

async function pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  const r = await fetch(`${url!.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis said ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { result?: unknown; error?: string }[]).map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

/** HGETALL's flat [field, value, …] → { field: n } */
const toCounts = (flat: unknown): Counts => {
  const out: Counts = {};
  const a = Array.isArray(flat) ? flat : [];
  for (let i = 0; i + 1 < a.length; i += 2) out[String(a[i])] = Number(a[i + 1]);
  return out;
};
const sum = (c: Counts) => Object.values(c).reduce((x, n) => x + n, 0);
const merge = (list: Counts[]) => list.reduce<Counts>((acc, c) => {
  for (const [k, n] of Object.entries(c)) acc[k] = (acc[k] ?? 0) + n;
  return acc;
}, {});
const top = (c: Counts, n = 10) => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n);

const today = new Date();
const dayList = Array.from({ length: days }, (_, i) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)));
  return d.toISOString().slice(0, 10);
});
const NAMES = ["page", "ref", "country", "device", "video"] as const;
const res = await pipeline(dayList.flatMap((d) => [...NAMES.map((n) => ["HGETALL", `v:${d}:${n}`]), ["PFCOUNT", `v:${d}:uv`]]));
const perDay: Day[] = dayList.map((day, i) => {
  const r = res.slice(i * 6, i * 6 + 6);
  const [page, ref, country, device, video] = r.slice(0, 5).map(toCounts) as [Counts, Counts, Counts, Counts, Counts];
  return { day, visitors: Number(r[5] ?? 0), views: sum(page), page, ref, country, device, video };
});

const all = {
  page: merge(perDay.map((d) => d.page)),
  ref: merge(perDay.map((d) => d.ref)),
  country: merge(perDay.map((d) => d.country)),
  device: merge(perDay.map((d) => d.device)),
  video: merge(perDay.map((d) => d.video)),
};
const last = perDay[perDay.length - 1]!;
const before = perDay.slice(0, -1);
const avg = (f: (d: Day) => number) => (before.length ? before.reduce((x, d) => x + f(d), 0) / before.length : 0);
const summary = {
  range: { from: dayList[0], to: dayList[dayList.length - 1], days, utc: true },
  totals: { views: sum(all.page), visitorDays: perDay.reduce((x, d) => x + d.visitors, 0) },
  perDay: perDay.map(({ day, visitors, views }) => ({ day, visitors, views })),
  pages: top(all.page, 15),
  referrers: top(Object.fromEntries(Object.entries(all.ref).map(([k, n]) => [k === siteHost ? "(within the site)" : k, n])), 15),
  countries: top(all.country, 15),
  devices: all.device,
  video: { play: all.video.play ?? 0, "25%": all.video["25"] ?? 0, "50%": all.video["50"] ?? 0, "75%": all.video["75"] ?? 0, ended: all.video.ended ?? 0 },
  today: { day: last.day, visitors: last.visitors, views: last.views, previousDailyAverage: { visitors: Math.round(avg((d) => d.visitors) * 10) / 10, views: Math.round(avg((d) => d.views) * 10) / 10 } },
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
  const rows = (list: [string, number][], of: number) => list.map(([k, n]) => `  ${String(n).padStart(6)}  ${pct(n, of).padStart(4)}  ${k}`).join("\n") || "  (none)";
  const views = summary.totals.views;
  console.log(`Canary Court visits, ${summary.range.from} → ${summary.range.to} (UTC)\n`);
  console.log(`Views ${views} · visitor-days ${summary.totals.visitorDays} (unique per day; not linkable across days)\n`);
  console.log("Per day             visitors   views");
  for (const d of summary.perDay) console.log(`  ${d.day}        ${String(d.visitors).padStart(6)}  ${String(d.views).padStart(6)}`);
  console.log(
    `\nToday (${last.day}, so far): ${last.visitors} visitors, ${last.views} views · before: ${summary.today.previousDailyAverage.visitors} visitors, ${summary.today.previousDailyAverage.views} views a day on average`,
  );
  console.log(`\nTop pages\n${rows(summary.pages, views)}`);
  console.log(`\nReferrers\n${rows(summary.referrers, views)}`);
  console.log(`\nCountries\n${rows(summary.countries, views)}`);
  const dev = sum(all.device);
  console.log(`\nDevices\n  mobile ${pct(all.device.mobile ?? 0, dev)} · desktop ${pct(all.device.desktop ?? 0, dev)}`);
  const v = summary.video;
  console.log(`\nDemo video\n  plays ${v.play} → 25% ${v["25%"]} → 50% ${v["50%"]} → 75% ${v["75%"]} → ended ${v.ended}${v.play ? ` (${pct(v.ended, v.play)} watched to the end)` : ""}`);
}
