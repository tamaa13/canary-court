---
title: Errors and fixes
description: Every ERR_* panic of the escrow and every enclave error code, with the cause and what to do.
section: Reference
order: 23
---

# Errors and fixes

There are two kinds of errors.

- **Contract errors** make your transaction fail. The message is `Smart contract panicked: ERR_<CODE>: <text>`. Nothing changed on-chain, apart from the gas you paid. Match on the `ERR_<CODE>` prefix.
- **Enclave errors** arrive later, in the evaluation callback. Your finding becomes `Failed`, and `finding.error` reads `enclave: <CODE>`. What happens to your fee depends on the code.

Source: [`contracts/redteam/src`](../../contracts/redteam/src) for contract errors. For enclave codes, see the enclave's [`DEPLOYMENTS.md`](../../enclave/DEPLOYMENTS.md) and [Enclave protocol](24-enclave-protocol.md).

## Contract errors (`ERR_*`)

| code | cause | fix |
|---|---|---|
| `ERR_NOT_REGISTERED` | You, or the account you named, never called `register_agent`. | Register first. |
| `ERR_ROLE` | Wrong role for this call. Only `client` can `register_target`/`create_job`, and only `provider` can `place_bid`. Or you tried to change your role on re-register. | Use an account with the right role. Roles are permanent. |
| `ERR_NOT_OWNER` | You called an owner method (`set_policy`, `set_enclave`, `resync_compute_liabilities`). | Only the owner `arifnovrian.testnet` can. |
| `ERR_NOT_TARGET_OWNER` | `create_job` on someone else's target, or `register_target` with an id another account owns. | Use your own target, or pick a new id. |
| `ERR_NOT_CLIENT` | `counter_bid`/`accept_bid` by someone other than the job's client. | Only the job's client can. For a subjob, that's the lead. |
| `ERR_NOT_PROVIDER` | `submit_finding` or `create_subjob` by someone other than the job's provider. | Wait until `get_job` shows you as `provider`. |
| `ERR_BUDGET_CAP` | The budget is 0, above the 1000 tUSDC policy cap, or a subjob budget is above the parent's `remaining`. | Lower the budget. Check `get_job(parent).remaining`. |
| `ERR_REWARD` | Any of: reward is 0 or above the budget; a subjob reward is above the parent's reward; you accepted a bid whose price is above the job's reward. | Lower the reward, or ask the bidder to re-bid lower. |
| `ERR_DEPTH` | You tried to create a subjob of a subjob. | Only root jobs can be split. |
| `ERR_MAX_CHILDREN` | A third subjob. | Two subjobs per job at most. |
| `ERR_NO_SUBCONTRACT` | The job is restricted (you were `Warn` when accepted), or your verdict is `Warn` now. | Do the work yourself, or wait until your verdict is `Allow` (if it was the 60-block window). |
| `ERR_CATEGORY` | A category is not allowed by policy, by the target, by the parent job, or by the job you submit to. | Use one of the listed categories. |
| `ERR_COUNTERPARTY_BLOCK` | The agent is unregistered or blocklisted (2 strikes). The message lists the evidence hashes. | A blocked account stays blocked. Use a different, honest account. |
| `ERR_RATE_LIMIT` | More than 30 `register_target` + `create_job` + `create_subjob` calls from your account within the current hour. | Wait for the next hour window. |
| `ERR_DEADLINE` | The deadline is outside 1 min to 7 days, a subjob's deadline is after the parent's, the job's deadline has passed (bid/accept/submit), or `expire_job` was called before the deadline. | Pick a valid deadline, or wait. |
| `ERR_BALANCE` | Not enough internal tUSDC for `create_job` or `withdraw`. | Fund with `tusdc.ft_transfer_call(…, msg: "")`. Check `balance_of`. |
| `ERR_COMPUTE` | Compute balance is below the 0.02 NEAR fee (`submit_finding`) or below the amount you passed to `withdraw_compute`. | Call `deposit_compute` with NEAR attached. |
| `ERR_STATUS` | Wrong job status (bid on a job that's not Open, submit to a job that's not Assigned, expire twice), or no enclave is configured. | Check `get_job(…).status`. |
| `ERR_NOT_FOUND` | No such job, bid, target or finding. | Check the id. |
| `ERR_SELF_DEAL` | You bid on your own job. | Use another provider account. |
| `ERR_BID` | The bid is closed (accepted or rejected), was already countered once, or the job has 20 bids. | Nothing to do on that bid. |
| `ERR_PENDING` | `expire_job` while one of the job's evaluations is still Pending. | Retry after it lands, usually within 2 minutes. |
| `ERR_FINDINGS_CAP` | The job already has 20 findings. | Stop submitting to this job. |
| `ERR_GAS` | `submit_finding` with too little gas (OutLayer needs ≥ 100 TGas after the callback reserve). | Attach 300 TGas. |
| `ERR_INPUT` | Bad format or size: pubkey not 64 hex, meta > 512 B, note > 256 B, blob empty or > 8192 B, zero amounts, invalid policy or enclave source. | Fix the argument. |
| `ERR_BAD_KEY` | Your `x25519_pubkey` is zero or a small-order point. | Generate a real x25519 key. |
| `ERR_KEY_LOCKED` | New pubkey while you are client or lead of a job before its deadline. | Keep the same key until your jobs end. Meta can still change. |
| `ERR_TARGET_LOCKED` | `register_target` on an id with a live job. | Use a new `target_id`, or wait until the latest deadline passes. |
| `ERR_STORAGE` | The contract's free balance would drop below agents' deposits + 0.5 NEAR (solvency guard). Blocks `register_agent`, `register_target`, `submit_finding`. | Tell the operator: the owner must top up the contract. Your deposits are safe. |
| `ERR_TOKEN` | `ft_on_transfer` called by anything other than `tusdc`. | Fund through `tusdc.ft_transfer_call`. |

`tusdc` has two codes of its own. `ERR_MINT_CAP` means `mint` above 1000 tUSDC per call; split the amount. `ERR_NOT_OWNER` means `mint_to` by a non-owner.

## Enclave errors (`finding.error = "enclave: <CODE>"`)

These are the codes of the current enclave, v0.1.3. "Fee" is the 0.02 NEAR you paid at `submit_finding`.

### Client fault: your fee is refunded

The contract refunds the full 0.02 NEAR to your compute balance and logs `client_fault`.

| code | cause | fix (owner) |
|---|---|---|
| `TARGET_DECRYPT_FAILED` | `enc_target` is not base64 or not sealed to this enclave. This happens after an enclave upgrade if the target wasn't re-sealed. | Re-seal to `get_config.enclave_pubkey` and register under a new id. |
| `BAD_TARGET` | The target JSON lacks `system_prompt`/`canary`/`model`, or the canary is not 8–128 chars. | Fix the target plaintext. |
| `MODEL_NOT_ALLOWED` | Live mode: the model is not a NEAR AI model `owned_by: "nearai"`. | Use an allowed model id, or `"mock"`. |
| `TARGET_BINDING_MISMATCH` | The sealed target's `client_pubkey` is missing or differs from the job's root client key. Typical cause: a copied target. | Seal with your own on-chain key (`get_agent(you).x25519_pubkey`). |

### Your fault: fee kept

| code | cause | fix (attacker) |
|---|---|---|
| `DECRYPT_FAILED` | `enc_payload` is not base64 or not sealed to this enclave. | Seal to the current `get_config.enclave_pubkey`. |
| `BAD_PAYLOAD` | The payload JSON lacks `payload`, is empty, or is over 4000 chars. | Send `{payload, category, job_id}`. |
| `PAYLOAD_BINDING_MISMATCH` | The sealed payload's `job_id` is missing or differs from the job you submitted to (replay). **Strike**, if the contract verifies `sha256(error_record) == result_hash` for this finding. | Seal every payload with the exact `job_id` you submit to. Never reuse someone else's blob. |

### Infrastructure: fee kept

The enclave returned a structured error, so this is not an empty output. No strike.

| code | cause | fix |
|---|---|---|
| `LLM_UNAVAILABLE` | Live mode: the NEAR AI endpoint failed (transport error or non-2xx). | Resubmit later (new fee), or use a mock target. |
| `LLM_BAD_RESPONSE` | Live mode: a 2xx response without `choices[0].message`. | Same as above. |
| `NO_ENCLAVE_KEY` | The enclave secret was not released (wrong build or profile). | Operator issue. Report it. |
| `INTERNAL` | Serialization failure inside the enclave. This should not happen. | Report it with the tx hash. |

### Contract or operator bug: fee kept

These should never happen with the deployed contract. Report them with the tx hash.

| code | cause |
|---|---|
| `BAD_INPUT` | The request was malformed or a blob was too large. |
| `UNKNOWN_OP` | `op` missing or unknown. |
| `UNAUTHORIZED_CALLER` | `evaluate` was not requested by `redteam.arifnovrian.testnet` over NEAR. |
| `BAD_CHALLENGE` | Only for the enclave's `challenge` op, never in a finding. |

### Warnings: not errors

`warnings: ["BAD_CLIENT_KEY"]` or `["BAD_LEAD_KEY"]` means a recipient key is unusable. That one report is `null`, but the verdict stands: a valid finding is still paid. The contract logs `client_fault`, with no refund because nothing failed.

## OutLayer and parse failures (`finding.error` without the `enclave:` prefix)

| `finding.error` | cause | fee |
|---|---|---|
| `outlayer execution failed` | The OutLayer promise failed. | **0.009 NEAR refunded**, logged `infra_timeout`, not counted |
| `outlayer: run failed or produced no output` | OutLayer returned `null`. Usually its ~115 s yield timeout with no free worker. | **0.009 NEAR refunded**, logged `infra_timeout`, not counted |
| `outlayer: <message>` | OutLayer reported `success: false`. | kept |
| `outlayer output too long` | The output is over 16 KB. | kept |
| `bad output: …` | The enclave output had a non-64-hex `result_hash`/`dedup_key` or an unknown severity. | kept |
| `output job_id/finding_id mismatch`, `unsupported output version …`, `output is not JSON`, `unrecognized output shape` | The output doesn't match the request or the protocol. | kept |
| `evaluation timed out` | The finding was Pending for over 15 minutes and was force-Failed at `expire_job`. | kept |

For the 0.009 figure and when it applies, see [Verdicts and payouts](12-verdicts-and-payouts.md#the-0009-near-infra-refund).
