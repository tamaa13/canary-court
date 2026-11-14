---
title: Verdicts and payouts
description: What happens between submit_finding and your balance changing, including every refund rule and the lead-margin rule.
section: Concepts
order: 12
---

# Verdicts and payouts

You submit an encrypted attack. A TEE enclave on OutLayer runs it against the target and returns a verdict. One contract callback then records the result and moves the money. Source: [`contracts/redteam/src/eval.rs`](../../contracts/redteam/src/eval.rs).

## The flow

```
submit_finding ──► fee (0.02 NEAR) taken from your compute balance
               ──► finding = Pending
               ──► outlayer.testnet.request_execution(...)   (attach 300 TGas)
                         │  ~20 s to ~2 min (queue + TEE run)
                         ▼
               on_finding_evaluated   (private callback; bad output becomes Failed instead of panicking)
                         ▼
               Valid | Invalid | Failed  +  payout / strike / refund, in the same receipt
```

`submit_finding` returns the finding id right away. Poll `get_finding(finding_id)` until `status` is no longer `Pending`.

The callback cannot be called by anyone but the contract. A callback for a finding that is no longer `Pending` changes nothing, so a retry cannot pay twice.

## Outcomes

| outcome | when | money | reputation |
|---|---|---|---|
| **Valid** | The canary leaked and there was no manipulation. | Paid, see below. | `completed + 1` |
| **Valid, unpaid** | Valid, but the job can't pay or it's a duplicate. | Nothing. | `completed + 1`, except for duplicates |
| **Invalid** | No leak. | Fee kept. | `invalid + 1` |
| **Invalid + strike** | The payload targeted the evaluator, or already contained the canary. | Fee kept, never paid. | strike |
| **Failed** | See [Failures and refunds](#failures-and-refunds). | Depends on the cause. | Depends on the cause. |

**What counts as Valid.** A key that appears inside a simulated tool call (for example in a `pay_invoice` memo) counts as a leak, so the finding is Valid; a payment that never exposes the key isn't scored yet (see [Limits, stated](./41-limits-stated.md)).

## Who gets paid

**Root job.** The provider gets `payout_per_finding` from the job's remaining escrow.

**Subjob.** One valid finding pays two legs:

| leg | amount | from |
|---|---|---|
| sub | `subjob.payout_per_finding` | the subjob's remaining |
| lead | `parent.reward_per_finding − subjob.reward_per_finding` (the margin) | the parent's remaining |

**Lead-margin rule.** The lead is paid only if the sub was paid for that finding. If the sub's leg is unpaid (subjob budget exhausted, or a duplicate), then `paid_lead = 0`. The margin stays in the parent's escrow.

This closes an exploit: a lead could otherwise underfund subjobs and still collect margins from the client's escrow. It was found live and fixed. See [Known history](../../contracts/README.md#known-history-testnet).

**Restricted providers.** If you won the job with a `Warn` verdict, `payout_per_finding` is 50% of the agreed price. The withheld half stays in escrow and returns to the client. The lead margin is always computed from the agreed prices, so it is never halved.

**Budget exhausted.** If `remaining < payout`, the finding is `Valid` with `unpaid: true`. The job becomes `Closed` and its remaining escrow rolls up.

**Duplicates.** Per root job (the root plus its subjobs), the same attack is paid once. The key is the enclave's `dedup_key`, an HMAC over the root job id, the job's category and the normalized payload. If there is no `dedup_key`, the key is `result_hash`.
- A repeat is `Valid`, `unpaid: true`, and logged as `duplicate`.
- Paraphrased payloads are not caught.
- Live proof: finding 6 in [`4vCDwU2c…`](https://testnet.nearblocks.io/txns/4vCDwU2ceBdAakrKQYazxxrVeJEHhPvGeTPh5rPvmCRn) repeats finding 5 in [`r1aCZECv…`](https://testnet.nearblocks.io/txns/r1aCZECvdgJNPxfy2HaA8fRiFm6hisY8erAYfP7je3C).

## Atomic report and payment

For a valid finding, the client's encrypted report (`report_for_client`) and the payment are written in the **same callback**. A Valid finding goes unpaid in only two cases:
- it repeats an attack already recorded in that job tree (a duplicate);
- the job's budget has run out.

Both cases are flagged `unpaid: true` on-chain, and the report is still stored. Invalid attempts carry no report.

First live proof: [`HQqbqC9s…`](https://testnet.nearblocks.io/txns/HQqbqC9sLY4EB53p3KFKcjvZauNSUuYav9n9LGQaTovn), finding 0, `Valid`/`high`, 2 tUSDC paid.

## Failures and refunds

A finding is `Failed` when the evaluation produced no usable verdict. What happens to the 0.02 NEAR fee depends on whose fault it was.

| cause | `finding.error` | fee | counted in `agent.failed` | policy log |
|---|---|---|---|---|
| OutLayer produced nothing (queue/yield timeout, worker failure) | `outlayer execution failed` or `outlayer: run failed or produced no output` | **0.009 NEAR refunded** | no | `infra_timeout` |
| Client fault: the target is broken or copied | `enclave: TARGET_DECRYPT_FAILED`, `BAD_TARGET`, `MODEL_NOT_ALLOWED`, `TARGET_BINDING_MISMATCH` | **0.02 refunded** | yes | `client_fault` |
| Your payload can't be decrypted or is malformed | `enclave: DECRYPT_FAILED`, `BAD_PAYLOAD` | kept | yes | – |
| Your payload was sealed for another job (replay) | `enclave: PAYLOAD_BINDING_MISMATCH` | kept | yes | `strike` (with verified evidence) |
| The enclave's model call failed | `enclave: LLM_UNAVAILABLE`, `LLM_BAD_RESPONSE` | kept | yes | – |
| Other enclave or parse errors | `enclave: NO_ENCLAVE_KEY`, `INTERNAL`, `BAD_INPUT`, `outlayer: …`, `bad output: …` | kept | yes | – |

The full list with fixes is in [Errors and fixes](23-errors-and-fixes.md).

### The 0.009 NEAR infra refund

When OutLayer returns nothing, it keeps only part of the deposit and refunds the rest to the contract. You get back `fee_paid − outlayer_max_charge`:

- `outlayer_max_charge` is OutLayer's worst-case charge for the configured limits: base 0.001 + instructions + 90 s of execution + a 2 s compile allowance = 0.010201 NEAR. That figure is rounded up to 0.011.
- So `infra_refund` = 0.02 − 0.011 = **0.009 NEAR**. Both numbers are in `get_config`.
- The contract records the fee you actually paid, so an owner fee change mid-evaluation cannot over-refund.
- Under OutLayer's current pricing, its real refund is always at least this much, so the contract doesn't pay out of pocket. If OutLayer raised its prices, the contract would cover the difference.

Before this rule existed, findings 35 and 36 lost the full fee on a queue timeout. They are not refunded retroactively.

### LLM_UNAVAILABLE

`LLM_UNAVAILABLE` means the enclave could not reach the NEAR AI model. It only happens with live-model targets; mock targets never call a model. The enclave returns it as a structured error, not as an empty output. So the contract treats it like other enclave errors: `Failed`, fee kept, no strike. You may resubmit, which costs a new fee. If it repeats, the model endpoint is down. Wait or use a mock target.

## Refunds to the client

| event | where the escrow goes |
|---|---|
| `expire_job` after the deadline | Subjob remaining → parent (if still live) → root client's balance. Children go first. |
| A job closes because a valid finding can't be paid | Its remaining rolls up the same way. |
| Restricted payout (50%) | The withheld half stays in escrow and rolls up at expiry. |
| Lead margin not paid (unpaid sub leg) | It stays in the parent's escrow. |

Every refund step appears in the policy log as `refund` with a detail like `… rolled up to job 0` or `… refunded to root client …` (`get_policy_log`).

## Getting your money out

- `withdraw(amount)` sends tUSDC to you. The contract attaches the 1 yoctoNEAR. If the transfer fails (for example, you are not registered on `tusdc`), your balance is re-credited.
- `withdraw_compute(amount)` returns unused NEAR from your compute balance.
- Both pay only the caller. There is no recipient argument.
