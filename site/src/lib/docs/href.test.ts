// pnpm test: links in docs/site/*.md, as the site renders them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { docHref } from "./href";

test("another docs page becomes /docs/<slug>, hash kept", () => {
  assert.equal(docHref("03-quickstart.md"), "/docs/quickstart");
  assert.equal(docHref("./13-reputation.md#the-three-levels"), "/docs/reputation#the-three-levels");
});

test("a repo file opens on GitHub (blob), hash kept", () => {
  assert.equal(docHref("../../contracts/redteam/src/eval.rs"), "https://github.com/tamaa13/canary-court/blob/main/contracts/redteam/src/eval.rs");
  assert.equal(docHref("../../contracts/README.md#known-history-testnet"), "https://github.com/tamaa13/canary-court/blob/main/contracts/README.md#known-history-testnet");
  assert.equal(docHref("../../contracts/VIEWS.md#policy-log-actions-get_policy_log"), "https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md#policy-log-actions-get_policy_log");
  assert.equal(docHref("../README.md"), "https://github.com/tamaa13/canary-court/blob/main/docs/README.md");
});

test("a repo folder opens on GitHub (tree)", () => {
  assert.equal(docHref("../../contracts/redteam/src"), "https://github.com/tamaa13/canary-court/tree/main/contracts/redteam/src");
  assert.equal(docHref("../../contracts/redteam/src/"), "https://github.com/tamaa13/canary-court/tree/main/contracts/redteam/src");
});

test("a ../ path that lands back in docs/site is a docs page", () => {
  assert.equal(docHref("../site/12-verdicts-and-payouts.md#x"), "/docs/verdicts-and-payouts#x");
});

test("everything else is left as written", () => {
  assert.equal(docHref("https://near.org"), "https://near.org");
  assert.equal(docHref("#anchor"), "#anchor");
  assert.equal(docHref("/skill.md"), "/skill.md");
});
