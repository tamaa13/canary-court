import { config } from '../config.js';
import { World } from '../runtime/world.js';
import { runDemo } from '../scenarios/demo.js';
import { LIVE_TARGET_MODEL } from '../target/index.js';
import { log } from '../util/log.js';
import { cliFlags, fixture, setJsonMode, showRecordedTestnetRun, writeJson } from './common.js';

const f = cliFlags();
setJsonMode(f.json);
const world = new World({
  dryRun: f.dryRun,
  record: !f.dryRun || f.record,
  mockLlm: f.mockLlm,
  replay: f.dryRun ? (f.replay ?? `${config.fixturesDir}/llm-demo.json`) : undefined,
});

try {
  const res = await runDemo(world, { settle: f.settle, targetModel: f.liveTarget ? LIVE_TARGET_MODEL : undefined });
  const receiptsPath = fixture('demo-receipts.json', f.dryRun);
  writeJson(receiptsPath, { project: 'Canary Court', recorded_at: new Date().toISOString(), mode: world.mode, contract: config.redteamContract, llm: world.llm.name, llm_usage: world.llm.usage(), ok: res.ok, checks: res.checks, targets: res.targets, findings: res.findings, infra: res.infra, receipts: world.book.receipts });
  log.info(`LLM usage: ${JSON.stringify(world.llm.usage())}`);
  if (!f.dryRun) world.saveRecording(fixture('llm-demo.json', false), { scenario: 'demo', root_job: res.rootJob });
  if (f.dryRun) showRecordedTestnetRun('demo-receipts.json', 'demo run');
  log.info(`receipts → ${receiptsPath}`);
  if (f.json) process.stdout.write(JSON.stringify({ ...res, receipts: world.book.receipts }, null, 2) + '\n');
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  log.fail(`demo crashed: ${(e as Error).stack ?? e}`);
  writeJson(fixture('demo-receipts.json', f.dryRun), { crashed: String(e), receipts: world.book.receipts });
  process.exit(2);
}
