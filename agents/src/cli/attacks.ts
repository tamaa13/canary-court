import { config } from '../config.js';
import { World } from '../runtime/world.js';
import { runAttacks } from '../scenarios/attacks.js';
import { log } from '../util/log.js';
import { cliFlags, fixture, setJsonMode, showRecordedTestnetRun, writeJson } from './common.js';

const f = cliFlags();
setJsonMode(f.json);
const world = new World({ dryRun: f.dryRun, record: !f.dryRun || f.record, replay: f.dryRun ? f.replay : undefined, mockLlm: f.mockLlm });

try {
  const res = await runAttacks(world);
  const path = fixture('attack-receipts.json', f.dryRun);
  // Shape agreed with rt-web (ARCHITECTURE §6): a flat array of receipts.
  writeJson(path, res.receipts);
  writeJson(fixture('attack-run.json', f.dryRun), { project: 'Canary Court', recorded_at: new Date().toISOString(), mode: world.mode, contract: config.redteamContract, ok: res.ok, llm: world.llm.name, llm_usage: world.llm.usage(), all_txs: world.book.receipts });
  log.info(`LLM usage: ${JSON.stringify(world.llm.usage())}`);
  if (f.dryRun) showRecordedTestnetRun('attack-receipts.json', 'attack run');
  log.info(`receipts → ${path}`);
  if (f.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  log.fail(`attacks crashed: ${(e as Error).stack ?? e}`);
  // never overwrite the committed receipts with a partial run; keep the evidence locally
  writeJson(fixture('attack-receipts-crashed.json', true), { crashed: String((e as Error).message ?? e), all_txs: world.book.receipts });
  process.exit(2);
}
