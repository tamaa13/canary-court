// pnpm test: the visit counter against an in-memory Redis behind a fake Upstash /pipeline (no network).

import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../../app/api/v/route";
import { TTL_S, normalizePath, normalizeRef, parseHit, record, type Exec } from "./record";

/** a tiny Redis: HINCRBY, EXPIRE, PFADD (as a set), SET NX EX, GET */
function memoryRedis() {
  const data = new Map<string, unknown>();
  const ttl = new Map<string, number>();
  const exec: Exec = async (cmds) =>
    cmds.map(([cmd, key, ...a]) => {
      const k = String(key);
      switch (cmd) {
        case "HINCRBY": {
          const h = (data.get(k) as Map<string, number>) ?? new Map<string, number>();
          h.set(String(a[0]), (h.get(String(a[0])) ?? 0) + Number(a[1]));
          data.set(k, h);
          return h.get(String(a[0]));
        }
        case "EXPIRE":
          ttl.set(k, Number(a[0]));
          return 1;
        case "PFADD": {
          const s = (data.get(k) as Set<string>) ?? new Set<string>();
          s.add(String(a[0]));
          data.set(k, s);
          return 1;
        }
        case "SET":
          if (!data.has(k)) data.set(k, String(a[0]));
          return "OK";
        case "GET":
          return data.get(k) ?? null;
        default:
          throw new Error(`unexpected ${cmd}`);
      }
    });
  return { data, ttl, exec };
}

const who = { ip: "203.0.113.7", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148", country: "ID" };
const day = new Date("2026-11-14T10:00:00Z");

test("paths: pathname only, ids folded, junk refused", () => {
  assert.equal(normalizePath("/app/jobs/80?view=x#y"), "/app/jobs/:id");
  assert.equal(normalizePath("/app/agents/sub1.arifnovrian.testnet"), "/app/agents/:id");
  assert.equal(normalizePath("/docs/quickstart/"), "/docs/quickstart");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath("/<script>"), null);
  assert.equal(normalizePath("x".repeat(200)), null);
});

test("referrers: host only, else direct", () => {
  assert.equal(normalizeRef("https://X.com/some/path?q=1"), "x.com");
  assert.equal(normalizeRef(""), "direct");
  assert.equal(normalizeRef(undefined), "direct");
  assert.equal(normalizeRef("not a host!"), "direct");
});

test("beacon bodies: views and video steps only", () => {
  assert.deepEqual(parseHit('{"event":"view","path":"/join?a=1","ref":"news.ycombinator.com"}'), { event: "view", path: "/join", ref: "news.ycombinator.com" });
  assert.deepEqual(parseHit('{"event":"video","step":"50"}'), { event: "video", step: "50" });
  assert.equal(parseHit('{"event":"video","step":"33"}'), null);
  assert.equal(parseHit('{"event":"click"}'), null);
  assert.equal(parseHit("not json"), null);
});

test("a view: page, referrer, country, device, a unique visitor; 90-day expiry; no raw IP anywhere", async () => {
  const r = memoryRedis();
  await record({ event: "view", path: "/", ref: "x.com" }, who, r.exec, day);
  await record({ event: "view", path: "/join", ref: "direct" }, who, r.exec, day);
  const h = (name: string) => Object.fromEntries((r.data.get(`v:2026-11-14:${name}`) as Map<string, number>) ?? []);
  assert.deepEqual(h("page"), { "/": 1, "/join": 1 });
  assert.deepEqual(h("ref"), { "x.com": 1, direct: 1 });
  assert.deepEqual(h("country"), { ID: 2 });
  assert.deepEqual(h("device"), { mobile: 2 });
  const uv = r.data.get("v:2026-11-14:uv") as Set<string>;
  assert.equal(uv.size, 1, "the same visitor twice is one unique");
  assert.match([...uv][0]!, /^[0-9a-f]{64}$/);
  for (const v of r.data.values()) assert.ok(!JSON.stringify(v instanceof Map || v instanceof Set ? [...v] : v).includes(who.ip), "the IP is never stored");
  for (const name of ["page", "ref", "country", "device", "uv"]) assert.equal(r.ttl.get(`v:2026-11-14:${name}`), TTL_S);
  assert.equal(typeof r.data.get("v:salt:2026-11-14"), "string");
});

test("the salt rotates: the same visitor on two days is two different hashes", async () => {
  const r = memoryRedis();
  await record({ event: "view", path: "/", ref: "direct" }, who, r.exec, day);
  await record({ event: "view", path: "/", ref: "direct" }, who, r.exec, new Date("2026-11-15T10:00:00Z"));
  const a = [...(r.data.get("v:2026-11-14:uv") as Set<string>)][0];
  const b = [...(r.data.get("v:2026-11-15:uv") as Set<string>)][0];
  assert.notEqual(a, b);
});

test("a video step only bumps the video funnel", async () => {
  const r = memoryRedis();
  await record({ event: "video", step: "play" }, who, r.exec, day);
  await record({ event: "video", step: "25" }, who, r.exec, day);
  assert.deepEqual(Object.fromEntries(r.data.get("v:2026-11-14:video") as Map<string, number>), { play: 1, "25": 1 });
  assert.equal(r.data.has("v:2026-11-14:page"), false);
});

test("the route: 204 always; no credentials → nothing; bots → nothing; a person → counted", async () => {
  const r = memoryRedis();
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    return new Response(JSON.stringify((await r.exec(JSON.parse(String(init?.body)))).map((result) => ({ result }))), { status: 200 });
  }) as typeof fetch;
  const req = (ua: string) =>
    new Request("http://x/api/v", { method: "POST", body: '{"event":"view","path":"/","ref":"direct"}', headers: { "user-agent": ua, "x-forwarded-for": "198.51.100.2", "x-vercel-ip-country": "SG" } });
  try {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.KV_REST_API_URL;
    assert.equal((await POST(req(who.ua))).status, 204);
    assert.equal(calls, 0, "no credentials: no call");
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    assert.equal((await POST(req("Googlebot/2.1"))).status, 204);
    assert.equal(calls, 0, "bots are dropped");
    assert.equal((await POST(req(who.ua))).status, 204);
    assert.ok(calls >= 1);
    const today = new Date().toISOString().slice(0, 10);
    assert.deepEqual(Object.fromEntries(r.data.get(`v:${today}:country`) as Map<string, number>), { SG: 1 });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});
