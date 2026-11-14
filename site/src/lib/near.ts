// Read-only NEAR JSON-RPC: contract views, blocks, tx outcomes. No keys, nothing to sign with.
// Ported from web/src/near/rpc.ts (rt-web) unchanged: one shared Limiter caps in-flight requests and imposes a jittered
// cooldown after a 429 (a browser sees it as a CORS failure), and calls fail over between endpoints.
// Works on the server (the landing's first paint) and in the browser (the live strip, the app).


// rpc.testnet.near.org is deprecated and rate-limited (-429); fastnear is the default.
// test.rpc.fastnear.com can rate-limit (429); the archival endpoint also serves current state, so it is the failover.
export const TESTNET_RPCS = ['https://test.rpc.fastnear.com', 'https://archival-rpc.testnet.fastnear.com'];
export const TESTNET_ARCHIVAL_RPCS = ['https://archival-rpc.testnet.fastnear.com'];
export const EXPLORER = 'https://testnet.nearblocks.io';

export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const accountUrl = (id: string) => `${EXPLORER}/address/${id}`;

export type BlockRef = { finality: 'final' | 'optimistic' } | { block_id: number | string };

export class RpcError extends Error {
  constructor(
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

/** Caps concurrent requests and imposes a shared cooldown after rate limiting (one browser IP shares the public
 *  RPC limit; a burst of independent retries only makes the 429s worse). */
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private pausedUntil = 0;
  private backoffMs = 0;
  constructor(public max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((ok) => this.queue.push(ok));
    this.active++;
    try {
      const wait = this.pausedUntil - Date.now();
      if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
  /** a request was rate-limited / failed in transport: everyone waits */
  penalize() {
    this.backoffMs = Math.min(15_000, this.backoffMs ? this.backoffMs * 2 : 1000);
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + this.backoffMs * (0.5 + Math.random()));
  }
  reward() {
    this.backoffMs = 0;
  }
}

const jitter = (ms: number) => ms * (0.5 + Math.random());

export class Rpc {
  constructor(
    public urls: string[] = TESTNET_RPCS,
    private timeoutMs = 15000,
    private limiter?: Limiter,
  ) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    let lastErr: unknown;
    // up to 4 rounds over all endpoints, backing off when every endpoint rate-limits (429) or fails transport
    const rounds = this.limiter ? 6 : 4;
    for (let round = 0; round < rounds; round++) {
      if (round && !this.limiter) await new Promise((ok) => setTimeout(ok, jitter(1000 * 2 ** (round - 1))));
      try {
        return await this.callOnce<T>(method, params);
      } catch (err) {
        if ((err as { deterministic?: boolean }).deterministic) throw err;
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new RpcError(String(lastErr));
  }

  private async callOnce<T>(method: string, params: unknown): Promise<T> {
    let lastErr: unknown;
    for (const url of this.urls) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        const doFetch = () =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 'rt', method, params }),
            signal: ctrl.signal,
          }).finally(() => clearTimeout(timer));
        // in a browser a 429 arrives without CORS headers, so it surfaces as a TypeError: treated as transient below
        let res: Response;
        try {
          res = await (this.limiter ? this.limiter.run(doFetch) : doFetch());
        } catch (e) {
          this.limiter?.penalize();
          throw e;
        }
        if (res.status === 429 || res.status >= 500) {
          this.limiter?.penalize();
          throw new RpcError(`HTTP ${res.status} from ${url}`);
        }
        this.limiter?.reward();
        const body = (await res.json()) as { result?: T; error?: { message?: string; data?: unknown; cause?: { name?: string; info?: unknown } } };
        if (body.error) {
          // Contract/handler errors are deterministic — don't fail over.
          const e = body.error;
          const msg = [e.cause?.name, typeof e.data === 'string' ? e.data : JSON.stringify(e.data ?? e.cause?.info ?? ''), e.message]
            .filter(Boolean)
            .join(': ');
          throw Object.assign(new RpcError(msg, e), { deterministic: true });
        }
        return body.result as T;
      } catch (err) {
        if ((err as { deterministic?: boolean }).deterministic) throw err;
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new RpcError(String(lastErr));
  }

  /** call_function view. Returns parsed JSON + the block height it was read at. */
  async view<T>(contractId: string, method: string, args: object = {}, ref: BlockRef = { finality: 'final' }): Promise<{ value: T; height: number }> {
    const r = await this.call<{ result?: number[]; error?: string; block_height: number; logs?: string[] }>('query', {
      request_type: 'call_function',
      account_id: contractId,
      method_name: method,
      args_base64: b64json(args),
      ...ref,
    });
    if (r.error) throw new RpcError(r.error);
    const text = new TextDecoder().decode(Uint8Array.from(r.result ?? []));
    return { value: (text ? JSON.parse(text) : null) as T, height: r.block_height };
  }

  async block(ref: BlockRef = { finality: 'final' }): Promise<{ height: number; timeMs: number; hash: string }> {
    const b = await this.call<{ header: { height: number; timestamp_nanosec: string; hash: string } }>('block', ref);
    return { height: b.header.height, timeMs: Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n), hash: b.header.hash };
  }

  async viewAccount(accountId: string, ref: BlockRef = { finality: 'final' }) {
    return this.call<{ amount: string; locked: string; storage_usage: number; code_hash: string }>('query', {
      request_type: 'view_account',
      account_id: accountId,
      ...ref,
    });
  }

  async accessKeys(accountId: string) {
    const r = await this.call<{ keys: { public_key: string; access_key: { nonce: number; permission: unknown } }[] }>('query', {
      request_type: 'view_access_key_list',
      account_id: accountId,
      finality: 'final',
    });
    return r.keys;
  }

  /** Final outcome of a tx: success flag + first failure message across all receipts. */
  async txOutcome(txHash: string, senderId: string): Promise<TxOutcome> {
    const r = await this.call<RawTxResponse>('EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: senderId, wait_until: 'EXECUTED' });
    return parseTxResponse(r);
  }
}

export interface TxOutcome {
  hash: string;
  ok: boolean;
  value: unknown;
  error: string | null;
  logs: string[];
  receiptIds: string[];
  /** failures of non-returned receipts (e.g. gas refund to a deleted account, a handled cross-contract failure) */
  innerErrors: string[];
  /** every receipt with its executor, logs and decoded SuccessValue (JSON when it parses) */
  receipts: { id: string; executor: string; logs: string[]; value: unknown; failure: string | null }[];
}

export interface RawTxResponse {
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction: { hash: string; signer_id: string; receiver_id: string };
  transaction_outcome: { id: string; outcome: { logs: string[]; status: unknown } };
  receipts_outcome: { id: string; block_hash?: string; outcome: { logs: string[]; status: { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown } | string; executor_id: string } }[];
}

export function parseTxResponse(r: RawTxResponse): TxOutcome {
  const logs = [...(r.transaction_outcome?.outcome.logs ?? []), ...r.receipts_outcome.flatMap((o) => o.outcome.logs)];
  const failures = r.receipts_outcome
    .map((o) => (typeof o.outcome.status === 'object' && o.outcome.status && 'Failure' in o.outcome.status ? o.outcome.status.Failure : null))
    .filter(Boolean);
  const top = typeof r.status === 'object' ? r.status : {};
  const topFailure = 'Failure' in top ? top.Failure : null;
  // The top-level status is authoritative: it follows the returned promise chain. Detached receipts may fail
  // without failing the call (gas refund to a just-deleted account, a cross-contract failure the callback handled).
  const failure = topFailure ?? null;
  const value: unknown = 'SuccessValue' in top && top.SuccessValue ? decodeValue(top.SuccessValue) : null;
  return {
    hash: r.transaction.hash,
    ok: !topFailure,
    value,
    error: failure ? failureMessage(failure) : null,
    logs,
    receiptIds: r.receipts_outcome.map((o) => o.id),
    innerErrors: failures.map(failureMessage),
    receipts: r.receipts_outcome.map((o) => {
      const st = typeof o.outcome.status === 'object' ? o.outcome.status : {};
      return {
        id: o.id,
        executor: o.outcome.executor_id,
        logs: o.outcome.logs,
        value: 'SuccessValue' in st && st.SuccessValue ? decodeValue(st.SuccessValue) : null,
        failure: 'Failure' in st && st.Failure ? failureMessage(st.Failure) : null,
      };
    }),
  };
}

function decodeValue(b64: string): unknown {
  const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Flattens nearcore's nested failure JSON into "Smart contract panicked: ERR_X: text" style text. */
export function failureMessage(f: unknown): string {
  const exec = findKey(f, 'ExecutionError');
  if (typeof exec === 'string') return exec;
  return JSON.stringify(f);
}

function findKey(o: unknown, key: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  if (key in (o as Record<string, unknown>)) return (o as Record<string, unknown>)[key];
  for (const v of Object.values(o as Record<string, unknown>)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

export function b64json(o: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ───────────────────────────────────────────── landing helpers

export type Counts = { agents: number; jobs: number; findings: number; policy_log: number };

/** the escrow's totals and the block they were read at (get_counts) */
export async function readCounts(rpc = new Rpc(), contract = "redteam.arifnovrian.testnet"): Promise<Counts & { block: number }> {
  const { value, height } = await rpc.view<Counts>(contract, "get_counts");
  return { ...value, block: height };
}
