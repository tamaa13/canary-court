// Our own visit counter: privacy-friendly and minimal. No cookies, no stored id, no fingerprint, never a raw IP. A hit
// (one page view, or a step of the demo video) becomes a few counters in Upstash Redis over its REST API, per UTC day:
//   v:<day>:page     hash  path (dynamic ids folded: /app/jobs/:id) → views
//   v:<day>:ref      hash  referring host, or "direct" → views
//   v:<day>:country  hash  ISO country (Vercel's x-vercel-ip-country), or "XX" → views
//   v:<day>:device   hash  mobile | desktop → views
//   v:<day>:video    hash  play | 25 | 50 | 75 | ended → count
//   v:<day>:uv       HyperLogLog of sha256(ip + user agent + that day's salt): daily unique visitors, nothing reversible
//   v:salt:<day>     the day's random salt, kept 2 days then gone (after that, no hash can be linked to anyone)
// Every key expires after 90 days. Bots are dropped by user agent. Read back with `pnpm visits`.

import { createHash, randomBytes } from "node:crypto";

export const TTL_S = 90 * 24 * 3600;
const SALT_TTL_S = 2 * 24 * 3600;

export const BOT =
  /bot|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|httpclient|axios|node-fetch|undici|go-http|java\/|okhttp|monitor|uptime|phantom|selenium|puppeteer|playwright/i;

export const VIDEO_STEPS = ["play", "25", "50", "75", "ended"] as const;
export type Hit = { event: "view"; path: string; ref: string } | { event: "video"; step: (typeof VIDEO_STEPS)[number] };

/** "/app/jobs/80?x" → "/app/jobs/:id": pathname only, ids folded, bounded */
export function normalizePath(p: string): string | null {
  const path = p.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (path.length > 100 || !/^\/[a-z0-9\-._/]*$/i.test(path)) return null;
  return path.replace(/^\/app\/jobs\/[^/]+$/, "/app/jobs/:id").replace(/^\/app\/agents\/[^/]+$/, "/app/agents/:id");
}

/** a referrer's host, lower case, or "direct" */
export function normalizeRef(r: unknown): string {
  if (typeof r !== "string" || !r || r === "direct") return "direct";
  const host = r.toLowerCase().replace(/^https?:\/\//, "").split(/[/?#:]/)[0]!;
  return /^[a-z0-9.-]{1,80}$/.test(host) ? host : "direct";
}

/** the beacon's body, checked (anything else is dropped) */
export function parseHit(raw: string): Hit | null {
  let b: unknown;
  try {
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (o.event === "view" && typeof o.path === "string") {
    const path = normalizePath(o.path);
    return path ? { event: "view", path, ref: normalizeRef(o.ref) } : null;
  }
  if (o.event === "video" && VIDEO_STEPS.includes(o.step as (typeof VIDEO_STEPS)[number])) return { event: "video", step: o.step as (typeof VIDEO_STEPS)[number] };
  return null;
}

export const deviceOf = (ua: string) => (/Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "desktop");
export const countryOf = (h: string | null) => (h && /^[A-Z]{2}$/.test(h) ? h : "XX");
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** runs Redis commands in one round trip (Upstash's /pipeline) and returns each result */
export type Exec = (cmds: (string | number)[][]) => Promise<unknown[]>;

export function upstash(url: string, token: string, fetchImpl: typeof fetch = fetch): Exec {
  return async (cmds) => {
    const r = await fetchImpl(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds),
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`upstash ${r.status}`);
    return ((await r.json()) as { result?: unknown; error?: string }[]).map((x) => x.result);
  };
}

/** the Redis credentials, from Upstash's own names or the Vercel Marketplace (KV_*) ones; null: counting is off */
export function redisEnv(env: Record<string, string | undefined> = process.env): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/** count one hit */
export async function record(hit: Hit, who: { ip: string; ua: string; country: string }, exec: Exec, now = new Date()): Promise<void> {
  const day = dayOf(now);
  const k = (name: string) => `v:${day}:${name}`;
  const cmds: (string | number)[][] = [];
  const bump = (name: string, field: string) => cmds.push(["HINCRBY", k(name), field, 1], ["EXPIRE", k(name), TTL_S]);
  if (hit.event === "video") bump("video", hit.step);
  else {
    bump("page", hit.path);
    bump("ref", hit.ref);
    bump("country", who.country);
    bump("device", deviceOf(who.ua));
    // (unique visitors: a one-way hash with a salt that only lives two days; the IP itself goes nowhere)
    const salt = (await exec([["SET", `v:salt:${day}`, randomBytes(16).toString("hex"), "NX", "EX", SALT_TTL_S], ["GET", `v:salt:${day}`]]))[1];
    if (typeof salt === "string" && who.ip) {
      const id = createHash("sha256").update(`${who.ip}\n${who.ua}\n${salt}`).digest("hex");
      cmds.push(["PFADD", k("uv"), id], ["EXPIRE", k("uv"), TTL_S]);
    }
  }
  await exec(cmds);
}
