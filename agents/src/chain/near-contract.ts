/**
 * Live `redteam` client on NEAR testnet (near-api-js v7). Agents sign ONLY with their function-call
 * key scoped to the redteam contract (0-deposit calls); see crypto/keys.ts for the fail-closed check.
 */
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, type KeyPairString, type Provider } from 'near-api-js';
import { config } from '../config.js';
import { assertFunctionCallOnly, type RuntimeKeys } from '../crypto/keys.js';
import { ChainError, errCode, type CreateJobArgs, type CreateSubjobArgs, type RawCall, type RedteamContract, type TxOutcome } from './contract.js';
import type {
  Agent, Balance, Bid, ContractConfig, Finding, Job, PolicyLogEntry, Target, Verdict,
} from './types.js';

const GAS = 50_000_000_000_000n; // 50 Tgas (prepaid gas is reserved from the liquid balance)
const GAS_WITHDRAW = 100_000_000_000_000n; // withdraw → tusdc.ft_transfer + callback
const GAS_SUBMIT = 300_000_000_000_000n; // submit_finding → OutLayer request + callback

type RpcTx = Awaited<ReturnType<Account['signAndSendTransaction']>>;

const RETRYABLE = /429|rate limit|too many requests|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|503|502/i;

/**
 * Rate-limit tolerant provider: every call retries with exponential backoff on 429 / transient network
 * errors and rotates across config.rpcUrls (free public RPCs are shared per IP with the rest of the team).
 * Re-sending the same SignedTransaction is idempotent (same tx hash), so retrying sends is safe.
 */
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
            if (!RETRYABLE.test(msg) || attempt >= 14) throw e; // ≈ 3 min of backoff across all endpoints
            cur = (cur + 1) % ps.length;
            await new Promise((r) => setTimeout(r, delay + Math.random() * 300));
            delay = Math.min(delay * 2, 15_000);
          }
        }
      };
    },
  }) as unknown as Provider;
}

let sharedProvider: Provider | null = null;
export function provider(): Provider {
  return (sharedProvider ??= resilient(config.rpcUrls.map((url) => new JsonRpcProvider({ url }))));
}

/**
 * Read-after-write guard: views must come from a block at least as new as the last tx we saw land
 * (load-balanced RPC nodes can lag). Shared by all agents in this process.
 */
let minViewHeight = 0;
async function noteTxHeight(res: RpcTx): Promise<void> {
  const last = res.receipts_outcome?.at(-1)?.block_hash ?? res.transaction_outcome?.block_hash;
  if (!last) return;
  try {
    const b = await provider().viewBlock({ blockId: last });
    minViewHeight = Math.max(minViewHeight, Number(b.header.height));
  } catch {
    /* best effort */
  }
}

function decodeSuccess(v: string | undefined): unknown {
  if (!v) return undefined;
  const s = Buffer.from(v, 'base64').toString('utf8');
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Find the innermost human-readable failure in a tx result (panic string of the contract). */
function failureMessage(res: RpcTx): string | null {
  const msgs: string[] = [];
  const visit = (st: unknown) => {
    if (st && typeof st === 'object' && 'Failure' in st) msgs.push(JSON.stringify((st as { Failure: unknown }).Failure));
  };
  visit(res.status);
  for (const r of res.receipts_outcome ?? []) visit(r.outcome.status);
  if (!msgs.length) return null;
  const panic = msgs.map((m) => m.match(/ERR_[A-Z_]+:[^"\\]*/)?.[0]).find(Boolean);
  if (panic) return panic;
  const exec = msgs.map((m) => m.match(/"ExecutionError":"([^"]+)"/)?.[1]).find(Boolean);
  return exec ?? msgs[0];
}

function rpcErrorText(e: unknown): string {
  const err = e as { type?: string; name?: string; message?: string; cause?: unknown };
  const parts = [err.name, err.type, err.message].filter((x) => x && x !== 'Error');
  return parts.join(': ') || String(e);
}

/** Map a pre-inclusion RPC error onto a stable code (ReceiverMismatch, DepositWithFunctionCall, …). */
function rpcErrorCode(text: string): string {
  for (const k of ['ReceiverMismatch', 'DepositWithFunctionCall', 'MethodNameMismatch', 'RequiresFullAccess', 'NotEnoughAllowance', 'AccessKeyNotFound', 'InvalidNonce', 'NotEnoughBalance']) {
    if (text.includes(k)) return k;
  }
  return errCode(text, 'RPC_ERROR');
}

export class NearRedteam implements RedteamContract {
  readonly mock = false;
  readonly contractId = config.redteamContract;
  readonly accountId: string;
  private readonly account: Account;
  private verified = false;

  constructor(private readonly keys: RuntimeKeys) {
    this.accountId = keys.accountId;
    this.account = new Account(keys.accountId, provider(), KeyPairSigner.fromSecretKey(keys.fc.private_key as KeyPairString));
  }

  /** FAIL CLOSED before the first signature: the key must be a FC key scoped to redteam on chain. */
  async verifyKeyScope(): Promise<void> {
    if (this.verified) return;
    const ak = await provider().viewAccessKey({ accountId: this.accountId, publicKey: this.keys.fc.public_key, finalityQuery: { finality: 'final' } });
    assertFunctionCallOnly(this.accountId, (ak as { permission: unknown }).permission, this.contractId);
    this.verified = true;
  }

  private async send<T>(receiverId: string, act: ReturnType<typeof actions.functionCall>[], opts: { submit?: boolean } = {}): Promise<TxOutcome<T>> {
    await this.verifyKeyScope();
    let res: RpcTx;
    try {
      res = await this.account.signAndSendTransaction({
        receiverId,
        actions: act,
        waitUntil: opts.submit ? 'INCLUDED_FINAL' : 'EXECUTED_OPTIMISTIC',
        throwOnFailure: false,
      });
    } catch (e) {
      const text = rpcErrorText(e);
      const hash = (e as { context?: { transactionHash?: string } }).context?.transactionHash ?? null;
      throw new ChainError(text, rpcErrorCode(text), hash ? 'execution' : 'rpc', hash);
    }
    const txHash = res.transaction.hash as string;
    if (opts.submit) res = await this.waitFirstReceipt(txHash, res);
    await noteTxHeight(res);
    const fail = failureMessage(res);
    const logs = (res.receipts_outcome ?? []).flatMap((r) => r.outcome.logs);
    if (fail) throw new ChainError(fail, errCode(fail, 'EXECUTION_FAILED'), 'execution', txHash);
    const st = res.status as { SuccessValue?: string };
    let value = decodeSuccess(st?.SuccessValue);
    if (value === undefined) {
      const first = res.receipts_outcome?.[0]?.outcome.status as { SuccessValue?: string } | undefined;
      value = decodeSuccess(first?.SuccessValue);
    }
    return { value: value as T, txHash, logs, mock: false };
  }

  /**
   * submit_finding kicks off an OutLayer yield/resume that can take a while; we only wait until the
   * redteam receipt itself executed (panic or finding id), then agents poll get_finding for the verdict.
   */
  private async waitFirstReceipt(txHash: string, res: RpcTx): Promise<RpcTx> {
    const deadline = Date.now() + 90_000;
    let cur = res;
    for (;;) {
      const firstId = cur.transaction_outcome?.outcome.receipt_ids?.[0];
      const first = cur.receipts_outcome?.find((r) => r.id === firstId);
      if (first && first.outcome.status !== 'Unknown') return cur;
      if (Date.now() > deadline) return cur;
      await new Promise((r) => setTimeout(r, 1500));
      cur = (await provider().viewTransactionStatus({ txHash, accountId: this.accountId, waitUntil: 'INCLUDED_FINAL' })) as RpcTx;
    }
  }

  private call<T = void>(method: string, args: Record<string, unknown>, gas = GAS) {
    return this.send<T>(this.contractId, [actions.functionCall(method, args, gas, 0n)]);
  }

  private async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    for (let i = 0; ; i++) {
      const r = await provider().callFunctionRaw({ contractId: this.contractId, method, args, blockQuery: { finality: 'optimistic' } });
      if (r.block_height >= minViewHeight || i >= 10) {
        const s = Buffer.from(r.result).toString('utf8');
        return (s ? JSON.parse(s) : null) as T;
      }
      await new Promise((res) => setTimeout(res, 400)); // lagging node: retry until it has our last tx
    }
  }

  registerAgent(role: Agent['role'], x25519_pubkey: string, meta: string) {
    return this.call('register_agent', { role, x25519_pubkey, meta });
  }
  registerTarget(target_id: string, enc_target: string, categories: string[]) {
    return this.call('register_target', { target_id, enc_target, categories });
  }
  createJob(a: CreateJobArgs) {
    return this.call<number>('create_job', { ...a });
  }
  placeBid(job_id: number, price_per_finding: string, note: string) {
    return this.call('place_bid', { job_id, price_per_finding, note });
  }
  counterBid(job_id: number, bidder: string, price_per_finding: string) {
    return this.call('counter_bid', { job_id, bidder, price_per_finding });
  }
  acceptBid(job_id: number, bidder: string) {
    return this.call('accept_bid', { job_id, bidder });
  }
  createSubjob(a: CreateSubjobArgs) {
    return this.call<number>('create_subjob', { ...a });
  }
  async submitFinding(job_id: number, enc_payload: string, category?: string): Promise<TxOutcome<number | null>> {
    const args: Record<string, unknown> = { job_id, enc_payload };
    if (category !== undefined) args.category = category;
    const out = await this.send<unknown>(this.contractId, [actions.functionCall('submit_finding', args, GAS_SUBMIT, 0n)], { submit: true });
    const fromLog = out.logs.map((l) => l.match(/"finding_id"\s*:\s*(\d+)/)?.[1]).find(Boolean);
    const id = typeof out.value === 'number' ? out.value : fromLog ? Number(fromLog) : null;
    return { ...out, value: id };
  }
  expireJob(job_id: number) {
    return this.call('expire_job', { job_id });
  }
  withdrawCompute(amount: string) {
    return this.call<unknown>('withdraw_compute', { amount }, GAS_WITHDRAW);
  }
  withdraw(amount: string) {
    return this.call<boolean>('withdraw', { amount }, GAS_WITHDRAW);
  }

  getJob(job_id: number) { return this.view<Job | null>('get_job', { job_id }); }
  listJobs(from = 0, limit = 50) { return this.view<Job[]>('list_jobs', { from, limit }); }
  getFindings(job_id: number) { return this.view<Finding[]>('get_findings', { job_id }); }
  getFinding(finding_id: number) { return this.view<Finding | null>('get_finding', { finding_id }); }
  getBids(job_id: number) { return this.view<Bid[]>('get_bids', { job_id }); }
  getAgent(account_id: string) { return this.view<Agent | null>('get_agent', { account_id }); }
  listAgents(from = 0, limit = 50) { return this.view<Agent[]>('list_agents', { from, limit }); }
  getTarget(target_id: string) { return this.view<Target | null>('get_target', { target_id }); }
  checkCounterparty(account_id: string) { return this.view<Verdict>('check_counterparty', { account_id }); }
  balanceOf(account_id: string) { return this.view<Balance>('balance_of', { account_id }); }
  getConfig() { return this.view<ContractConfig>('get_config'); }
  getPolicyLog(from = 0, limit = 100) { return this.view<PolicyLogEntry[]>('get_policy_log', { from, limit }); }

  /** Attack scenario 1: try an arbitrary tx with the runtime key. Chain/RPC decides, not us. */
  async rawCall(c: RawCall): Promise<TxOutcome<unknown>> {
    let act;
    if (c.action === 'Transfer') act = actions.transfer(c.depositYocto ?? 1n);
    else if (c.action === 'AddKey') {
      act = actions.addFullAccessKey(KeyPair.fromRandom('ed25519').getPublicKey());
    } else act = actions.functionCall(c.method, c.args, GAS, c.depositYocto ?? 0n);
    return this.send<unknown>(c.receiverId || this.accountId, [act as ReturnType<typeof actions.functionCall>]);
  }
}

/** Spendable NEAR of an account (balance minus storage stake), for prepay preflights. */
export async function viewAccountLiquid(accountId: string): Promise<bigint> {
  const av = await provider().viewAccount({ accountId, blockQuery: { finality: 'optimistic' } });
  return BigInt(av.amount) - BigInt(av.storage_usage) * 10n ** 19n;
}
