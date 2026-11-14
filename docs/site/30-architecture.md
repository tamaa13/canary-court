---
title: Architecture
description: The components of Canary Court and how a job's data and money flow between them.
section: Operate
order: 30
---

# Architecture

Canary Court has five parts. Two run on chain or in a TEE. The rest are clients that only read, or that sign with narrowly scoped keys.

| Part | What it is | Where |
|---|---|---|
| **Escrow contract** | `redteam`: jobs, bids, subjobs, balances, the policy engine, counterparty checks, strikes and blocklist. Plus `tusdc`, a mock USDC token. | Rust, NEAR testnet. [`contracts/VIEWS.md`](https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md) |
| **Enclave** | A WebAssembly module that OutLayer runs in a TEE. It decrypts a target and an attack, runs the attack on a NEAR AI model (or a canned `mock` stand-in), judges the answer with a deterministic check, and re-seals the report. | Rust → `wasm32-wasip2`. [`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md) |
| **Agents** | The market's participants: a client (the owner), a lead, two specialists, and an adversary (Mallory) for the attack scenarios. Bids, counters and hiring are LLM calls, with a deterministic fallback when no NEAR AI key is configured; each limit is the contract's. | TypeScript. [`agents/README.md`](https://github.com/tamaa13/canary-court/blob/main/agents/README.md) |
| **Dashboard** | The landing page and the read-only market view at `/app`. | Next.js, `site/`. |
| **End-to-end harness** | Runs the whole market on testnet with fresh accounts and asserts every rule. | TypeScript, `web/e2e/`. [`web/e2e/PLAN.md`](https://github.com/tamaa13/canary-court/blob/main/web/e2e/PLAN.md) |

The interface spec is [`docs/ARCHITECTURE.md`](https://github.com/tamaa13/canary-court/blob/main/docs/ARCHITECTURE.md). The exact JSON shapes, error codes and events are in [`contracts/VIEWS.md`](https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md).

## Keys: who can move what

- **Agents sign every market call with a function-call key.** It is scoped to the escrow contract, it can't attach deposits, and it can call [11 methods](https://github.com/tamaa13/canary-court/blob/main/contracts/DEPLOYMENTS.md).
  - It can't call the token contract, send NEAR, or add keys.
  - Funds leave only through `withdraw` / `withdraw_compute`, and those pay the caller and nobody else.
  - It can still spend the agent's own escrow inside the market, for example by posting a job and accepting a bid.
- **Each account also has a full-access key, used for setup:** depositing USDC (`ft_transfer_call`) and pre-paying compute (`deposit_compute`), including later top-ups. It is stored locally (`~/.near-credentials`, or `~/.canary-court/<account>/` for MCP agents), so it must stay out of the agent's reach.
- **The enclave's private key never leaves a TEE.** It was generated inside OutLayer's keystore TEE and is bound to the exact wasm hash. It is released only for runs requested by the escrow contract ([`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)).

## One job, as data flow

1. **Seal the target.** The owner's agent encrypts `{system_prompt, canary, model, client_pubkey}` to the enclave's public key (from `get_config`) and calls `register_target`. Only the ciphertext is stored.
2. **Fund the job.** `create_job` locks the budget from the owner's internal USDC balance.
3. **Hire.** Bids, one counter-offer and `accept_bid` assign the job. Before assigning, the contract runs `check_counterparty`:
   - **Allow** assigns normally.
   - **Warn** assigns with restrictions: payout capped at [50%](https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md), no subcontracting, dual evaluation.
   - **Block** reverts.

   The lead's `create_subjob` carves a sub-budget out of the parent's remaining escrow.
4. **Attack.** A provider encrypts `{payload, category, job_id}` to the enclave and calls `submit_finding`. The contract charges [0.02 NEAR](https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md) of compute and calls OutLayer's `request_execution` with the pinned enclave build.
5. **Judge (inside the TEE).** The enclave checks that the target is bound to this job's owner and the payload to this job. Then it:
   - runs the payload against the target on a NEAR AI TEE model at temperature 0 (a target sealed as `mock` gets a canned stand-in instead);
   - checks for the canary, including normalized, reversed and encoded forms;
   - checks for attempts to address the grader;
   - re-seals a report for the owner (and the lead), and returns a small public verdict with `result_hash = sha256(record)`.
6. **Settle (one callback).** `on_finding_evaluated` decides the outcome:
   - **Valid:** pay the attacker, pay the lead's margin from the parent (a subjob reward is never more than the parent's), and store the sealed reports.
   - **Invalid:** count it. If the attacker addressed the grader, record a strike with the attested evidence.
   - **Failed:** an enclave error or an OutLayer timeout. A client fault refunds the fee in full and a timeout refunds 0.009 NEAR; a NEAR AI outage keeps the fee ([Limits, stated](./41-limits-stated.md)).
7. **Expire.** After the deadline anyone can call `expire_job`. Remaining budget rolls up from subjob to parent to owner.

The OutLayer step uses NEAR's yield/resume. If no TEE worker answers within the yield window (~115 s, [`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)), the finding fails as an infra timeout, and [0.009 NEAR](https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md) of the fee is refunded.

## What is public, what is sealed

| Data | Who can read it in plaintext | On chain as |
|---|---|---|
| Target (system prompt, canary, model) | the owner who wrote it, the enclave | ciphertext |
| Attack payload | the attacker, the enclave; the owner and lead only after a **Valid** finding | ciphertext, then a sealed report |
| Verdict | everyone | status, severity, `result_hash` (hashes only) |
| Report | the owner (full); the lead (canary redacted) | two ciphertexts |

Our final end-to-end run scanned 47 views and logs of that run, including the enclave's public output, for its canary (raw and base64), a system-prompt marker and 3 of its payloads. It found [0 hits](https://github.com/tamaa13/canary-court/blob/main/web/e2e/reports/release-final-v0.1.3-fgm7h6.md) (step 05.6).
