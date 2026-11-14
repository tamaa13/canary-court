// pnpm test: a job's state in words, the same on every /app surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JOB_STAGES, JOB_WORDS, jobWord } from "./plain";
import type { Job } from "./types";

const now = 1_800_000_000_000;
const job = (over: Partial<Job>): Job =>
  ({ id: 112, parent_id: null, depth: 0, client: "c", root_client: "c", provider: null, target_id: "tilly-x", budget: "10", remaining: "10", reward_per_finding: "5", payout_per_finding: "5", categories: [], deadline_ms: now + 3_600_000, status: "Open", restricted: false, can_subcontract: true, children: [], findings: [], pending: 0, created_ms: now - 1000, ...over }) as Job;

test("an open job reads as open for bids, never as awaiting verdicts", () => {
  assert.equal(jobWord([job({ status: "Open" })], now), JOB_WORDS.open);
  assert.equal(jobWord([job({ status: "Open", pending: 1 })], now), JOB_WORDS.open);
});

test("assigned: attacks running, or awaiting verdicts while an attack is being judged", () => {
  assert.equal(jobWord([job({ status: "Assigned", provider: "p" })], now), JOB_WORDS.running);
  assert.equal(jobWord([job({ status: "Assigned", provider: "p", pending: 1 })], now), JOB_WORDS.judging);
  // (a subjob's pending attack counts for the family)
  assert.equal(jobWord([job({ status: "Assigned" }), job({ id: 113, parent_id: 112, depth: 1, status: "Assigned", pending: 1 })], now), JOB_WORDS.judging);
});

test("past its deadline, ended, budget used up", () => {
  assert.equal(jobWord([job({ status: "Assigned", deadline_ms: now - 1 })], now), JOB_WORDS.late);
  assert.equal(jobWord([job({ status: "Expired" })], now), JOB_WORDS.expired);
  assert.equal(jobWord([job({ status: "Closed" })], now), JOB_WORDS.closed);
});

test("the job page's stage line uses the same words", () => {
  assert.deepEqual(JOB_STAGES.slice(0, 3), [JOB_WORDS.open, JOB_WORDS.running, JOB_WORDS.judging]);
});
