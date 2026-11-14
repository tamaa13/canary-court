// Writes public/snapshot/market.json: the market as the app's Live mode reads it (same loader, same RPC client, e2e
// accounts hidden), pinned to one final block. /app shows it when a cold live load hasn't finished in 15 s, labelled
// "snapshot from <time>" (a first visit has no browser cache to fall back on). Re-run before a deploy:
//
//     pnpm snapshot
//
// Read-only: view calls only, through the same rate limiter as the browser.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isE2eAccount, loadSnapshot } from "../src/lib/market/snapshot";
import { Limiter, Rpc, TESTNET_RPCS } from "../src/lib/near";

const CONTRACT = process.argv[2] ?? "redteam.arifnovrian.testnet";
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/snapshot/market.json");

const rpc = new Rpc(TESTNET_RPCS, 20_000, new Limiter(2));
const head = await rpc.block({ finality: "final" });
const view = async <T>(method: string, args: Record<string, unknown> = {}) => (await rpc.view<T>(CONTRACT, method, args, { block_id: head.height })).value;
const t0 = Date.now();
const s = await loadSnapshot(view, { height: head.height, timeMs: head.timeMs }, undefined, 2, { skipAccount: isE2eAccount });
const snapshot = { ...s, receipts: [] };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ contract: CONTRACT, at: new Date(head.timeMs).toISOString(), snapshot }));
console.log(`block ${head.height}: ${s.jobs.length} jobs, ${s.findings.length} findings, ${s.agents.length} agents, ${s.policyLog.length} policy entries, missing history ${s.missingHistory ?? 0} (${Math.round((Date.now() - t0) / 1000)} s) → ${out}`);
