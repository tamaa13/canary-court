/**
 * `pnpm smoke` — cheap live check of the runtime path (no fresh mallory consumed, no funds moved):
 * fail-closed key scope per agent, views, key-scope rejections (pre-inclusion), one on-chain ERR_ panic.
 */
import { config, txUrl } from '../config.js';
import { ChainError } from '../chain/contract.js';
import { NearRedteam } from '../chain/near-contract.js';
import { loadRuntimeKeys } from '../crypto/keys.js';
import { fmtNear, fmtUsdc } from '../util/amount.js';
import { log } from '../util/log.js';

let ok = true;
const expectErr = async (label: string, fn: () => Promise<unknown>, codes: string[]) => {
  try {
    await fn();
    ok = false;
    log.fail(`${label}: unexpectedly succeeded`);
  } catch (e) {
    const ce = e as ChainError;
    const hit = codes.some((c) => ce.code === c || String(ce.message).includes(c));
    ok &&= hit;
    (hit ? log.ok : log.fail)(`${label}: ${ce.code} (${ce.stage}${ce.txHash ? ` ${txUrl(ce.txHash)}` : ', no tx'})`);
  }
};

log.section(`Canary Court · smoke · ${config.redteamContract}`);
for (const name of ['client', 'lead', 'sub1', 'sub2'] as const) {
  const c = new NearRedteam(loadRuntimeKeys(config.accounts[name]));
  await c.verifyKeyScope();
  const [a, b, v] = await Promise.all([c.getAgent(c.accountId), c.balanceOf(c.accountId), c.checkCounterparty(c.accountId)]);
  log.ok(`${name}: FC key scoped to redteam ✓ · registered ${a?.role ?? 'NO'} · ${fmtUsdc(b.usdc)} · compute ${fmtNear(b.compute)} · ${v.level} [${v.reasons.join('; ')}]`);
}
const lead = new NearRedteam(loadRuntimeKeys(config.accounts.lead));
await expectErr('ft_transfer via runtime key', () => lead.rawCall({ receiverId: config.tusdcContract, method: 'ft_transfer', args: { receiver_id: config.accounts.mallory, amount: '1' }, depositYocto: 1n }), ['DepositWithFunctionCall', 'ReceiverMismatch']);
await expectErr('ft_transfer, 0 deposit', () => lead.rawCall({ receiverId: config.tusdcContract, method: 'ft_transfer', args: { receiver_id: config.accounts.mallory, amount: '1' } }), ['ReceiverMismatch']);
await expectErr('native Transfer', () => lead.rawCall({ receiverId: config.accounts.mallory, method: '', args: {}, action: 'Transfer', depositYocto: 1n }), ['RequiresFullAccess']);
await expectErr('create_subjob on missing job (on-chain panic)', () => lead.createSubjob({ parent_id: 999999, budget: '1', reward_per_finding: '1', categories: ['jailbreak'], deadline_ms: Date.now() + 3600_000 }), ['ERR_NOT_FOUND']);
log.section(ok ? 'smoke passed' : 'smoke FAILED');
process.exit(ok ? 0 : 1);
