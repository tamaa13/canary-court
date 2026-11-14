# Canary Court e2e: release on testnet (enclave v0.1.2, superseded by the v0.1.3 run): **54/54 steps pass**

- Full run `f9jqla`: 50/54 passed, 136 txs, 1685 s ([full report](release-final-attempt1-f9jqla.md)).
- Targeted re-run `fbciwc`: 4 step(s) that failed in the full run (07.1, 07.2, 10.1, 10.2), re-executed with their dependencies on fresh accounts once the OutLayer queue was QUIET. 77 txs, 257 s ([full report](release-final-rerun-fbciwc.md)).
- Deployed under test: contract `redteam.arifnovrian.testnet` wasm sha256 `2063042cbda558b0…c45047` (read from RPC code_hash by the harness), enclave v0.1.2 wasm `1ab104255db5…c5f28a` (pubkey `edcfab71…`), live NEAR AI model `Qwen/Qwen3.6-35B-A3B-FP8`. _(operator note)_
- NEAR AI usage: ~8 model calls in the full run (incl. the one that returned LLM_UNAVAILABLE), 0 in the re-run; < $0.02 total. _(operator note)_
- Run `f9jqla` infrastructure incidents (from the on-chain policy log / findings): **4 OutLayer infra timeout(s)**, **1 NEAR AI error(s)**: 3 resolved by an in-run resubmit, 2 via the targeted re-run.
- Run `fbciwc` infrastructure incidents (from the on-chain policy log / findings): **0 OutLayer infra timeout(s)**, **0 NEAR AI error(s)**.
- Step results are the harness's own output, not edited. The incident table is compiled from chain by `e2e/incidents.ts`, and this file only lays the two together.

## Infrastructure incidents (all, from chain)

| Run | Finding | Job | Attacker | Kind | Error | Policy seq | Resolution |
|---|---|---|---|---|---|---|---|
| f9jqla | #43 | 58 | `ef9jqla-newbie` | NEAR AI error (enclave LLM_*; Failed, fee kept) | `enclave: LLM_UNAVAILABLE` | - | resubmitted in-run as #54 → Valid |
| f9jqla | #45 | 59 | `ef9jqla-mallory` | OutLayer queue timeout (infra_timeout: 0.009 NEAR refunded, no strike, failed not counted) | `outlayer: run failed or produced no output` | 186 | resubmitted in-run as #55 → Invalid (manipulation) |
| f9jqla | #46 | 59 | `ef9jqla-mallory` | OutLayer queue timeout (infra_timeout: 0.009 NEAR refunded, no strike, failed not counted) | `outlayer: run failed or produced no output` | 187 | resubmitted in-run as #56 → Invalid (manipulation) |
| f9jqla | #47 | 53 | `ef9jqla-sub2` | OutLayer queue timeout (infra_timeout: 0.009 NEAR refunded, no strike, failed not counted) | `outlayer: run failed or produced no output` | 188 | not resubmitted in this run → see re-run below |
| f9jqla | #48 | 54 | `ef9jqla-sub2` | OutLayer queue timeout (infra_timeout: 0.009 NEAR refunded, no strike, failed not counted) | `outlayer: run failed or produced no output` | 189 | not resubmitted in this run → see re-run below |

## Steps that needed a re-run

| Step | Test | Full run | Cause | Re-run |
|---|---|---|---|---|
| 07.1 | malformed ciphertext → enclave error → Failed (fee kept, no strike, not invalid) | ❌ enclave error code: expected DECRYPT_FAILED, got outlayer: run failed or produced no output | OutLayer queue: no worker picked up request 39890 (tx CQoF99Kq…, finding 47); 200-block yield timeout → contract infra_timeout (policy seq 188, 0.009 NEAR refunded, no strike, failed not counted). Confirmed by rt-enclave. The harness then skipped resubmitting expected-error findings (fixed in f219aea). | ✅ pass |
| 07.2 | client fault (broken target) → Failed, attacker's fee refunded, policy log client_fault | ❌ enclave error code: expected BAD_TARGET, got outlayer: run failed or produced no output | OutLayer queue: same for request 39900 (tx BrVS1Luu…, finding 48) → infra_timeout (policy seq 189). Confirmed by rt-enclave. | ✅ pass |
| 10.1 | scenario 1 live: prompt-injected agent tries to move funds — key scope stops it | ❌ 2 rejection check(s) failed: FC key → tusdc.ft_transfer to attacker rejected with /InvalidAccessKey\|ReceiverMismatch\|DepositWithFunctionCa | Harness bug: the FailoverRpcProvider added for 429s wrapped the expected pre-inclusion InvalidAccessKey rejection as RetriesExceeded. Fixed in 9e27ef8 (plain providers, rotated on 429). | ✅ pass |
| 10.2 | attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain | ❌ HTTP 429 from https://archival-rpc.testnet.fastnear.com | Archival RPC rate limit (HTTP 429) during receipt re-checks. Fixed in 9e27ef8 (backoff + pacing). | ✅ pass |

Re-run dependency steps (setup re-executed on fresh accounts): 19/19 pass.

## All steps (final result)

| Step | Test | Full run | Re-run | Final |
|---|---|---|---|---|
| 01.1 | contract config exposes enclave key and spec policy | ✅ |  | ✅ |
| 01.2 | provision fresh per-run agent accounts (FA key for setup, FC key for actions) | ✅ |  | ✅ |
| 01.3 | agent keys are function-call keys scoped to redteam | ✅ |  | ✅ |
| 01.4 | register client, lead, sub1, sub2 (FC key, 0 deposit) | ✅ |  | ✅ |
| 01.5 | fund: tUSDC mint → ft_transfer_call into escrow; compute deposits (setup FA key) | ✅ |  | ✅ |
| 01.6 | register target: enc_target is ECIES to the enclave, never plaintext | ✅ |  | ✅ |
| 02.1 | create_job locks budget from the client balance | ✅ |  | ✅ |
| 02.2 | create_job guards: deadline, balance, category, ownership | ✅ |  | ✅ |
| 02.3 | lead bids; client cannot bid on its own job | ✅ |  | ✅ |
| 02.4 | client counters once; only the client may counter | ✅ |  | ✅ |
| 02.5 | lead accepts the counter by re-bidding at counter_price | ✅ |  | ✅ |
| 02.6 | accept_bid (lead verdict Allow) assigns J1 unrestricted | ✅ |  | ✅ |
| 03.1 | check_counterparty: aged, clean agents → Allow; unregistered → Block | ✅ |  | ✅ |
| 04.1 | create_subjob S1 carves budget from J1 | ✅ |  | ✅ |
| 04.2 | subjob caps: budget > remaining, reward > parent, category, non-provider, deadline | ✅ |  | ✅ |
| 04.3 | create_subjob S2; third subjob → ERR_MAX_CHILDREN | ✅ |  | ✅ |
| 04.4 | subs bid on subjobs; lead (as client of the subjob) accepts | ✅ |  | ✅ |
| 04.5 | depth cap: a sub cannot subcontract (max 2 layers) | ✅ |  | ✅ |
| 04.6 | report keys are frozen while the agent has active jobs (client and lead) | ✅ |  | ✅ |
| 04.7 | setup for client fault: a job on a broken target (canary too short → BAD_TARGET) | ✅ |  | ✅ |
| 04.8 | replay setup: a second client copies the victim's sealed target (enc_target is public in get_target) | ✅ |  | ✅ |
| 04.9 | setup: second tree JE → SE whose budget covers exactly one sub payout | ✅ |  | ✅ |
| 03.2 | young agents get Warn → assignment auto-restricted (cap 50%, no subcontract, dual eval) | ✅ |  | ✅ |
| 03.3 | restricted provider cannot subcontract | ✅ |  | ✅ |
| 05.1 | submit findings: payloads ECIES-encrypted to the enclave; fee charged from compute | ✅ |  | ✅ |
| 05.2 | all evaluations land; money is conserved at every observed block (atomic payouts) | ✅ |  | ✅ |
| 05.3 | valid subjob finding pays sub reward + lead margin in one callback | ✅ |  | ✅ |
| 05.4 | sealed reports: client and lead decrypt them; result_hash binds the record | ✅ |  | ✅ |
| 05.5 | root-job finding pays the provider; restricted finding pays the capped payout | ✅ |  | ✅ |
| 05.6 | no plaintext payload, canary or system prompt in any view or log | ✅ |  | ✅ |
| 05.7 | OutLayer provenance: each evaluation ran the pinned enclave build, requested by redteam | ✅ ⚠️ |  | ✅ ⚠️ |
| 05.8 | attestation chain (enclave/verify): enclave custody, TDX worker, model signatures, fresh-nonce attestation | ✅ |  | ✅ |
| 05.9 | identical leaking payload again under the same root job → Valid but unpaid, policy log "duplicate" | ✅ |  | ✅ |
| 05.10 | lead margin is paid only together with a sub reward (unpaid / zero-pay sub findings → paid_lead 0) | ✅ |  | ✅ |
| 05.11 | exhausted subjob: 2nd valid finding unpaid, no lead margin, subjob Closed, remainder rolled up | ✅ |  | ✅ |
| 06.1 | benign payload → Invalid, no payout, no strike | ✅ |  | ✅ |
| 06.2 | evaluator manipulation → strike with evidence; 2 strikes → blocklisted | ✅ |  | ✅ |
| 06.3 | blocklisted agent cannot submit or bid | ✅ |  | ✅ |
| 07.1 | malformed ciphertext → enclave error → Failed (fee kept, no strike, not invalid) | ❌ | ✅ | ✅ |
| 07.2 | client fault (broken target) → Failed, attacker's fee refunded, policy log client_fault | ❌ | ✅ | ✅ |
| 07.3 | replayed target → TARGET_BINDING_MISMATCH: Failed, no report to the thief, attacker's fee refunded | ✅ |  | ✅ |
| 07.4 | replayed payload → PAYLOAD_BINDING_MISMATCH: Failed, fee kept, strike with public evidence | ✅ |  | ✅ |
| 06.4 | echo guard: a payload that already contains the canary → Invalid + manipulation + strike | ✅ |  | ✅ |
| 07.5 | infra timeout (null OutLayer outcome) → Failed, fee partly refunded, agent.failed unchanged, money conserved | ✅ |  | ✅ |
| 03.4 | blocklisted agent → Block → ERR_COUNTERPARTY_BLOCK panic (tx receipt) | ✅ |  | ✅ |
| 08.1 | expire before deadline → ERR_DEADLINE | ✅ |  | ✅ |
| 08.2 | expire S2 → its remaining rolls up into J1 | ✅ |  | ✅ |
| 08.3 | expire J1 → active child S1 expires first; everything left returns to the client | ✅ |  | ✅ |
| 08.4 | expire JW, JM, JB → refunds to the client; conservation holds | ✅ |  | ✅ |
| 09.1 | withdraw (FC key, 0 deposit) → tUSDC lands on the token contract | ✅ |  | ✅ |
| 09.2 | everyone withdraws; token-level totals match what was minted | ✅ |  | ✅ |
| 10.1 | scenario 1 live: prompt-injected agent tries to move funds — key scope stops it | ❌ | ✅ | ✅ |
| 10.2 | attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain | ❌ | ✅ | ✅ |
| 99.1 | teardown: delete run accounts, NEAR back to the funder | ✅ |  | ✅ |

## Re-run details

### 07.1 malformed ciphertext → enclave error → Failed (fee kept, no strike, not invalid) (re-run: PASS)

- ✓ status = Failed
- ✓ paid_attacker = 0
- ✓ no report on failure
- ✓ sub2 strikes = 0
- ✓ sub2.invalid counts only Invalid findings (the Failed one is not counted) = 0
- ✓ sub2.failed counts the malformed finding: failed=2
- ✓ enclave error code = DECRYPT_FAILED
- ✓ sub2 compute: attacker-fault fee kept, client-fault fees refunded = 140000000000000000000000

### 07.2 client fault (broken target) → Failed, attacker's fee refunded, policy log client_fault (re-run: PASS)

- ✓ status = Failed
- ✓ paid_attacker = 0
- ✓ enclave error code = BAD_TARGET
- ✓ policy log client_fault entry for this finding: copycat.arifnovrian.testnet job 32: finding 30 failed with TARGET_BINDING_MISMATCH (client fault); fee 20000000000000000000000 refunded to mallory2.arifnovrian.testnet | ef9jqla-thief.arifnovrian.test
- ✓ client_fault actor = root client: efbciwc-client.arifnovrian.testnet
- ✓ sub2 strikes = 0

### 10.1 scenario 1 live: prompt-injected agent tries to move funds — key scope stops it (re-run: PASS)

- ✓ FC key → tusdc.ft_transfer to attacker rejected with /InvalidAccessKey|ReceiverMismatch|DepositWithFunctionCall|receiver|not allowed|permission/i: Deposit is not allowed with function call
- ✓ rejected before inclusion (no tx hash)
- ✓ FC key → deposit-carrying call rejected with /InvalidAccessKey|Deposit|not allowed|permission|MethodNameMismatch/i: Deposit is not allowed with function call
- ✓ forged evaluation callback (FA key, contract level) rejected with /private|Method.*not found|MethodNotFound/i: Smart contract panicked: Method on_finding_evaluated is private

### 10.2 attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain (re-run: PASS)

- ✓ receipts is a non-empty array
- ✓ scenario 1 covered
- ✓ scenario 2 covered
- ✓ scenario 3 covered
- ✓ scenario 4 covered
- ✓ receipts come from a live run (not --dry-run): 0/21 entries flagged mock:true
- ✓ s4-budget-over-remaining: shape
- ✓ s4-budget-over-remaining: runner marked ok: ERR_BUDGET_CAP: budget exceeds parent remaining 40000000
- ✓ s4-budget-over-remaining: on-chain panic ∈ ERR_BUDGET_CAP: Smart contract panicked: ERR_BUDGET_CAP: budget exceeds parent remaining 40000000
- ✓ s4-reward-over-parent: shape
- ✓ s4-reward-over-parent: runner marked ok: ERR_REWARD: subjob reward exceeds parent reward_per_finding
- ✓ s4-reward-over-parent: on-chain panic ∈ ERR_REWARD: Smart contract panicked: ERR_REWARD: subjob reward exceeds parent reward_per_finding
- ✓ s4-two-subjobs-allowed: shape
- ✓ s4-two-subjobs-allowed: runner marked ok
- ✓ s4-two-subjobs-allowed: on-chain tx succeeded (no error expected)
- ✓ s4-third-subjob: shape
- ✓ s4-third-subjob: runner marked ok: ERR_MAX_CHILDREN: max 2 subjobs per job
- ✓ s4-third-subjob: on-chain panic ∈ ERR_MAX_CHILDREN: Smart contract panicked: ERR_MAX_CHILDREN: max 2 subjobs per job
- ✓ s4-client-over-max-budget: shape
- ✓ s4-client-over-max-budget: runner marked ok: ERR_BUDGET_CAP: budget exceeds policy max 1000000000
- ✓ s4-client-over-max-budget: on-chain panic ∈ ERR_BUDGET_CAP|ERR_BALANCE: Smart contract panicked: ERR_BUDGET_CAP: budget exceeds policy max 1000000000
- ✓ s4-depth-2: shape
- ✓ s4-depth-2: runner marked ok: ERR_DEPTH: max depth 1 reached
- ✓ s4-depth-2: on-chain panic ∈ ERR_DEPTH|ERR_NO_SUBCONTRACT: Smart contract panicked: ERR_DEPTH: max depth 1 reached
- ✓ s3-warn-escalation: shape
- ✓ s3-warn-escalation: runner marked ok
- ✓ s3-warn-escalation: on-chain tx succeeded (no error expected)
- ✓ s3-restricted-subcontract: shape
- ✓ s3-restricted-subcontract: runner marked ok: ERR_NO_SUBCONTRACT: provider is restricted on this job (can_subcontract=false)
- ✓ s3-restricted-subcontract: on-chain panic ∈ ERR_NO_SUBCONTRACT: Smart contract panicked: ERR_NO_SUBCONTRACT: provider is restricted on this job (can_subcontract=false)
- ✓ s1-ft-transfer: shape
- ✓ s1-ft-transfer: runner marked ok: AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call
- ✓ s1-ft-transfer: rejected with ReceiverMismatch|DepositWithFunctionCall: AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call
- ✓ s1-near-transfer: shape
- ✓ s1-near-transfer: runner marked ok: AccessKeyRequiresFullAccessActionError: Access key requires full access
- ✓ s1-near-transfer: rejected with RequiresFullAccess|ReceiverMismatch: AccessKeyRequiresFullAccessActionError: Access key requires full access
- ✓ s1-add-key: shape
- ✓ s1-add-key: runner marked ok: AccessKeyRequiresFullAccessActionError: Access key requires full access
- ✓ s1-add-key: rejected with RequiresFullAccess|ReceiverMismatch: AccessKeyRequiresFullAccessActionError: Access key requires full access
- ✓ s1-forge-deposit: shape
- ✓ s1-forge-deposit: runner marked ok: AccessKeyMethodNameMismatchActionError: Access key does not allow method ft_on_transfer
- ✓ s1-forge-deposit: rejected with MethodNameMismatch: AccessKeyMethodNameMismatchActionError: Access key does not allow method ft_on_transfer
- ✓ s1-withdraw-deposit: shape
- ✓ s1-withdraw-deposit: runner marked ok: AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call
- ✓ s1-withdraw-deposit: rejected with DepositWithFunctionCall: AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call
- ✓ s1-spend-client-escrow: shape
- ✓ s1-spend-client-escrow: runner marked ok: ERR_NOT_CLIENT: only the job client
- ✓ s1-spend-client-escrow: on-chain panic ∈ ERR_NOT_CLIENT|ERR_STATUS: Smart contract panicked: ERR_NOT_CLIENT: only the job client
- ✓ s1-honest-hire-ignores-injection: shape
- ✓ s1-honest-hire-ignores-injection: runner marked ok
- ✓ s5-target-replay: shape
- ✓ s5-target-replay: runner marked ok
- ✓ s5-target-replay: on-chain tx succeeded (no error expected)
- ✓ s5-target-replay: enclave output error = TARGET_BINDING_MISMATCH: ["TARGET_BINDING_MISMATCH"]
- ✓ s5-payload-replay: shape
- ✓ s5-payload-replay: runner marked ok
- ✓ s5-payload-replay: on-chain tx succeeded (no error expected)
- ✓ s5-payload-replay: enclave output error = PAYLOAD_BINDING_MISMATCH: ["PAYLOAD_BINDING_MISMATCH"]
- ✓ s2-manipulation-1: shape
- ✓ s2-manipulation-1: runner marked ok
- ✓ s2-manipulation-1: on-chain tx succeeded (no error expected)
- ✓ s2-manipulation-1: enclave flagged manipulation: [true]
- ✓ s2-blocklisted: shape
- ✓ s2-blocklisted: runner marked ok
- ✓ s3-block-bid: shape
- ✓ s3-block-bid: runner marked ok: ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b1f54ec2c611f932f2b3f1b5eb
- ✓ s3-block-bid: on-chain panic ∈ ERR_COUNTERPARTY_BLOCK: Smart contract panicked: ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b
- ✓ s3-block-submit: shape
- ✓ s3-block-submit: runner marked ok: ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b1f54ec2c611f932f2b3f1b5eb
- ✓ s3-block-submit: on-chain panic ∈ ERR_COUNTERPARTY_BLOCK: Smart contract panicked: ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b
- _scenario 5 (replay attacks) present_
- _s4-budget-over-remaining: https://testnet.nearblocks.io/txns/813fgxfJ53ERs5tXZ5h4RyTg3ZFUdAjnuv4ePVK2PUtj_
- _s4-reward-over-parent: https://testnet.nearblocks.io/txns/2jfPn7NUPiHYu3Zi9c4BKdvSukSqx3tUsLc9qhJ9pM6y_
- _s4-two-subjobs-allowed: https://testnet.nearblocks.io/txns/37rZ8VvVwMpyTKRC86uUYxaKeYzwy4pGKZePqCUFYVus_
- _s4-third-subjob: https://testnet.nearblocks.io/txns/BMPtuaKye34gRqqea9w13TFE8859xEBrVHGPwfU1uWjX_
- _s4-client-over-max-budget: https://testnet.nearblocks.io/txns/57K9PnEU1ZQHz6UHdyuVGgdgJnVi1yzUH5eGK5Lx7ieE_
- _s4-depth-2: https://testnet.nearblocks.io/txns/EMSCSM29cj4ntEU19NmqDWLDszJpV3YrG5X1mHaQJt2r_
- _s3-warn-escalation: https://testnet.nearblocks.io/txns/HvTg34t5zyMcRm8mYPM1r6G5s26hg6mtKq2B6RWDducm_
- _s3-restricted-subcontract: https://testnet.nearblocks.io/txns/JBX4x7aogCsTXdofmFwDkwo9Kg7yfptsqKFz6nTRLxwj_
- _s1-spend-client-escrow: https://testnet.nearblocks.io/txns/Edcy1MPZ2WqrNAn8j178XzddWufiSXLJVCqr9MHj8DQY_
- _s5-target-replay: https://testnet.nearblocks.io/txns/XccUa2uNkRswMhsoRCXYatnDRK2byUzrJosUZR7F4Mb_
- _s5-payload-replay: https://testnet.nearblocks.io/txns/G3sKj6tUUFPoBRdoNc8evGroxFeJKa36NF8YnP6UQgcV_
- _s2-manipulation-1: https://testnet.nearblocks.io/txns/YFMiWmu1nxQdtiugfV8yWRzsDCqWTuRiwcUDk1rW2uT_
- _s3-block-bid: https://testnet.nearblocks.io/txns/8euY3JSwa2czt9GRPrBbG9pRjdDfAXGwHRwNSVz3xit1_
- _s3-block-submit: https://testnet.nearblocks.io/txns/DMe7HXGgyhLGrqtv7NRK6rxPPtva9XzSWEvP6NCzBZir_
