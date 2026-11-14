// pnpm test: the GoatCounter count URLs the site sends (no network, no browser).

import assert from "node:assert/strict";
import { test } from "node:test";
import { countUrl } from "./beacon";

const at = { hostname: "canary-court.vercel.app", host: "canary-court.vercel.app", capture: false, title: "Join · Canary Court", screen: "1440,900,2", rnd: 0.5 };
const params = (u: string | null) => Object.fromEntries(new URL(u!).searchParams);

test("a page view: path, referrer, title, screen, cache-buster", () => {
  const u = countUrl({ event: "view", path: "/join", ref: "x.com" }, at);
  assert.ok(u!.startsWith("https://canarycourt.goatcounter.com/count?"));
  assert.deepEqual(params(u), { p: "/join", r: "https://x.com", t: "Join · Canary Court", s: "1440,900,2", rnd: "0.5" });
});

test("no referrer for a direct visit or a move within the site", () => {
  assert.equal(params(countUrl({ event: "view", path: "/", ref: "direct" }, at)).r, undefined);
  assert.equal(params(countUrl({ event: "view", path: "/app", ref: "canary-court.vercel.app" }, at)).r, undefined);
});

test("nothing is counted locally or in a capture", () => {
  assert.equal(countUrl({ event: "view", path: "/", ref: "direct" }, { ...at, hostname: "localhost", host: "localhost:3100" }), null);
  assert.equal(countUrl({ event: "view", path: "/", ref: "direct" }, { ...at, hostname: "127.0.0.1", host: "127.0.0.1:3100" }), null);
  assert.equal(countUrl({ event: "view", path: "/", ref: "direct" }, { ...at, capture: true }), null);
});
