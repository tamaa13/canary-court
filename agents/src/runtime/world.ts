/**
 * Wires agents to either the in-memory chain (dry-run: no keys, no funds, no network) or NEAR testnet
 * (runtime FC keys from agents/.keys only).
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '@noble/hashes/sha2.js';
import { config, type AgentName } from '../config.js';
import { x25519PublicHex } from '../crypto/ecies.js';
import { loadRuntimeKeys } from '../crypto/keys.js';
import type { RedteamContract } from '../chain/contract.js';
import { MockChain } from '../chain/mock-contract.js';
import { NearRedteam } from '../chain/near-contract.js';
import { ReceiptBook, recorded } from '../chain/recorder.js';
import { makeLlm, RecordingLlm, type Llm } from '../llm/llm.js';
import { NEAR, USDC } from '../util/amount.js';
import type { AgentCtx } from '../agents/base.js';
import { ClientAgent } from '../agents/client.js';
import { LeadAgent, SPECIALTIES } from '../agents/lead.js';
import { SubAgent } from '../agents/sub.js';

interface WorldOpts {
  dryRun: boolean;
  record?: boolean;
  /** dry-run: replay LLM decisions recorded from a live run. */
  replay?: string;
  /** live: force the deterministic policy (no NEAR AI spend). */
  mockLlm?: boolean;
}

export class World {
  readonly mode: 'dry-run' | 'testnet';
  readonly book = new ReceiptBook();
  readonly llm: Llm;
  readonly chain?: MockChain;
  private contracts = new Map<string, RedteamContract>();
  private sks = new Map<string, Uint8Array>();

  constructor(readonly opts: WorldOpts) {
    this.mode = opts.dryRun ? 'dry-run' : 'testnet';
    const base = makeLlm({ dryRun: opts.dryRun, replayPath: opts.replay, mockLlm: opts.mockLlm });
    this.llm = opts.record ? new RecordingLlm(base) : base;
    if (opts.dryRun) this.chain = new MockChain();
  }

  get dryRun(): boolean {
    return this.mode === 'dry-run';
  }

  /** Account id for a logical agent; mallory may be a fresh `mallory<N>` account in live mode. */
  accountOf(name: AgentName | string): string {
    return (config.accounts as Record<string, string>)[name] ?? name;
  }

  contract(name: string, accountId = this.accountOf(name)): RedteamContract {
    const key = `${name}:${accountId}`;
    let c = this.contracts.get(key);
    if (!c) {
      if (this.chain) {
        c = this.chain.as(accountId);
        // dry-run: deterministic per-agent x25519 key (no files, no FA keys anywhere)
        this.sks.set(accountId, sha256(new TextEncoder().encode(`near-redteam/dry-run/x25519/${accountId}`)));
      } else {
        const keys = loadRuntimeKeys(accountId);
        this.sks.set(accountId, keys.x25519Sk);
        c = new NearRedteam(keys);
      }
      c = recorded(c, name, this.book);
      this.contracts.set(key, c);
    }
    return c;
  }

  ctx(name: AgentName, accountId = this.accountOf(name)): AgentCtx {
    const contract = this.contract(name, accountId);
    const sk = this.sks.get(accountId)!;
    return { name, accountId, contract, llm: this.llm, x25519Sk: sk, x25519Pk: x25519PublicHex(sk), tick: () => this.tick() };
  }

  async tick(): Promise<void> {
    if (this.chain) await this.chain.settle();
    else await new Promise((r) => setTimeout(r, 5000)); // gentle on shared public RPC rate limits
  }


  /** Current chain time (mock clock can be advanced in dry-run). */
  now(): number {
    return this.chain ? this.chain.now() : Date.now();
  }

  /** Dry-run only: stand-in for `pnpm setup:testnet` (funding, compute deposits, aging accounts). */
  mockSetup(): void {
    if (!this.chain) return;
    this.chain.fundUsdc(config.accounts.client, USDC(300));
    this.chain.fundUsdc(config.accounts.copycat, USDC(30));
    for (const n of ['client', 'lead', 'sub1', 'sub2', 'mallory'] as const) this.chain.depositCompute(this.accountOf(n), NEAR('0.5'));
  }

  agents() {
    return {
      client: new ClientAgent(this.ctx('client')),
      lead: new LeadAgent(this.ctx('lead')),
      sub1: new SubAgent(this.ctx('sub1'), SPECIALTIES.sub1),
      sub2: new SubAgent(this.ctx('sub2'), SPECIALTIES.sub2),
    };
  }

  /** Live: mallory accounts provisioned by setup (agents/.keys/mallory*.fc.json). */
  malloryAccounts(): string[] {
    if (this.chain) return [config.accounts.mallory];
    if (!existsSync(config.keysDir)) return [];
    return readdirSync(config.keysDir)
      .filter((f) => /^mallory\d*\..*\.fc\.json$/.test(f))
      .map((f) => f.replace(/\.fc\.json$/, ''))
      .sort();
  }

  saveRecording(path: string, meta: Record<string, unknown>): void {
    if (this.llm instanceof RecordingLlm) this.llm.save(resolve(path), meta);
  }
}
