import type { AgentName } from '../config.js';
import type { RedteamContract } from '../chain/contract.js';
import type { Finding, Job } from '../chain/types.js';
import type { Decision, Llm } from '../llm/llm.js';
import { log } from '../util/log.js';
import { fmtUsdc } from '../util/amount.js';

export interface AgentCtx {
  name: AgentName;
  accountId: string;
  contract: RedteamContract;
  llm: Llm;
  x25519Sk: Uint8Array;
  x25519Pk: string;
  /** Resolves when in-flight evaluations settle (mock) or after a poll interval (live). */
  tick: () => Promise<void>;
}

export abstract class BaseAgent {
  constructor(protected readonly ctx: AgentCtx) {}

  get name(): AgentName {
    return this.ctx.name;
  }
  get id(): string {
    return this.ctx.accountId;
  }
  get chain(): RedteamContract {
    return this.ctx.contract;
  }

  say(msg: string): void {
    log.agent(this.name, msg);
  }

  /** One LLM decision with logged rationale and provenance (llm / mock / replay / fallback). */
  protected async decide<T extends { rationale?: string }>(d: Omit<Decision<T>, 'agent'>): Promise<T> {
    const r = await this.ctx.llm.decide({ ...d, agent: this.name });
    const why = d.sensitive ? '[rationale withheld: attack material]' : r.source === 'fallback' ? `${r.note ?? ''} → policy: ${r.value.rationale ?? ''}` : (r.value.rationale ?? r.note ?? '');
    log.think(`${d.task} via ${r.source}`, why);
    return r.value;
  }

  async register(role: 'client' | 'provider', meta: Record<string, unknown>): Promise<void> {
    const existing = await this.chain.getAgent(this.id);
    if (existing && existing.x25519_pubkey === this.ctx.x25519Pk && existing.role === role) {
      this.say(`already registered as ${role} (x25519 ${this.ctx.x25519Pk.slice(0, 12)}…)`);
      return;
    }
    this.say(`register_agent as ${role} with x25519 ${this.ctx.x25519Pk.slice(0, 12)}…`);
    try {
      await this.chain.registerAgent(role, this.ctx.x25519Pk, JSON.stringify(meta));
    } catch (e) {
      if (existing && /ERR_KEY_LOCKED/.test(String((e as Error).message))) {
        throw new Error(`${this.id}: on-chain x25519 key ${existing.x25519_pubkey.slice(0, 12)}… differs from the local key and is frozen while jobs are active (C2). Reports for those jobs are sealed to the old key; wait for the deadlines, then re-run.`);
      }
      throw e;
    }
  }

  /** Poll a finding until the enclave verdict lands (OutLayer callback). */
  async awaitVerdict(findingId: number, timeoutMs = 240_000): Promise<Finding> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const f = await this.chain.getFinding(findingId);
      if (f && f.status !== 'Pending') return f;
      if (Date.now() > end) throw new Error(`finding ${findingId} still Pending after ${timeoutMs / 1000}s`);
      await this.ctx.tick();
    }
  }

  /** Withdraw internal tUSDC above `keep` (the client keeps a working float in escrow for future jobs). */
  async withdrawAll(keep = 0n): Promise<bigint> {
    const b = BigInt((await this.chain.balanceOf(this.id)).usdc) - keep;
    if (b > 0n) {
      this.say(`withdraw ${fmtUsdc(b)} (internal balance → own wallet via contract ft_transfer${keep ? `, keeping ${fmtUsdc(keep)} float` : ''})`);
      const { value } = await this.chain.withdraw(b.toString());
      if (value === false) this.say('withdraw refunded by contract (token transfer failed; is the account registered on tusdc?)');
    }
    return b;
  }

  protected async listAll(): Promise<Job[]> {
    const all: Job[] = [];
    for (let from = 0; ; from += 50) {
      const page = await this.chain.listJobs(from, 50);
      all.push(...page);
      if (page.length < 50) break;
    }
    return all;
  }

  protected async openJobs(filter: (j: Job) => boolean): Promise<Job[]> {
    return (await this.listAll()).filter((j) => j.status === 'Open' && filter(j));
  }
}

export const big = (v: string | number | bigint) => BigInt(v);
