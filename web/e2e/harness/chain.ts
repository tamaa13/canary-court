// Chain abstraction for the e2e harness: one interface, two backends.
//   mock    — in-process MockNet (virtual clock; instant), validates harness logic offline
//   testnet — real NEAR testnet via near-api-js (signing) + raw JSON-RPC (views, tx status)
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MockNet, type KeyKind } from '../../lib/mock-net';
import { Rpc, TESTNET_RPCS, TESTNET_ARCHIVAL_RPCS, parseTxResponse, txUrl, type RawTxResponse, type BlockRef } from '../../lib/rpc';
import { errCode, AGENT_FC_METHODS } from '../../lib/types';

export interface Signer {
  accountId: string;
  key: KeyKind; // 'fc' = function-call key scoped to redteam (agent runtime); 'full' = setup only
}

export interface Tx {
  label?: string;
  hash: string | null;
  ok: boolean;
  value: unknown;
  error: string | null;
  code: string | null;
  logs: string[];
  signer: string;
  receiver: string;
  method: string;
}

export interface TxOutcomeLite {
  ok: boolean;
  error: string | null;
  logs: string[];
  receipts: { executor: string; logs: string[]; value: unknown }[];
}

export interface CallOpts {
  receiver?: string; // default: redteam contract
  deposit?: bigint;
  gas?: bigint;
}

export interface Chain {
  kind: 'mock' | 'testnet';
  root: string;
  contractId: string;
  tokenId: string;
  view<T>(method: string, args?: object, opts?: { contract?: string; height?: number }): Promise<T>;
  call(signer: Signer, method: string, args?: object, opts?: CallOpts): Promise<Tx>;
  /** final=true → last final block (use its height to pin consistent multi-view snapshots). */
  head(final?: boolean): Promise<{ height: number; timeMs: number }>;
  sleep(ms: number): Promise<void>;
  createAccount(newId: string, initialNear: bigint): Promise<Tx>;
  addFcKey(accountId: string, allowance: bigint): Promise<Tx>;
  deleteAccount(accountId: string, beneficiary: string): Promise<Tx>;
  accountExists(id: string): Promise<boolean>;
  accessKeys(id: string): Promise<{ public_key: string; access_key: { permission: unknown } }[]>;
  txOutcome(hash: string, sender: string): Promise<TxOutcomeLite>;
  txLink(hash: string | null): string | null;
}

// ------------------------------------------------------------------ mock
export class MockChain implements Chain {
  kind = 'mock' as const;
  readonly net: MockNet;
  constructor(net = new MockNet()) {
    this.net = net;
  }
  get root() {
    return this.net.root;
  }
  get contractId() {
    return this.net.contractId;
  }
  get tokenId() {
    return this.net.tokenId;
  }
  async view<T>(method: string, args: object = {}, opts: { contract?: string } = {}): Promise<T> {
    return this.net.view(opts.contract ?? this.contractId, method, args as Record<string, unknown>) as T;
  }
  async call(signer: Signer, method: string, args: object = {}, opts: CallOpts = {}): Promise<Tx> {
    const r = this.net.call(signer, opts.receiver ?? this.contractId, method, args as Record<string, unknown>, opts.deposit ?? 0n);
    return { hash: r.hash, ok: r.ok, value: r.value, error: r.error, code: errCode(r.error), logs: r.logs, signer: r.signer, receiver: r.receiver, method };
  }
  async head() {
    return { height: this.net.height(), timeMs: this.net.now() };
  }
  async sleep(ms: number) {
    this.net.advance(ms);
  }
  private wrap(r: ReturnType<MockNet['createAccount']>): Tx {
    return { hash: r.hash, ok: r.ok, value: r.value, error: r.error, code: errCode(r.error), logs: r.logs, signer: r.signer, receiver: r.receiver, method: r.method };
  }
  async createAccount(newId: string, initialNear: bigint) {
    return this.wrap(this.net.createAccount(this.root, newId, initialNear));
  }
  async addFcKey(accountId: string) {
    return this.wrap(this.net.addFcKey(accountId, this.contractId, AGENT_FC_METHODS));
  }
  async deleteAccount(accountId: string, beneficiary: string) {
    return this.wrap(this.net.deleteAccount(accountId, beneficiary));
  }
  async accountExists(id: string) {
    return this.net.accountExists(id);
  }
  async accessKeys(id: string) {
    return this.net.accessKeys(id);
  }
  async txOutcome(hash: string) {
    const r = this.net.tx(hash);
    if (!r) throw new Error(`unknown tx ${hash}`);
    return { ok: r.ok, error: r.error, logs: r.logs, receipts: [] };
  }
  txLink() {
    return null; // mock hashes are not on chain
  }
  /** mock-only: force the next evaluation of this finding to come back null (OutLayer timeout) */
  failEvaluation(findingId: number) {
    this.net.failEvaluation(findingId);
  }
}

// ------------------------------------------------------------------ testnet
interface KeyFile {
  account_id: string;
  full?: string; // ed25519:... (setup only)
  fc?: string; // ed25519:... scoped to redteam
}

// NEAR reserves prepaid gas at a pessimistic price (~10× the current one), so 300 TGas locks ~0.3 NEAR of balance
// and of FC-key allowance until refunded. Only submit_finding needs 300 TGas (VIEWS.md: ERR_GAS otherwise).
const GAS: Record<string, bigint> = { submit_finding: 300n * 1_000_000_000_000n, ft_transfer_call: 100n * 1_000_000_000_000n, withdraw: 100n * 1_000_000_000_000n };
const DEFAULT_GAS = 50n * 1_000_000_000_000n;

export class TestnetChain implements Chain {
  kind = 'testnet' as const;
  readonly rpc: Rpc;
  readonly archival: Rpc;
  private nearApi!: typeof import('near-api-js');
  private provider!: InstanceType<(typeof import('near-api-js'))['JsonRpcProvider']>;
  private providers: InstanceType<(typeof import('near-api-js'))['JsonRpcProvider']>[] = [];
  private providerIdx = 0;
  private accounts = new Map<string, InstanceType<(typeof import('near-api-js'))['Account']>>();
  /** read-your-writes: views wait until the RPC node has reached the last block our txs touched */
  private minHeight = 0;
  private heightOfHash = new Map<string, number>();

  constructor(
    public root: string,
    public contractId: string,
    public tokenId: string,
    private keysDir: string,
    rpcUrls = TESTNET_RPCS,
  ) {
    this.rpc = new Rpc(rpcUrls, 30_000);
    this.archival = new Rpc([...rpcUrls, ...TESTNET_ARCHIVAL_RPCS], 30_000);
    mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  }

  async init() {
    this.nearApi = await import('near-api-js');
    // One plain JsonRpcProvider per endpoint, rotated on 429/transport errors in send(). (FailoverRpcProvider wrapped
    // tx-validation errors such as InvalidAccessKeyError into "RetriesExceeded", which hid the very rejections we assert.)
    this.providers = this.rpc.urls.map((url) => new this.nearApi.JsonRpcProvider({ url }));
    this.provider = this.providers[0];
  }

  private keyPath(id: string) {
    return join(this.keysDir, `${id}.json`);
  }
  private readKeys(id: string): KeyFile {
    if (id === this.root) {
      const p = join(homedir(), '.near-credentials', 'testnet', `${id}.json`);
      const j = JSON.parse(readFileSync(p, 'utf8'));
      return { account_id: id, full: j.private_key ?? j.secret_key };
    }
    const p = this.keyPath(id);
    if (!existsSync(p)) throw new Error(`no keys for ${id} in ${this.keysDir}`);
    return JSON.parse(readFileSync(p, 'utf8'));
  }
  private writeKeys(k: KeyFile) {
    writeFileSync(this.keyPath(k.account_id), JSON.stringify(k, null, 2), { mode: 0o600 });
  }
  private account(s: Signer) {
    const cacheKey = `${s.accountId}#${s.key}`;
    let acc = this.accounts.get(cacheKey);
    if (!acc) {
      const keys = this.readKeys(s.accountId);
      const sk = s.key === 'fc' ? keys.fc : keys.full;
      if (!sk) throw new Error(`no ${s.key} key for ${s.accountId}`);
      acc = new this.nearApi.Account(s.accountId, this.provider, sk as `ed25519:${string}`);
      this.accounts.set(cacheKey, acc);
    }
    return acc;
  }

  private async send(s: Signer, receiverId: string, actions: unknown[], method: string): Promise<Tx> {
    const base = { signer: s.accountId, receiver: receiverId, method };
    for (let attempt = 0; ; attempt++) {
      try {
        const res = (await this.account(s).signAndSendTransaction({
          receiverId,
          actions: actions as never,
          waitUntil: 'EXECUTED_OPTIMISTIC',
          throwOnFailure: false,
        })) as unknown as RawTxResponse;
        const o = parseTxResponse(res);
        await this.trackHeights(res);
        return { ...base, hash: o.hash, ok: o.ok, value: o.value, error: o.error, code: errCode(o.error), logs: o.logs };
      } catch (e) {
        const msg = errorText(e);
        // transient transport errors: retry; validation errors (no inclusion): report with hash=null
        if (attempt < 5 && /timeout|ECONNRESET|fetch failed|429|503|InvalidNonce|Too Many Requests|RetriesExceeded/i.test(msg)) {
          // rotate to the next endpoint (fresh Account objects bind to the provider)
          this.providerIdx = (this.providerIdx + 1) % this.providers.length;
          this.provider = this.providers[this.providerIdx];
          this.accounts.clear();
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        return { ...base, hash: null, ok: false, value: null, error: msg, code: errCode(msg), logs: [] };
      }
    }
  }

  async call(s: Signer, method: string, args: object = {}, opts: CallOpts = {}): Promise<Tx> {
    const gas = opts.gas ?? GAS[method] ?? DEFAULT_GAS;
    const action = this.nearApi.actions.functionCall(method, args, gas, opts.deposit ?? 0n);
    return this.send(s, opts.receiver ?? this.contractId, [action], method);
  }

  async view<T>(method: string, args: object = {}, opts: { contract?: string; height?: number } = {}): Promise<T> {
    const ref: BlockRef = opts.height ? { block_id: opts.height } : { finality: 'optimistic' };
    for (let i = 0; ; i++) {
      const r = await this.rpc.view<T>(opts.contract ?? this.contractId, method, args, ref);
      if (opts.height || r.height >= this.minHeight || i >= 30) return r.value;
      await new Promise((ok) => setTimeout(ok, 400));
    }
  }

  private async trackHeights(res: RawTxResponse) {
    const hashes = [...new Set(res.receipts_outcome.map((o) => o.block_hash).filter((h): h is string => !!h))];
    for (const h of hashes) {
      let height = this.heightOfHash.get(h);
      if (height === undefined) {
        try {
          height = (await this.rpc.block({ block_id: h })).height;
          this.heightOfHash.set(h, height);
        } catch {
          continue;
        }
      }
      this.minHeight = Math.max(this.minHeight, height);
    }
  }

  async head(final = false) {
    const b = await this.rpc.block({ finality: final ? 'final' : 'optimistic' });
    return { height: b.height, timeMs: b.timeMs };
  }

  async sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async createAccount(newId: string, initialNear: bigint): Promise<Tx> {
    const { KeyPair, actions } = this.nearApi;
    const full = KeyPair.fromRandom('ed25519');
    this.writeKeys({ account_id: newId, full: full.toString() });
    return this.send(
      { accountId: this.root, key: 'full' },
      newId,
      [actions.createAccount(), actions.transfer(initialNear), actions.addFullAccessKey(full.getPublicKey())],
      'CreateAccount',
    );
  }

  async addFcKey(accountId: string, allowance: bigint): Promise<Tx> {
    const { KeyPair, actions } = this.nearApi;
    const fc = KeyPair.fromRandom('ed25519');
    const keys = this.readKeys(accountId);
    this.writeKeys({ ...keys, fc: fc.toString() });
    return this.send({ accountId, key: 'full' }, accountId, [actions.addFunctionCallAccessKey(fc.getPublicKey(), this.contractId, AGENT_FC_METHODS, allowance)], 'AddKey');
  }

  async deleteAccount(accountId: string, beneficiary: string): Promise<Tx> {
    const tx = await this.send({ accountId, key: 'full' }, accountId, [this.nearApi.actions.deleteAccount(beneficiary)], 'DeleteAccount');
    if (tx.ok) rmSync(this.keyPath(accountId), { force: true }); // keys of a deleted account are dead weight
    return tx;
  }

  async accountExists(id: string) {
    try {
      await this.rpc.viewAccount(id, { finality: 'optimistic' });
      return true;
    } catch {
      return false;
    }
  }

  async accessKeys(id: string) {
    return this.rpc.accessKeys(id);
  }

  async txOutcome(hash: string, sender: string) {
    const o = await this.archival.txOutcome(hash, sender);
    return { ok: o.ok, error: o.error, logs: o.logs, receipts: o.receipts };
  }

  txLink(hash: string | null) {
    return hash ? txUrl(hash) : null;
  }
}

function errorText(e: unknown): string {
  if (!e) return 'unknown error';
  const anyE = e as { message?: string; type?: string; cause?: unknown; data?: unknown };
  const parts = [anyE.type, anyE.message, anyE.data ? JSON.stringify(anyE.data) : null].filter(Boolean);
  return parts.join(': ') || String(e);
}
