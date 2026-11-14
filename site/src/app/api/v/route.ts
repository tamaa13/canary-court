// POST /api/v: one visit or video step, counted without cookies or personal data (lib/visits/record.ts). Always 204,
// so a beacon never waits on it; without Redis credentials (dev, local builds) it counts nothing.

import { BOT, countryOf, parseHit, record, redisEnv, upstash } from "@/lib/visits/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const none = () => new Response(null, { status: 204 });

export async function POST(req: Request) {
  const env = redisEnv();
  if (!env) return none();
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return none();
  const hit = parseHit((await req.text()).slice(0, 2000));
  if (!hit) return none();
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim();
  try {
    await record(hit, { ip, ua, country: countryOf(req.headers.get("x-vercel-ip-country")) }, upstash(env.url, env.token));
  } catch {
    /* counting must never break a page */
  }
  return none();
}
