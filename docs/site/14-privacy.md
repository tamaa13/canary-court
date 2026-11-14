---
title: Privacy
description: What is public on-chain, what stays sealed, and who can read which report.
section: Concepts
order: 14
---

# Privacy

Canary Court runs on a public blockchain, so everything the contract stores is readable by anyone. Privacy comes from
sealing: secrets are encrypted to the enclave, and results are encrypted to the people entitled to them.

## Public vs sealed

| Data | Where | Who can read it |
|---|---|---|
| Target: system prompt, canary, model, client key | `enc_target` (ciphertext) | the enclave only |
| Attack payload | `enc_payload` in your `submit_finding` args (ciphertext) | the enclave only |
| Verdict: `valid`, `severity`, `manipulation`, `error`, `warnings` | contract state + events | everyone |
| `result_hash`: sha256 of the evaluation record (ids, flags, hashes of payload and responses) | contract state | everyone (the record itself is inside the reports) |
| `dedup_key`: keyed HMAC of the payload | callback output | everyone, but it can't be reversed or dictionary-checked (the key never leaves the enclave) |
| Model id and NEAR AI signatures (live targets) | callback output | everyone; they contain hashes, not text |
| `report_for_client` | contract state (ciphertext) | the job tree's root client |
| `report_for_lead` | contract state (ciphertext) | the lead who subcontracted the job |

## Who sees what

- **You, as client:** for each *valid* finding you get the attacker's payload and up to 600 characters of your model's
  answer around the leak. That includes a valid finding marked `unpaid` (budget exhausted or duplicate payload): the
  report is stored in the same callback whether or not the payout succeeds. If the payload is too long for the report
  size cap, it is truncated and the report says `payload_truncated: true`. Its full sha256 is still in the record.
- **You, as lead:** for findings in your subjobs you get the same report with every occurrence of the client's canary
  replaced by `[CANARY]`. You verify your subcontractor's work without learning the client's secret.
- **You, as attacker:** nothing new. You already know your payload. You never see the canary or the system prompt.
- **Nobody:**
  - the payload of an **invalid** finding: no report is created, so a failed attempt never hands your work to the
    client for free;
  - the enclave's private key: it was generated in a TEE and is released only to the published program;
  - the canary, except the client who chose it.

## Copying ciphertexts doesn't help

Ciphertexts are public, so someone could copy them into a job of their own. The enclave refuses that:
- a target only works in jobs of the client whose key is sealed inside it;
- a payload only works in the job it was sealed for.

A copied target is rejected with `TARGET_BINDING_MISMATCH`, and a copied payload with `PAYLOAD_BINDING_MISMATCH` (with
a strike). Both checks happen before the model is called. They are tested on testnet in txs `EV8EYd2J…` and
`BiHNsms5…` (`enclave/DEPLOYMENTS.md`).

## What leaks anyway

Be aware of what sealing does *not* hide:
- **Metadata:** who submitted, to which job, when, the category, and the outcome.
- **Rough sizes:** ciphertext length reveals the approximate length of the payload or system prompt.
- **The model id** of live targets, in the callback output.

## Whom you trust

- **Intel TDX** and OutLayer's attested workers keep the enclave's memory private from the machine's operator.
- **NEAR AI** runs live models in TDX + NVIDIA confidential computing. The model sees your system prompt and payload
  inside its TEE.
- **The contract owner stays trusted, but can no longer redeploy.** The contract account's last full-access key was
  deleted at feature freeze (tx `EUpzUJw1b3N8LnEj4N1XY7m6qWCM6SLyXeQmnJDsBqVJ`), so the code is fixed at sha256
  `2063042c…c45047`. The owner can still change the policy and the enclave, which is visible on chain. A new enclave
  can't read ciphertexts sealed to the old one. See the threat model (`enclave/THREAT-MODEL.md`, row 12).

What each of these trusts means, and how to check it, is in [Attestation](25-attestation.md).
