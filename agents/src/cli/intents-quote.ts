/**
 * `pnpm intents:quote` — the client agent previews funding its red-team budget from another chain via a
 * NEAR Intents 1Click quote (`dry: true`: no deposit address, nothing moves). `--dry-run` replays the
 * recorded quote in fixtures/intents-quote.json (offline).
 */
import { config } from '../config.js';
import { makeLlm } from '../llm/llm.js';
import { ASSETS, fundingQuote, type QuoteResponse } from '../intents/oneclick.js';
import { color, log } from '../util/log.js';
import { cliFlags, readJson, setJsonMode, writeJson } from './common.js';

const f = cliFlags();
setJsonMode(f.json);
const FIXTURE = `${config.fixturesDir}/intents-quote.json`;
/** Placeholders only: a dry quote needs syntactically valid addresses but never uses them. */
const RECIPIENT = process.env.INTENTS_RECIPIENT || 'redteam-demo.near';
const REFUND_EVM = process.env.INTENTS_REFUND_EVM || '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';

log.section(`Canary Court · NEAR Intents 1Click dry quote · ${f.dryRun ? 'recorded fixture' : 'live API'}`);

const llm = makeLlm({ dryRun: f.dryRun, mockLlm: f.mockLlm });
const plan = (await llm.decide<{ amount_usdc: number; origin: 'arbitrum' | 'base'; rationale?: string }>({
  agent: 'client', task: 'plan_funding',
  system: 'You are the CLIENT agent. Your escrow budget is denominated in USDC on NEAR. Decide how much USDC to bridge in from another chain for the next red-team job.',
  user: 'Next job: budget 100 USDC plus ~20% headroom for counter-offers and a second round. You hold USDC on Arbitrum and Base. JSON: {"amount_usdc":number,"origin":"arbitrum"|"base","rationale":"..."}',
  fallback: () => ({ amount_usdc: 120, origin: 'arbitrum', rationale: '100 budget + 20% headroom, from Arbitrum USDC' }),
  validate: (v) => (v.amount_usdc >= 10 && v.amount_usdc <= 1000 && ['arbitrum', 'base'].includes(v.origin) ? null : 'amount 10..1000, origin arbitrum|base'),
})).value;
log.agent('client', `plan: bridge ${plan.amount_usdc} USDC from ${plan.origin} → USDC on NEAR (${plan.rationale ?? ''})`);

let out: { route: string; res: QuoteResponse; attempts: string[]; recorded_at?: string };
if (f.dryRun) {
  const rec = readJson<typeof out>(FIXTURE);
  if (!rec) {
    log.fail(`no recorded quote at ${FIXTURE}; run without --dry-run once (needs internet, no keys)`);
    process.exit(1);
  }
  out = rec;
  log.info(color.dim(`replaying quote recorded at ${rec.recorded_at}`));
} else {
  try {
    out = await fundingQuote({ amountUsdc: plan.amount_usdc, origin: plan.origin === 'base' ? ASSETS.BASE_USDC : ASSETS.ARB_USDC, recipient: RECIPIENT, refundEvm: REFUND_EVM });
  } catch (e) {
    log.fail((e as Error).message);
    process.exit(1);
  }
  writeJson(FIXTURE, { recorded_at: new Date().toISOString(), ...out });
}

const q = out.res.quote;
for (const a of out.attempts) log.info(color.dim(`route skipped → ${a}`));
log.agent('client', `route: ${out.route}`);
log.info(`in : ${q.amountInFormatted} ${out.res.quoteRequest.originAsset}${q.amountInUsd ? ` (~$${Number(q.amountInUsd).toFixed(2)})` : ''}`);
log.info(`out: ${q.amountOutFormatted} USDC on NEAR (min ${(Number(q.minAmountOut) / 1e6).toFixed(6)} @ ${out.res.quoteRequest.slippageTolerance / 100}% slippage)${q.amountOutUsd ? ` (~$${Number(q.amountOutUsd).toFixed(2)})` : ''}`);
log.info(`eta: ~${q.timeEstimate}s · dry=${out.res.quoteRequest.dry} → no deposit address issued, nothing moved`);
log.info(color.dim('Then the client would ft_transfer_call the USDC into redteam (msg "") during setup. 1Click is mainnet-only; the escrow demo runs on testnet with tUSDC.'));
log.info(color.dim(`LLM usage: ${JSON.stringify(llm.usage())}`));
if (f.json) process.stdout.write(JSON.stringify({ plan, ...out, llm_usage: llm.usage() }, null, 2) + '\n');
