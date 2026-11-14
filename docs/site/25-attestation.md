---
title: Attestation
description: How anyone can verify that a verdict came from the published enclave in a TEE, and what that does not prove.
section: Reference
order: 25
---

# Attestation

You don't have to trust us that verdicts come from the published program running in a TEE. Every check below uses
public data only: NEAR RPC, the nearblocks indexer, FastFS and NEAR AI Cloud. All of them allow browser requests,
so the dashboard runs the same code as the CLI.

```bash
cd enclave/verify && npm install
node verify.mjs enclave                              # the deployment
node verify.mjs finding <submit_finding tx> <signer> # one finding (+ fresh model attestation if live)
node verify.mjs model Qwen/Qwen3.6-35B-A3B-FP8       # a model's TEE, with a fresh nonce
```
Each check returns `ok: true | false | null`. `null` means not applicable, e.g. a mock target has no model to check.

## 1. Is the contract using the published program?

| Check | What is compared |
|---|---|
| `config.code` | `redteam.get_config().enclave_code.WasmUrl.hash` = published sha256 `c1b1ac5c…0d0cdf` |
| `code.bytes` | sha256 of the bytes served at that URL = the same hash |

You can rebuild it yourself: `cd enclave && ./build.sh` produces the same hash. The toolchain is pinned to rustc 1.88,
the dependencies come from `Cargo.lock`, and local paths are remapped.

## 2. Is the key only usable by that program, via the contract?

| Check | What is compared |
|---|---|
| `key.bound` | `outlayer.testnet.get_secrets(...)` shows the key is bound to that exact wasm hash |
| `key.locked` | the same row's access rule = "only calls coming from `redteam.arifnovrian.testnet`" |
| `config.pubkey` | `get_config().enclave_pubkey` = the key the program printed on OutLayer (`op:pubkey`, tx `23dyfUhJ…`) |

## 3. Did this finding really run that program?

`verify.mjs finding` reads the `submit_finding` transaction:

| Check | Source |
|---|---|
| `exec.code`, `exec.caller`, `exec.secrets` | OutLayer's `execution_requested` event: program hash, requesting contract, secret profile |
| `exec.completed`, `exec.output` | OutLayer's `execution_completed` event and the program's output in the receipt |
| `worker.tee` | the tx that delivered the result was signed by a worker key that OutLayer's register contract added only after verifying the worker's Intel TDX quote (a function-call key, not a full-access key) |

## 4. Did a TEE model produce the answer? (live targets)

- `model.sigN`: NEAR AI's signature over `model:sha256(request):sha256(response)` recovers to the model's signing
  address. The enclave already checked that those hashes match the exact bytes it sent and received (`bound: true`).
  The enclave attaches a signature whenever NEAR AI returns one. A missing signature does not block the verdict, and
  then `model.sigs` fails, so check it. The final release run had 7/7 signed (`web/e2e/reports/release-final.md`).
- `att.*`: a fresh attestation report requested with a random nonce:
  - the nonce comes back;
  - the signing address is the same;
  - the Intel TDX quote's report data contains `signing address ‖ nonce`;
  - the NVIDIA GPU evidence carries the same nonce.

## Example

The v0.1.3 sanity evaluation, tx `5vPYHdcxUdXhS5fwsbJQUBYMdKMHor9QiKJpR5u8R37a`:
```text
true  exec.code      | code_source sha256 c1b1ac5cd1…0d0cdf
true  exec.caller    | predecessor redteam.arifnovrian.testnet
true  exec.completed | success=true, 1335 ms
true  exec.output    | valid=true severity=high manipulation=false error=null llm=mock
true  worker.tee     | resolve_execution tx 6ZneVPoL…fc3aXs signed by ml-dsa-65 key
null  model.sigs     | llm=mock (mock target: no model)
```

## What this does not prove

- **Certificate chains.** `verify.mjs` checks that the Intel and NVIDIA evidence is bound to your nonce, but not the
  signature chains up to Intel and NVIDIA. Submit `intel_quote` and `nvidia_payload` to an external verifier for that.
- **Request delivery.** OutLayer's coordinator can delay or drop requests. It cannot forge a result that passes these
  checks.
- **The contract owner stays trusted.** Until freeze it can redeploy the contract. After freeze it can still change the
  policy and the enclave; both are visible on chain (`config.code` above catches an enclave change).
- **Mock targets** involve no model at all: a canned stub that ignores the system prompt. The output says `llm: "mock"`.

The full threat model, with evidence for each mitigation, is in `enclave/THREAT-MODEL.md`.
