/**
 * `pnpm rt` — call any Canary Court method from the command line with your own account.
 *   pnpm rt view <method> ['<json args>']
 *   pnpm rt call <method> ['<json args>'] --as <account> [--key fc|full] [--deposit <NEAR>] [--contract <id>]
 * Gas is set for you (submit_finding 300 TGas, withdraw 100 TGas, else 50 TGas). Prints the decoded return value
 * and the nearblocks link; a contract panic prints its ERR_<CODE> and exits 1.
 */
import { actions, type Account } from 'near-api-js';
import { config } from '../config.js';
import { provider } from '../chain/near-contract.js';
import { NEAR } from '../util/amount.js';
import { accountFor, arg, die, txLink } from './ext-common.js';

const argv = process.argv.slice(2).filter((a, i, all) => !(a.startsWith('--') || (i > 0 && all[i - 1].startsWith('--') && !all[i - 1].includes('='))));
const [mode, method, json] = argv;
if (!mode || !method || !['view', 'call'].includes(mode)) die("usage: pnpm rt view <method> ['<json>']  |  pnpm rt call <method> ['<json>'] --as <account> [--key fc|full] [--deposit <NEAR>]");
let args: Record<string, unknown>;
try {
  args = json ? JSON.parse(json) : {};
} catch {
  die(`args must be JSON, got: ${json}`);
}
const contractId = arg('contract') ?? config.redteamContract;

if (mode === 'view') {
  const r = await provider().callFunction({ contractId, method, args });
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(0);
}

const as = arg('as') ?? die('--as <your account> is required for calls');
const account: Account = accountFor(as, (arg('key') as 'fc' | 'full') ?? 'full');
const gas = method === 'submit_finding' ? 300_000_000_000_000n : method === 'withdraw' || method === 'withdraw_compute' || method === 'ft_transfer_call' ? 100_000_000_000_000n : 50_000_000_000_000n;
const deposit = arg('deposit') ? NEAR(arg('deposit')!) : method === 'ft_transfer_call' ? 1n : 0n;
type Tx = Awaited<ReturnType<Account['signAndSendTransaction']>>;
let res: Tx;
try {
  res = await account.signAndSendTransaction({
    receiverId: contractId, actions: [actions.functionCall(method, args, gas, deposit)],
    waitUntil: method === 'submit_finding' ? 'INCLUDED_FINAL' : 'EXECUTED_OPTIMISTIC', throwOnFailure: false,
  });
} catch (e) {
  die(`rejected before inclusion: ${(e as Error).message}`);
}
const hash = res.transaction.hash as string;
// submit_finding: OutLayer resumes later; wait only for the redteam receipt itself (finding id or panic)
for (let i = 0; method === 'submit_finding' && i < 60; i++) {
  const first = res.receipts_outcome?.find((r) => r.id === res.transaction_outcome?.outcome.receipt_ids?.[0]);
  if (first && first.outcome.status !== 'Unknown') break;
  await new Promise((r) => setTimeout(r, 1500));
  res = (await provider().viewTransactionStatus({ txHash: hash, accountId: as, waitUntil: 'INCLUDED_FINAL' })) as Tx;
}
const failures = [res.status, ...(res.receipts_outcome ?? []).map((r) => r.outcome.status)].filter((s) => s && typeof s === 'object' && 'Failure' in s).map((s) => JSON.stringify(s));
const panic = failures.map((m) => m.match(/ERR_[A-Z_]+:[^"\\]*/)?.[0]).find(Boolean) ?? failures[0];
if (panic) {
  process.stderr.write(`FAILED: ${panic}\n${txLink(hash)}\n`);
  process.exit(1);
}
const first = res.receipts_outcome?.[0]?.outcome.status as { SuccessValue?: string } | undefined;
const raw = (res.status as { SuccessValue?: string })?.SuccessValue ?? first?.SuccessValue;
const text = raw ? Buffer.from(raw, 'base64').toString('utf8') : '';
let value: unknown = text;
try { value = text ? JSON.parse(text) : null; } catch { /* plain */ }
process.stdout.write(JSON.stringify({ ok: true, method, value, tx: txLink(hash) }, null, 2) + '\n');
