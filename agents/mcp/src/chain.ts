/**
 * Minimal NEAR testnet client for the MCP server on the modular near-js libs (@near-js/*, Node ≥ 20):
 * retrying/rotating RPC, read-after-write-safe views, signed calls with contract panics surfaced as
 * `ERR_…` errors, and faucet account creation over HTTP (no near-cli).
 */
import { Account } from '@near-js/accounts';
import { KeyPair, type KeyPairString } from '@near-js/crypto';
import { JsonRpcProvider, type Provider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { actionCreators } from '@near-js/transactions';
import { NET } from './pure.js';

const RETRYABLE = /429|rate limit|too many requests|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|503|502/i;

/** Same policy as the agents' live client: exponential backoff on 429/transient errors, rotate endpoints. */
function resilient(ps: JsonRpcProvider[]): Provider {
  let cur = 0;
  return new Proxy(ps[0], {
    get(_t, prop) {
      const v = Reflect.get(ps[cur], prop);
      if (typeof v !== 'function') return v;
      return async (...args: unknown[]) => {
        let delay = 800;
        for (let attempt = 0; ; attempt++) {
          try {
            const p = ps[cur];
            return await (Reflect.get(p, prop) as (...a: unknown[]) => unknown).apply(p, args);
          } catch (e) {
            const msg = `${(e as Error).message ?? ''} ${String((e as { cause?: unknown }).cause ?? '')}`;
            if (!RETRYABLE.test(msg) || attempt >= 10) throw e;
            cur = (cur + 1) % ps.length;
            await new Promise((r) => setTimeout(r, delay + Math.random() * 300));
            delay = Math.min(delay * 2, 15_000);
          }
        }
      };
    },
  }) as unknown as Provider;
}

let shared: Provider | null = null;
const provider = (): Provider => (shared ??= resilient(NET.rpcUrls.map((url) => new JsonRpcProvider({ url }))));

let minHeight = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** View call that never reads a block older than our last landed tx (load-balanced RPC nodes can lag). */
export async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = NET.redteam): Promise<T> {
  for (let i = 0; ; i++) {
    const r = (await provider().query({
      request_type: 'call_function', account_id: contractId, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'optimistic',
    })) as unknown as { result: number[]; block_height: number };
    if (r.block_height >= minHeight || i >= 10) {
      const s = Buffer.from(r.result).toString('utf8');
      return (s ? JSON.parse(s) : null) as T;
    }
    await sleep(600);
  }
}

/** "Not found" errors differ by library version: "does not exist" (near-api-js 7), "doesn't exist" (@near-js 2), RPC codes. */
const missing = (e: unknown) => {
  const x = e as { constructor?: { name?: string }; message?: string; type?: string; code?: string };
  return /does(n't| not) exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|AccountDoesNotExist|AccessKeyDoesNotExist/i.test(`${x?.constructor?.name} ${x?.type ?? ''} ${x?.code ?? ''} ${x?.message ?? e}`);
};

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await provider().viewAccount(accountId, { finality: 'optimistic' });
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}
export async function accessKeyExists(accountId: string, publicKey: string): Promise<boolean> {
  try {
    await provider().viewAccessKey(accountId, publicKey, { finality: 'optimistic' });
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}
/** Spendable NEAR (balance minus storage stake). */
export async function liquidYocto(accountId: string): Promise<bigint> {
  const a = await provider().viewAccount(accountId, { finality: 'optimistic' });
  return BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n;
}
export const ftBalance = async (accountId: string) => (await view<string>('ft_balance_of', { account_id: accountId }, NET.tusdc)) ?? '0';

export class ChainError extends Error {}

type Outcome = Awaited<ReturnType<Account['signAndSendTransaction']>>;

function failure(res: Outcome): string | null {
  const msgs: string[] = [];
  const visit = (st: unknown) => { if (st && typeof st === 'object' && 'Failure' in st) msgs.push(JSON.stringify((st as { Failure: unknown }).Failure)); };
  visit(res.status);
  for (const r of res.receipts_outcome ?? []) visit(r.outcome.status);
  if (!msgs.length) return null;
  return msgs.map((m) => m.match(/ERR_[A-Z_]+:[^"\\]*/)?.[0]).find(Boolean) ?? msgs.map((m) => m.match(/"ExecutionError":"([^"]+)"/)?.[1]).find(Boolean) ?? msgs[0];
}

async function noteHeight(res: Outcome): Promise<void> {
  type WithHash = { block_hash?: string };
  const h = (res.receipts_outcome?.at(-1) as WithHash | undefined)?.block_hash ?? (res.transaction_outcome as WithHash | undefined)?.block_hash;
  if (!h) return;
  try {
    minHeight = Math.max(minHeight, Number((await provider().viewBlock({ blockId: h })).header.height));
  } catch { /* best effort */ }
}

export const GAS = { normal: 50_000_000_000_000n, transfer: 100_000_000_000_000n, submit: 300_000_000_000_000n };

export class Signer {
  readonly account: Account;
  constructor(readonly accountId: string, secret: string) {
    this.account = new Account(accountId, provider(), KeyPairSigner.fromSecretKey(secret as KeyPairString));
  }

  /** Function call; returns the decoded return value and the tx hash. Throws ChainError("ERR_…") on any failed receipt. */
  async call<T = unknown>(receiverId: string, method: string, args: Record<string, unknown>, opts: { deposit?: bigint; gas?: bigint } = {}): Promise<{ value: T; tx: string }> {
    let res: Outcome;
    try {
      res = await this.account.signAndSendTransaction({
        receiverId, actions: [actionCreators.functionCall(method, args, opts.gas ?? GAS.normal, opts.deposit ?? 0n)], throwOnFailure: false,
      });
    } catch (e) {
      throw new ChainError(`${(e as Error).name ?? ''}: ${(e as Error).message ?? e}`);
    }
    await noteHeight(res);
    const fail = failure(res);
    if (fail) throw new ChainError(fail);
    const ok = (res.status as { SuccessValue?: string }).SuccessValue;
    const s = ok ? Buffer.from(ok, 'base64').toString('utf8') : '';
    let value: unknown = undefined;
    try { value = s ? JSON.parse(s) : undefined; } catch { value = s; }
    return { value: value as T, tx: res.transaction.hash as string };
  }

  /** AddKey: function-call key scoped to the escrow (needs the full-access signer). */
  async addFcKey(publicKey: string, methodNames: string[], allowance: bigint): Promise<string> {
    let r: Outcome;
    try {
      r = await this.account.addFunctionCallAccessKey({ publicKey, contractId: NET.redteam, methodNames, allowance });
    } catch (e) {
      throw new ChainError(`${(e as Error).name ?? ''}: ${(e as Error).message ?? e}`);
    }
    await noteHeight(r);
    const fail = failure(r);
    if (fail) throw new ChainError(fail);
    return r.transaction.hash as string;
  }
}

export const newKeyPair = () => KeyPair.fromRandom('ed25519');

/** Create `<name>.testnet` sponsored by the testnet faucet (the helper near-cli-rs uses), for `publicKey`. */
export async function faucetCreate(accountId: string, publicKey: string): Promise<void> {
  const res = await fetch(NET.faucetUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ChainError(`faucet ${res.status}: ${text.slice(0, 200)}`);
  // The helper returns the creation tx outcome; a Failure in it means the account was not created.
  if (/"Failure"/.test(text) && !/"SuccessValue"/.test(text)) throw new ChainError(`faucet: account creation failed: ${text.slice(0, 200)}`);
}
