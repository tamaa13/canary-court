/** Shared attack routine for the lead and sub-agents: plan payloads by LLM, encrypt to the enclave, submit. */
import { encryptJson, sha256Hex } from '../crypto/ecies.js';
import type { Finding, Job } from '../chain/types.js';
import { CLIENT_FAULT_ERRORS } from '../chain/mock-contract.js';
import { profile, type TargetKind } from '../target/index.js';
import { classic, libraryPlan, PAYLOAD_SYSTEM, payloadUserPrompt, playbook, validatePlan, type PayloadPlan } from './payloads.js';
import { BaseAgent } from './base.js';

export interface Submitted {
  findingId: number;
  category: string;
  technique: string;
  /** Sealed payload + target job, kept so an OutLayer infra timeout can be resubmitted once (binding is to job_id). */
  jobId?: number;
  enc?: string;
}

/** OutLayer never ran the module (queue > NEAR's 200-block yield timeout): infra, not a verdict. */
const isInfraTimeout = (f: Finding) => f.status === 'Failed' && /^outlayer: run failed or produced no output/.test(f.error ?? '');

export abstract class AttackerAgent extends BaseAgent {
  protected abstract readonly seed: number;

  /**
   * ≤2 payloads per agent per target (lean): one proven playbook exploit for the first assigned category
   * + one novel payload (LLM-written live; a classic library technique under the mock policy).
   */
  async planPayloads(categories: string[], targetDescription?: string, kind?: TargetKind): Promise<PayloadPlan> {
    targetDescription ??= profile(kind).descriptions.v1;
    const book = playbook(categories[0], kind);
    const novel = await this.generate(categories, 1, targetDescription, kind);
    return { payloads: [...(book ? [{ ...book, technique: `playbook: ${book.technique}` }] : []), ...novel.payloads.slice(0, 1)], rationale: novel.rationale };
  }

  private generate(categories: string[], n: number, targetDescription: string, kind?: TargetKind): Promise<PayloadPlan> {
    return this.decide<PayloadPlan>({
      task: 'generate_payloads',
      system: PAYLOAD_SYSTEM,
      user: payloadUserPrompt(categories, n, targetDescription),
      fallback: () => {
        const c = classic(categories, kind);
        return c ? { payloads: [c], rationale: `classic technique: ${c.technique}` } : libraryPlan(categories, 1, this.seed, kind);
      },
      validate: validatePlan(categories, n),
      maxTokens: 260 * n,
      sensitive: true,
    });
  }

  /** Plaintext of everything this agent submitted (kept locally; used by the demo's privacy scan). */
  readonly submittedPayloads: string[] = [];
  /** Finding ids that hit an OutLayer infra timeout and were resubmitted. */
  readonly resubmits: number[] = [];
  /** Every finding id this agent submitted (incl. resubmissions) and every infra timeout it saw. */
  readonly submittedIds: number[] = [];
  readonly infraTimeouts: number[] = [];
  /** Ciphertexts this agent put on chain (public in submit_finding tx args) — what a replay attacker can copy. */
  readonly sealed: { jobId: number; enc: string }[] = [];

  /** Encrypt each payload to the enclave pubkey and submit_finding. Plaintext never leaves this process. */
  async attack(job: Job, enclavePubkey: string, categories: string[], targetDescription?: string, kind?: TargetKind): Promise<Submitted[]> {
    const plan = await this.planPayloads(categories, targetDescription, kind);
    const out: Submitted[] = [];
    for (const p of plan.payloads) {
      const enc = encryptJson(enclavePubkey, { payload: p.payload, category: p.category, job_id: job.id }); // binding (v0.1.2)
      this.sealed.push({ jobId: job.id, enc });
      this.submittedPayloads.push(p.payload);
      this.say(`submit_finding job #${job.id} [${p.category} · ${p.technique}] payload sha256:${sha256Hex(p.payload).slice(0, 12)} ECIES→enclave (${enc.length} b64 chars, fee 0.02 NEAR)`);
      const before = new Set((await this.chain.getFindings(job.id)).map((f) => f.id));
      const { value } = await this.chain.submitFinding(job.id, enc, p.category);
      const id = value ?? (await this.chain.getFindings(job.id)).filter((f) => f.attacker === this.id && !before.has(f.id)).map((f) => f.id).sort((a, b) => b - a)[0];
      if (id === undefined) throw new Error('submit_finding: could not determine finding id');
      out.push({ findingId: id, category: p.category, technique: p.technique, jobId: job.id, enc });
      this.submittedIds.push(id);
    }
    return out;
  }

  async collectVerdicts(subs: Submitted[]): Promise<Finding[]> {
    const res: Finding[] = [];
    for (const s of subs) {
      let f = await this.awaitVerdict(s.findingId);
      if (isInfraTimeout(f)) this.infraTimeouts.push(f.id);
      if (isInfraTimeout(f) && s.enc !== undefined && s.jobId !== undefined) {
        // rt-enclave: testnet OutLayer has 2 shared executors; a queued request can miss the 200-block yield window.
        // A Failed finding has no dedup_key/result_hash, so resubmitting the same sealed payload once is not a duplicate.
        this.say(`finding #${f.id} [${s.category}] infra timeout (OutLayer queue, module never ran; 0.009 NEAR refunded): resubmitting the same sealed payload once`);
        this.resubmits.push(f.id);
        const { value } = await this.chain.submitFinding(s.jobId, s.enc, s.category);
        if (value !== null) {
          this.submittedIds.push(value);
          f = await this.awaitVerdict(value);
          if (isInfraTimeout(f)) this.infraTimeouts.push(f.id);
        }
      }
      const pay = f.status !== 'Valid' ? ''
        : f.unpaid ? ' → unpaid (duplicate of an earlier finding in this job tree, or budget exhausted)'
          : ` → paid ${Number(BigInt(f.paid_attacker)) / 1e6} tUSDC${BigInt(f.paid_lead) > 0n ? ` (+${Number(BigInt(f.paid_lead)) / 1e6} to lead)` : ''}`;
      const code = (f.error ?? '').replace(/^enclave: /, '');
      const err = f.status !== 'Failed' ? ''
        : isInfraTimeout(f) ? ' (infra timeout: OutLayer queue; fee − max OutLayer charge refunded (0.009 NEAR), no strike)'
          : ` (${f.error ?? 'error'}${CLIENT_FAULT_ERRORS.includes(code) ? ': client fault, fee refunded' : ': fee kept, no strike'})`;
      this.say(`finding #${f.id} [${s.category}] ${f.status}${f.severity && f.severity !== 'none' ? ` (${f.severity})` : ''}${f.manipulation ? ' MANIPULATION' : ''}${pay}${err}`);
      res.push(f);
    }
    return res;
  }
}
