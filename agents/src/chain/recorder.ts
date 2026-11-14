/**
 * Transparent wrapper around a RedteamContract: logs every state-changing call with its explorer link
 * and keeps a receipt list (written to fixtures/*-receipts.json for rt-web / judges).
 */
import { log } from '../util/log.js';
import { ChainError, type RedteamContract, type TxOutcome } from './contract.js';

export interface Receipt {
  name: string;
  agent: string;
  signer: string;
  method: string;
  args_summary: string;
  tx_hash: string | null;
  ok: boolean;
  error: string | null;
  stage?: 'rpc' | 'execution';
  mock: boolean;
}

const WRITE_METHODS: Record<string, string> = {
  registerAgent: 'register_agent', registerTarget: 'register_target', createJob: 'create_job',
  placeBid: 'place_bid', counterBid: 'counter_bid', acceptBid: 'accept_bid', createSubjob: 'create_subjob',
  submitFinding: 'submit_finding', expireJob: 'expire_job', withdraw: 'withdraw', withdrawCompute: 'withdraw_compute', rawCall: 'raw',
};

export function summarizeArgs(method: string, args: unknown[]): string {
  const s = args.map((a) => {
    if (typeof a === 'string' && a.length > 48) return `"${a.slice(0, 16)}…(${a.length}b)"`;
    if (typeof a === 'object' && a) {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) o[k] = typeof v === 'string' && v.length > 48 ? `${v.slice(0, 16)}…(${v.length}b)` : typeof v === 'bigint' ? v.toString() : v;
      return JSON.stringify(o);
    }
    return JSON.stringify(a);
  });
  return `${method}(${s.join(', ')})`;
}

export class ReceiptBook {
  readonly receipts: Receipt[] = [];
  private seq = 0;
  next(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }
}

export function recorded(inner: RedteamContract, agent: string, book: ReceiptBook): RedteamContract {
  return new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof prop !== 'string' || typeof v !== 'function' || !(prop in WRITE_METHODS)) {
        return typeof v === 'function' ? v.bind(target) : v;
      }
      return async (...args: unknown[]) => {
        const rc = args[0] as { receiverId: string; action?: string; method: string };
        const method = prop === 'rawCall' ? `${rc.receiverId || target.accountId}::${rc.action ?? rc.method}` : WRITE_METHODS[prop];
        const base = { name: book.next(agent), agent, signer: target.accountId, method, args_summary: summarizeArgs(method, prop === 'rawCall' ? [(args[0] as { args: unknown }).args] : args), mock: target.mock };
        try {
          const out = (await (v as (...a: unknown[]) => Promise<TxOutcome<unknown>>).apply(target, args)) as TxOutcome<unknown>;
          book.receipts.push({ ...base, tx_hash: out.txHash, ok: true, error: null });
          log.tx(method, out.txHash, out.mock);
          return out;
        } catch (e) {
          const ce = e instanceof ChainError ? e : new ChainError(String((e as Error).message ?? e), 'UNKNOWN', 'rpc');
          book.receipts.push({ ...base, tx_hash: ce.txHash, ok: false, error: ce.message, stage: ce.stage });
          log.rejected(method, ce.message, ce.txHash, ce.stage, target.mock);
          throw ce;
        }
      };
    },
  });
}
