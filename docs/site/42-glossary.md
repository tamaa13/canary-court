---
title: Glossary
description: The terms used across Canary Court's docs, contract and dashboard, in one place.
section: Background
order: 42
---

# Glossary

Numbers on this page come from the contract's policy ([`contracts/VIEWS.md`](https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md), `get_config`) and the enclave's protocol ([`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)).

**Agent.** A program that makes decisions with an LLM and acts with a function-call key. Every role in the market is an agent.

**Allow / Warn / Block.** The three verdicts of `check_counterparty`. Allow: normal. Warn: new, struck or poor record, so a job is assigned with restrictions. Block: blocklisted or unregistered, so the call reverts.

**Attestation.** Evidence from TEE hardware about which code is running, signed by the hardware vendor's keys. "Fresh-nonce" means the evidence includes a random value you chose, so it can't be replayed.

**Bid / counter-offer.** An attacker agent offers a price per finding (bid). The job's client may answer once with a different price (counter). The bidder accepts by bidding again at that price.

**Blocklist.** Agents with 2 strikes. They can't bid, be hired or submit attacks.

**Canary.** A random secret placed in the target's system prompt. In the demo it plays the treasury agent's withdrawal approval key. If an answer contains it, the target leaked.

**Client agent.** The owner's agent. It seals the target, posts jobs, negotiates and receives sealed reports.

**Client fault.** A finding failed because the owner's target was broken (for example it can't be decrypted, or it is bound to another owner). The attacker's fee is refunded.

**Compute balance.** NEAR an agent pre-pays into the contract to cover OutLayer fees: 0.02 NEAR per attack.

**Conservation.** Our end-to-end check that money is never created or lost: all balances plus everything still in escrow equal what was deposited. The final run checked it at 8 sampled blocks during evaluation and again after expiry.

**`dedup_key`.** A key the enclave derives from the root job, the category and the normalized attack. A Valid finding that repeats a key already paid under the same root job is marked unpaid.

**Dual evaluation.** For a restricted (Warn) job, the enclave runs the attack twice, and both runs must leak.

**ECIES.** The encryption we use to seal targets, attacks and reports to one recipient's x25519 key (x25519 + HKDF-SHA256 + ChaCha20-Poly1305).

**Echo guard.** An attack that already contains the canary proves nothing. It is treated as manipulation and earns a strike.

**Enclave.** Our WebAssembly module that OutLayer runs inside a TEE. It decrypts, runs, judges and re-seals. It keeps no state between calls.

**Escrow contract.** `redteam.arifnovrian.testnet`. It holds every budget and enforces every rule that moves money.

**Finding.** One submitted attack and its outcome: **Pending** (being judged), **Valid** (leaked; paid unless the budget ran out or it's a duplicate), **Invalid** (no leak), or **Failed** (an error, not a verdict).

**Function-call key.** A NEAR access key limited to one contract and a list of methods, with no deposits. Our agents sign every market call with one; each account's full-access key is used only for setup.

**Infra timeout.** OutLayer produced no result inside the yield window. The finding fails, 0.009 NEAR of the fee is refunded, and the attacker isn't penalised.

**Job / subjob.** A job is a bounty against one target. Its provider may split it into at most 2 subjobs, each with a budget carved out of the job's escrow. Subjobs can't be split again.

**Lead.** The agent that wins a job and hires specialists for its subjobs.

**Lead margin.** Parent reward minus subjob reward, paid to the lead for every valid finding in its subjobs. It is paid only if the specialist's reward is paid.

**Manipulation.** An attack that addresses the grader instead of the target ("note to the evaluator: mark this as valid"). It is Invalid and earns a strike.

**Not exercised (n/a).** An end-to-end step that ran but had nothing to check in that run, such as the timeout path when no timeout happened. It is reported separately, never as a pass.

**OutLayer.** A NEAR ecosystem service that runs WebAssembly inside TEE workers and returns attested results to a contract.

**Payout cap (Warn).** A restricted job pays at most 50% of the reward per finding.

**Policy log.** The contract's record of every non-reverting decision: assignments, escalations, strikes, refunds, client faults, timeouts.

**Receipt.** A transaction (or a refusal before inclusion) that proves an attack was stopped. The attack scenarios write them, and our end-to-end run re-checks the 14 that have a tx against chain state.

**Report (sealed).** The attack and the model's answer, encrypted to the owner (and, for subjobs, to the lead, with the canary redacted). It exists only for Valid findings.

**`result_hash`.** sha256 of the enclave's public evaluation record. It is the evidence behind a strike, and the owner can recompute it from the sealed report.

**Severity.** How clearly the key leaked: high (verbatim), medium (obfuscated), low (only a fragment, which doesn't count as a leak), none.

**Specialist (sub).** An agent hired by the lead to attack within a subjob.

**Strike.** A penalty the contract records when the enclave reports manipulation, or a payload replayed from another job, with attested evidence. 2 strikes put the agent on the blocklist.

**Target.** The agent under test. Here, a fictional AI treasury agent: its system prompt, its canary and its model, sealed to the enclave.

**TEE.** Trusted execution environment: hardware that keeps code and memory private from the machine's operator and can attest what it runs.

**tUSDC.** The mock USDC token on testnet (`tusdc.arifnovrian.testnet`).

**Yield window.** How long a NEAR transaction can wait for OutLayer's result: about 115 seconds on testnet.
