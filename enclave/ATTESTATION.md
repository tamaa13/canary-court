# Canary Court: verifying the enclave (Proof › Enclave & model panel)

Everything below is checkable by anyone from public endpoints. The browser can do it too: NEAR RPC,
nearblocks, FastFS and NEAR AI Cloud all send CORS headers. `verify/verify.mjs` implements
every check (Node ≥ 20 or browser, deps: `@noble/curves`, `@noble/hashes`):

```bash
cd enclave/verify && npm i
node verify.mjs enclave                          # 1 + 2
node verify.mjs finding <submit_finding tx> <signer>   # 3 + 4 (+ 5 if live)
node verify.mjs model Qwen/Qwen3.6-35B-A3B-FP8 [addr]  # 5, fresh nonce
```
```js
import { verifyEnclave, verifyFinding, verifyModelAttestation, TESTNET } from './verify.mjs';
// each returns { ok, checks: [{ id, label, ok: true|false|null, detail }], ... }
```

## The trust chain

```
redteam.arifnovrian.testnet ──request_execution──▶ outlayer.testnet ──▶ TEE worker (Intel TDX)
  enclave_code = WasmUrl{hash H}                                              │ runs wasm with sha256 H
                                                          keystore (TEE) ─────┤ releases PROTECTED_ENCLAVE_KEY only if
                                                                              │ wasm == H and predecessor == redteam
                                                                              ▼
                                               NEAR AI Cloud (TDX + NVIDIA Hopper CC) model, signs each response
  resolve tx ◀── worker key registered on-chain only after its TDX quote verified (5 measurements)
```

## 1. Enclave code (`verify.mjs enclave`)
| check | source | proves |
|---|---|---|
| `config.code` | `redteam.get_config().enclave_code.WasmUrl.hash` = published build (v0.1.3 `c1b1ac5c…8f0d0cdf`, pinned in verify.mjs) | the contract points at the published build |
| `code.bytes` | `sha256(GET enclave_code.WasmUrl.url)` = H | the hosted bytes are that build (the worker also checks this before running) |
| (manual) | `cd enclave && ./build.sh` → H | the build is reproducible from this repo (rustc 1.88 pinned, `Cargo.lock`, paths remapped) |

## 2. Key custody (`verify.mjs enclave`)
| check | source | proves |
|---|---|---|
| `config.pubkey` | `get_config().enclave_pubkey` = `091e7c1b…72d5e542` = output of `op:pubkey` run by OutLayer (v0.1.3 tx `23dyfUhJkssnD7LeT8RKUUFiiehGmxchjje4S65Nv9VY`) | the key everyone encrypts to belongs to that build |
| `key.bound` | `outlayer.testnet.get_secrets({accessor:{WasmHash:{hash:H}}, profile:"enclave", owner:"arifnovrian.testnet"})` | the private key is released only to wasm H (another build gets nothing; tested on testnet) |
| `key.locked` | same row: `access == {"Predecessor":{"condition":{"Whitelist":{"accounts":["redteam.arifnovrian.testnet"]}}}}` | only executions requested **by the contract** see the key. Evidence: a direct owner call is refused (v0.1.0 tx `8HFMVHTGYvesofXAhadev37QaRB3Za6qecPPVcZUcM7x`, same mechanism) |

The key itself was generated inside OutLayer's keystore TEE (`outlayer secrets set --generate PROTECTED_ENCLAVE_KEY:hex32`).
No human ever saw it. In addition, the module refuses `evaluate` unless `NEAR_PREDECESSOR_ID == redteam.arifnovrian.testnet`
(a constant compiled into H).

## 3. One finding (`verify.mjs finding <tx> <signer>`)
From `EXPERIMENTAL_tx_status` of the `submit_finding` tx. `outlayer.testnet` logs `EVENT_JSON` with `standard: "near-outlayer"`.
| check | field | expect |
|---|---|---|
| `exec.requested` | `execution_requested.data[0].request_data` (JSON string) | present, gives `request_id` |
| `exec.code` | `request_data.code_source.WasmUrl.hash` | H |
| `exec.caller` | `request_data.predecessor_id` | `redteam.arifnovrian.testnet` |
| `exec.secrets` | `request_data.secrets_ref` | `{"profile":"enclave","account_id":"arifnovrian.testnet"}` |
| `exec.completed` | `execution_completed.data[0]` | `success: true` (+ `resources_used`, `payment_charged`) |
| `exec.output` | `outlayer.testnet` receipt whose `SuccessValue` is the module JSON (`v:1`) | the verdict. `llm`, `model` and `model_signatures` are only here; the contract does not store them |

## 4. TEE worker (`worker.tee`)
OutLayer workers post results from `worker.outlayer.testnet` using keys that **register-contract adds only after
verifying the worker's Intel TDX quote** (all 5 measurements, MRTD + RTMR0-3, against an approved list). The verifier
locates the resolve tx by request_id (nearblocks `txns-only`, cursor = completion timestamp; methods
`resolve_execution` / `submit_execution_output_and_resolve`), then `view_access_key(worker.outlayer.testnet, tx.public_key)`.
That must be a **FunctionCall** key for `outlayer.testnet` limited to the resolve methods (ML-DSA-65 keys on testnet), not FullAccess.

## 5. Model TEE (live findings only)
`output.model_signatures[i] = {chat_id, text, signature, signing_address, signing_algo, bound}`
| check | how | proves |
|---|---|---|
| `bound` | set **inside the enclave**: `text == "<model>:<sha256(request bytes)>:<sha256(response bytes)>"` | the signed text covers exactly the exchange the enclave had (hashes only, no plaintext) |
| `model.sigN` | `ecrecover(EIP-191 personal_sign(text), signature) == signing_address` | NEAR AI's model key signed it |
| `att.nonce` | `GET https://cloud-api.near.ai/v1/attestation/report?model=<m>&nonce=<fresh 32B hex>&signing_algo=ecdsa` → `model_attestations[*].request_nonce == nonce` | freshness (no replayed report) |
| `att.addr` | `model_attestations[*].signing_address == signing_address` | the response key is the attested model's key |
| `att.tdx` | `intel_quote[568..632]` (TDX report_data) `== signing_address(20B) ‖ 0×12 ‖ nonce(32B)` | the CVM itself bound key + nonce into its hardware quote |
| `att.gpu` | `nvidia_payload.nonce == nonce`, `evidence_list` (8 observed), `arch: HOPPER` | GPU confidential-computing evidence for the same nonce |
| `att.external` | (not automated) submit `intel_quote` to an Intel DCAP verifier and `nvidia_payload` to NVIDIA NRAS | quote/GPU signature chains up to Intel/NVIDIA roots |

## 6. Report integrity (client side)
After decrypting `report_for_client` with the client's x25519 key: `sha256(report.record_json) == finding.result_hash`
(hash the string verbatim) and `record.payload_sha256 == sha256(report.payload)`. The same `result_hash` is
the strike evidence for manipulation findings.

## Sample output (`verify.mjs finding`, v0.1.3 sanity evaluation, mock target, dual)
```text
true  exec.requested | request_id 40427, signer rtc-sanity.arifnovrian.testnet
true  exec.code      | code_source sha256 c1b1ac5cd1…0d0cdf
true  exec.caller    | predecessor redteam.arifnovrian.testnet
true  exec.secrets   | {"profile":"enclave","account_id":"arifnovrian.testnet"}
true  exec.completed | success=true, 1335 ms, charged 1133501200000000000000 yN
true  exec.output    | valid=true severity=high manipulation=false error=null llm=mock
true  worker.tee     | resolve_execution tx 6ZneVPoL…fc3aXs signed by ml-dsa-65 key (function-call key added by register-contract after TDX quote check)
null  model.sigs     | llm=mock (mock target: no model)
```
(tx `5vPYHdcxUdXhS5fwsbJQUBYMdKMHor9QiKJpR5u8R37a`)

## What this does NOT prove (be honest in the UI)
- That the OutLayer coordinator delivered the *request* faithfully. It cannot forge results, but it queues requests.
  The enclave's own predecessor check relies on the same request data.
- Intel/NVIDIA signature chains are not verified by `verify.mjs` (`att.external` = null).
- Mock-mode findings involve no model at all (`llm: "mock"`), so the panel must say so.
