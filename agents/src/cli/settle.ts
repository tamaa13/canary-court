/**
 * `pnpm settle` — expire every past-deadline, still-active job tree owned by our client agents
 * (client + copycat), so escrowed tUSDC rolls back to them. Safe to run any time; anyone may expire.
 */
import { config } from '../config.js';
import { World } from '../runtime/world.js';
import type { Job } from '../chain/types.js';
import { ClientAgent } from '../agents/client.js';
import { fmtUsdc } from '../util/amount.js';
import { log } from '../util/log.js';

const world = new World({ dryRun: false, mockLlm: true });
log.section(`Canary Court · settle · ${config.redteamContract}`);
for (const name of ['client', 'copycat'] as const) {
  const agent = new ClientAgent(world.ctx(name));
  const all: Job[] = [];
  for (let from = 0; ; from += 200) {
    const page = await agent.chain.listJobs(from, 200);
    all.push(...page);
    if (page.length < 200) break;
  }
  const now = Date.now();
  const roots = all.filter((j) => j.depth === 0 && j.client === agent.id && now > j.deadline_ms &&
    [j, ...j.children.map((c) => all[c])].some((x) => x && (x.status === 'Open' || x.status === 'Assigned')));
  const before = BigInt((await agent.chain.balanceOf(agent.id)).usdc);
  for (const r of roots) {
    try {
      await agent.expireTree(r.id);
    } catch (e) {
      log.warn(`job #${r.id}: ${(e as Error).message}`);
    }
  }
  const after = BigInt((await agent.chain.balanceOf(agent.id)).usdc);
  log.info(`${name}: expired ${roots.length} job tree(s), refunded ${fmtUsdc(after - before)} → internal balance ${fmtUsdc(after)}`);
}
