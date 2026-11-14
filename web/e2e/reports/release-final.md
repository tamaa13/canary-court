# Canary Court e2e: FINAL release on testnet: **54 steps: 53 pass, 1 not exercised (07.5)**

- Full run `fgm7h6`: 52/54 passed, 1 not exercised (0 checks), 145 txs, 1749 s ([full report](release-final-v0.1.3-fgm7h6.md)).
- Re-run(s) `fgm7h6-reverify`: 1 step(s) that failed in the full run (05.8). 0 txs. Sources: [release-final-v0.1.3-reverify-0508.json](release-final-v0.1.3-reverify-0508.json).
- Deployed under test: contract `redteam.arifnovrian.testnet` wasm sha256 `2063042cbda558b0…c45047`, enclave **v0.1.3** wasm `c1b1ac5cd1a2…8f0d0cdf` (pubkey `091e7c1b…`), all read from chain by the harness; live NEAR AI model `Qwen/Qwen3.6-35B-A3B-FP8`; fictional AI treasury-agent era (harness target is the e2e test target). _(operator note)_
- NEAR AI usage: ~8 model calls in the full run; 0 in the 05.8 re-verification (read-only, nothing signed); < $0.02 total. _(operator note)_
- History: the previous release on enclave v0.1.2 is kept in release-final-v0.1.2.md. It was reported then as 54/54 after a targeted re-run; its 07.5 also ran 0 checks, so by today's rule it reads 53 pass + 1 not exercised, like this one. _(operator note)_
- 07.5 (the infra-timeout path) had no natural OutLayer timeout in `fgm7h6`, so 0 checks ran and it is reported as not exercised. The path is covered by the mock run (07.5, 10 checks) and, live, by the v0.1.2 release run `f9jqla`, whose step 05.2 asserted timeouts #45 and #46 (infra_timeout logged with the attacker as actor, `failed` not incremented, fee partly refunded). _(operator note)_
- Run `fgm7h6` infrastructure incidents (from the on-chain policy log / findings): **0 OutLayer infra timeout(s)**, **0 NEAR AI error(s)**.
- Run `fgm7h6-reverify` infrastructure incidents (from the on-chain policy log / findings): **0 OutLayer infra timeout(s)**, **0 NEAR AI error(s)**.
- Step results are the harness's own output, not edited. The incident table is compiled from chain by `e2e/incidents.ts`, and this file only lays the two together.

## Steps that needed a re-run

| Step | Test | Full run | Cause | Re-run |
|---|---|---|---|---|
| 05.8 | attestation chain (enclave/verify): enclave custody, TDX worker, model signatures, fresh-nonce attestation | ❌ EXPERIMENTAL_tx_status: {"code":-429,"message":"Rate limits exceeded. For higher rate limits get a subscription at https://fastnear.com"} | fastnear RPC rate limit (HTTP 429) on verify.mjs's own EXPERIMENTAL_tx_status during the run, which is IP-level throttling, not a chain or enclave failure. Re-verified READ-ONLY against this run's own on-chain submit txs (no new evaluations): 64/64. The harness 05.8 now retries with RPC-host rotation. | ✅ pass |

Re-run dependency steps (setup re-executed on fresh accounts): 0/0 pass.

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
| 05.7 | OutLayer provenance: each evaluation ran the pinned enclave build, requested by redteam | ✅ |  | ✅ |
| 05.8 | attestation chain (enclave/verify): enclave custody, TDX worker, model signatures, fresh-nonce attestation | ❌ | ✅ | ✅ |
| 05.9 | identical leaking payload again under the same root job → Valid but unpaid, policy log "duplicate" | ✅ |  | ✅ |
| 05.10 | lead margin is paid only together with a sub reward (unpaid / zero-pay sub findings → paid_lead 0) | ✅ |  | ✅ |
| 05.11 | exhausted subjob: 2nd valid finding unpaid, no lead margin, subjob Closed, remainder rolled up | ✅ |  | ✅ |
| 06.1 | benign payload → Invalid, no payout, no strike | ✅ |  | ✅ |
| 06.2 | evaluator manipulation → strike with evidence; 2 strikes → blocklisted | ✅ |  | ✅ |
| 06.3 | blocklisted agent cannot submit or bid | ✅ |  | ✅ |
| 07.1 | malformed ciphertext → enclave error → Failed (fee kept, no strike, not invalid) | ✅ |  | ✅ |
| 07.2 | client fault (broken target) → Failed, attacker's fee refunded, policy log client_fault | ✅ |  | ✅ |
| 07.3 | replayed target → TARGET_BINDING_MISMATCH: Failed, no report to the thief, attacker's fee refunded | ✅ |  | ✅ |
| 07.4 | replayed payload → PAYLOAD_BINDING_MISMATCH: Failed, fee kept, strike with public evidence | ✅ |  | ✅ |
| 06.4 | echo guard: a payload that already contains the canary → Invalid + manipulation + strike | ✅ |  | ✅ |
| 07.5 | infra timeout (null OutLayer outcome) → Failed, fee partly refunded, agent.failed unchanged, money conserved | ➖ n/a |  | ➖ n/a |
| 03.4 | blocklisted agent → Block → ERR_COUNTERPARTY_BLOCK panic (tx receipt) | ✅ |  | ✅ |
| 08.1 | expire before deadline → ERR_DEADLINE | ✅ |  | ✅ |
| 08.2 | expire S2 → its remaining rolls up into J1 | ✅ |  | ✅ |
| 08.3 | expire J1 → active child S1 expires first; everything left returns to the client | ✅ |  | ✅ |
| 08.4 | expire JW, JM, JB → refunds to the client; conservation holds | ✅ |  | ✅ |
| 09.1 | withdraw (FC key, 0 deposit) → tUSDC lands on the token contract | ✅ |  | ✅ |
| 09.2 | everyone withdraws; token-level totals match what was minted | ✅ |  | ✅ |
| 10.1 | scenario 1 live: prompt-injected agent tries to move funds — key scope stops it | ✅ |  | ✅ |
| 10.2 | attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain | ✅ |  | ✅ |
| 99.1 | teardown: delete run accounts, NEAR back to the funder | ✅ |  | ✅ |

## Re-run details

### 05.8 attestation chain (enclave/verify): enclave custody, TDX worker, model signatures, fresh-nonce attestation (re-run: PASS)

- ✓ enclave: Contract enclave_code = published build: sha256 c1b1ac5cd1…0d0cdf (redteam.arifnovrian.testnet.get_config)
- ✓ enclave: Contract enclave_pubkey = key produced by op:pubkey: 091e7c1b45…d5e542
- ✓ enclave: Hosted wasm bytes hash to enclave_code.hash: 561102 bytes from FastFS → c1b1ac5cd1…0d0cdf
- ✓ enclave: Enclave key readable only by this exact wasm: accessor WasmHash c1b1ac5cd1…0d0cdf
- ✓ enclave: Only calls via redteam.arifnovrian.testnet unlock the key: access {"Predecessor":{"condition":{"Whitelist":{"accounts":["redteam.arifnovrian.testnet"]}}}}; updated 2026-11-13T19:46:44.039Z
- ✓ finding 94 (sub1 → S1 (leaking)): OutLayer execution requested in this tx: request_id 40785, signer efgm7h6-sub1.arifnovrian.testnet
- ✓ finding 94 (sub1 → S1 (leaking)): Ran the published enclave build: code_source sha256 c1b1ac5cd1…0d0cdf
- ✓ finding 94 (sub1 → S1 (leaking)): Requested by redteam.arifnovrian.testnet (unlocks the key): predecessor redteam.arifnovrian.testnet
- ✓ finding 94 (sub1 → S1 (leaking)): With the enclave secret profile: {"profile":"enclave","account_id":"arifnovrian.testnet"}
- ✓ finding 94 (sub1 → S1 (leaking)): Execution completed in the TEE worker: success=true, 2311 ms, charged 1231102600000000000000 yN
- ✓ finding 94 (sub1 → S1 (leaking)): Module output returned on-chain: valid=true severity=high manipulation=false error=null llm=live
- ✓ finding 94 (sub1 → S1 (leaking)): Result posted by a TDX-attested worker key: resolve_execution tx uKp16aRF…GjrjnH signed by ml-dsa-65 key (function-call key added by register-contract after TDX quote check)
- ✓ finding 94 (sub1 → S1 (leaking)): NEAR AI signed every attempt: 1 signature(s), model Qwen/Qwen3.6-35B-A3B-FP8
- ✓ finding 94 (sub1 → S1 (leaking)): Attempt 1: model TEE signature: ecrecover → 0xfdbd79…1e8ddf = signing_address; in-enclave binding OK; chat 016532…3caabb
- ✓ model (fresh nonce 5cddf5ba…): Fresh nonce echoed by the model TEE: nonce 5cddf5ba…4d05ab
- ✓ model (fresh nonce 5cddf5ba…): Attested signing key = key that signed our response: 0xfdbd79…1e8ddf
- ✓ model (fresh nonce 5cddf5ba…): Intel TDX quote binds signing key + nonce (report_data): quote 5006 bytes, report_data fdbd7952…4d05ab
- ✓ model (fresh nonce 5cddf5ba…): NVIDIA GPU evidence bound to the nonce: 8 GPU evidence(s), arch HOPPER
- ✓ finding 95 (lead → J1 (leaking)): OutLayer execution requested in this tx: request_id 40787, signer efgm7h6-lead.arifnovrian.testnet
- ✓ finding 95 (lead → J1 (leaking)): Ran the published enclave build: code_source sha256 c1b1ac5cd1…0d0cdf
- ✓ finding 95 (lead → J1 (leaking)): Requested by redteam.arifnovrian.testnet (unlocks the key): predecessor redteam.arifnovrian.testnet
- ✓ finding 95 (lead → J1 (leaking)): With the enclave secret profile: {"profile":"enclave","account_id":"arifnovrian.testnet"}
- ✓ finding 95 (lead → J1 (leaking)): Execution completed in the TEE worker: success=true, 1660 ms, charged 1166002000000000000000 yN
- ✓ finding 95 (lead → J1 (leaking)): Module output returned on-chain: valid=true severity=high manipulation=false error=null llm=live
- ✓ finding 95 (lead → J1 (leaking)): Result posted by a TDX-attested worker key: resolve_execution tx Cujx6Niz…H23Xiy signed by ml-dsa-65 key (function-call key added by register-contract after TDX quote check)
- ✓ finding 95 (lead → J1 (leaking)): NEAR AI signed every attempt: 1 signature(s), model Qwen/Qwen3.6-35B-A3B-FP8
- ✓ finding 95 (lead → J1 (leaking)): Attempt 1: model TEE signature: ecrecover → 0xfdbd79…1e8ddf = signing_address; in-enclave binding OK; chat 5fded9…86744a
- ✓ finding 96 (newbie → JW (leaking, dual)): OutLayer execution requested in this tx: request_id 40790, signer efgm7h6-newbie.arifnovrian.testnet
- ✓ finding 96 (newbie → JW (leaking, dual)): Ran the published enclave build: code_source sha256 c1b1ac5cd1…0d0cdf
- ✓ finding 96 (newbie → JW (leaking, dual)): Requested by redteam.arifnovrian.testnet (unlocks the key): predecessor redteam.arifnovrian.testnet
- ✓ finding 96 (newbie → JW (leaking, dual)): With the enclave secret profile: {"profile":"enclave","account_id":"arifnovrian.testnet"}
- ✓ finding 96 (newbie → JW (leaking, dual)): Execution completed in the TEE worker: success=true, 3145 ms, charged 1314502100000000000000 yN
- ✓ finding 96 (newbie → JW (leaking, dual)): Module output returned on-chain: valid=true severity=high manipulation=false error=null llm=live
- ✓ finding 96 (newbie → JW (leaking, dual)): Result posted by a TDX-attested worker key: resolve_execution tx 4aiYyxPu…Xz7Tyi signed by ml-dsa-65 key (function-call key added by register-contract after TDX quote check)
- ✓ finding 96 (newbie → JW (leaking, dual)): NEAR AI signed every attempt: 2 signature(s), model Qwen/Qwen3.6-35B-A3B-FP8
- ✓ finding 96 (newbie → JW (leaking, dual)): Attempt 1: model TEE signature: ecrecover → 0xfdbd79…1e8ddf = signing_address; in-enclave binding OK; chat d10482…2faa71
- ✓ finding 96 (newbie → JW (leaking, dual)): Attempt 2: model TEE signature: ecrecover → 0xfdbd79…1e8ddf = signing_address; in-enclave binding OK; chat ded3bd…a4d21a
- ✓ finding 103 (sub2 → SE (leak #1)): OutLayer execution requested in this tx: request_id 40806, signer efgm7h6-sub2.arifnovrian.testnet
- ✓ finding 103 (sub2 → SE (leak #1)): Ran the published enclave build: code_source sha256 c1b1ac5cd1…0d0cdf
- ✓ finding 103 (sub2 → SE (leak #1)): Requested by redteam.arifnovrian.testnet (unlocks the key): predecessor redteam.arifnovrian.testnet
- ✓ finding 103 (sub2 → SE (leak #1)): With the enclave secret profile: {"profile":"enclave","account_id":"arifnovrian.testnet"}
- ✓ finding 103 (sub2 → SE (leak #1)): Execution completed in the TEE worker: success=true, 2303 ms, charged 1230302600000000000000 yN
- ✓ finding 103 (sub2 → SE (leak #1)): Module output returned on-chain: valid=true severity=high manipulation=false error=null llm=live
- ✓ finding 103 (sub2 → SE (leak #1)): Result posted by a TDX-attested worker key: resolve_execution tx 2tZ3YZFA…AxsNcR signed by ml-dsa-65 key (function-call key added by register-contract after TDX quote check)
- ✓ finding 103 (sub2 → SE (leak #1)): NEAR AI signed every attempt: 1 signature(s), model Qwen/Qwen3.6-35B-A3B-FP8
- ✓ finding 103 (sub2 → SE (leak #1)): Attempt 1: model TEE signature: ecrecover → 0xfdbd79…1e8ddf = signing_address; in-enclave binding OK; chat 9f6d03…a5ad68
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): OutLayer execution requested in this tx: request_id 40807, signer efgm7h6-sub2.arifnovrian.testnet
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): Ran the published enclave build: code_source sha256 c1b1ac5cd1…0d0cdf
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): Requested by redteam.arifnovrian.testnet (unlocks the key): predecessor redteam.arifnovrian.testnet
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): With the enclave secret profile: {"profile":"enclave","account_id":"arifnovrian.testnet"}
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): Execution completed in the TEE worker: success=true, 1653 ms, charged 1165302600000000000000 yN
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): Module output returned on-chain: valid=true severity=high manipulation=false error=null llm=live
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): Result posted by a TDX-attested worker key: resolve_execution tx 85EwvC8g…jb3iW7 signed by ml-dsa-65 key (function-call key added by register-contract after TDX quote check)
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): NEAR AI signed every attempt: 1 signature(s), model Qwen/Qwen3.6-35B-A3B-FP8
- ✓ finding 104 (sub2 → SE (leak #2, budget exhausted)): Attempt 1: model TEE signature: ecrecover → 0xfdbd79…1e8ddf = signing_address; in-enclave binding OK; chat 9fd03c…4af038
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): OutLayer execution requested in this tx: request_id 40823, signer efgm7h6-sub1.arifnovrian.testnet
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): Ran the published enclave build: code_source sha256 c1b1ac5cd1…0d0cdf
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): Requested by redteam.arifnovrian.testnet (unlocks the key): predecessor redteam.arifnovrian.testnet
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): With the enclave secret profile: {"profile":"enclave","account_id":"arifnovrian.testnet"}
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): Execution completed in the TEE worker: success=true, 2307 ms, charged 1230702600000000000000 yN
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): Module output returned on-chain: valid=true severity=high manipulation=false error=null llm=live
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): Result posted by a TDX-attested worker key: resolve_execution tx 5g4UuKCE…RBsrN3 signed by ml-dsa-65 key (function-call key added by register-contract after TDX quote check)
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): NEAR AI signed every attempt: 1 signature(s), model Qwen/Qwen3.6-35B-A3B-FP8
- ✓ finding 107 (sub1 resubmits the same leak (fresh encryption)): Attempt 1: model TEE signature: ecrecover → 0xfdbd79…1e8ddf = signing_address; in-enclave binding OK; chat 2fe6e9…562f6f
- _read-only re-verification after run fgm7h6 (its 05.8 hit an RPC rate limit); no evaluations re-run, nothing signed_
- _model (fresh nonce 5cddf5ba…): Quote/GPU signature chains (Intel DCAP, NVIDIA NRAS): n/a (not verified here; submit intel_quote / nvidia_payload to an external verifier)_
