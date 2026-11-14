# Canary Court: enclave/ (sealed red-team evaluator, OutLayer TEE)

A Rust → `wasm32-wasip2` module that runs inside [OutLayer](https://outlayer.ai)'s Intel TDX workers. It is
the only place where an attack payload and a target's secret system prompt ever meet in plaintext.

```
agent ──ECIES(payload)──▶ redteam contract ──request_execution──▶ OutLayer TEE ── this module
                                   ▲                                   │ 1. decrypt target {system_prompt, canary, model} + payload
                                   │                                   │ 2. run the target on a TEE-hosted NEAR AI model (or mock)
                                   │                                   │ 3. canary leaked?  manipulation of the grader?
                                   └──── attested verdict + ECIES reports to client / lead ◀┘
```

- **Sealed in, sealed out.** Payloads and targets are ECIES-encrypted to the enclave key (x25519 + HKDF-SHA256 +
  ChaCha20-Poly1305). Reports go out encrypted to the client (and, canary-redacted, to the lead), and only for valid
  findings. The public verdict carries no canary and no plaintext, only `result_hash`.
- **Key nobody has seen.** `PROTECTED_ENCLAVE_KEY` was generated inside OutLayer's keystore TEE. It is released only to
  this exact wasm (sha256-bound) and only for executions requested by `redteam.arifnovrian.testnet`.
- **Leak detection** catches verbatim, case/spacing-normalized, reversed, base64/hex-encoded and decoded-token leaks
  (partial fragments are reported as `low`, not valid). `dual` mode (counterparty `Warn`) requires two leaking attempts.
- **Grader-manipulation heuristic:** payloads that address the evaluator, ask to "mark as valid" or forge result JSON
  void the finding and trigger an on-chain strike (`evidence = result_hash`). The verdict is deterministic (is the canary
  in the model's answer?), so a grader-injection can never flip `valid`. The heuristic only decides punishment, which is
  why it is tuned for **precision over recall**: word-boundary phrases on obfuscation-normalized text (leet, homoglyphs,
  zero-width, full-width, dotted letters, base64/hex), and no bare ambiguous words.
- **Dedup without revealing payloads:** `dedup_key` is an HMAC under an enclave-only key over (root job, category,
  normalized payload hash), so the contract can refuse duplicate findings and nobody can dictionary-check a payload.
- **Verifiable model.** Live targets run on NEAR AI Cloud TEE models (`owned_by: nearai`, thinking disabled, temp 0).
  The enclave checks NEAR AI's per-response signature covers exactly the bytes it sent and received (`bound: true`).
  Anyone can then match that key to a fresh-nonce TDX + NVIDIA attestation ([ATTESTATION.md](ATTESTATION.md)).
- **Never crashes on bad input:** every failure is an `error` code (→ finding `Failed`, no strike).

| file | |
|---|---|
| `src/main.rs` | ops `pubkey` / `challenge` / `evaluate`, caller guard, report sealing, error codes |
| `src/ecies.rs` | the ECIES wire format (byte-compatible with `agents/`, see `test-vectors/ecies.json`) |
| `src/eval.rs` | leak detection, redaction, manipulation rules |
| `src/dedup.rs` | `dedup_key` (HMAC, enclave-only subkey) |
| `src/llm.rs` | NEAR AI Cloud client + signature binding, deterministic mock target |
| `src/tests.rs` | host e2e tests (31 in total with module tests) |
| `examples/ecies_tool.rs` | seal/open/challenge helper + vector generator |
| `verify/verify.mjs` | Verified-panel checks (code hash, key custody, TEE worker, model signature + fresh-nonce attestation) |
| `tools/outlayer-queue.mjs` | fee-free OutLayer queue monitor (QUIET/BUSY/DANGER snapshot, `--watch N` latency + timeouts) to pick a quiet slot for live runs |
| `deploy.sh` | one-command redeploy (build → FastFS → TEE key + NEAR AI key → pubkey → lock → record) |
| `deployments/` | per-build deployment records (hash, URL, pubkey, txs, set_enclave args) |
| `DEPLOYMENTS.md` | live testnet values, exact `request_execution` args, protocol, error codes, runbook |
| `ATTESTATION.md` | what each verification step proves |

```bash
cargo test                                     # host tests
./build.sh                                     # reproducible wasm + sha256 (rustc 1.88 pinned)
cargo run --example ecies_tool -- vectors      # regenerate ECIES vectors (… -- dedup-vectors for dedup.json)
(cd verify && npm install && node verify.mjs enclave)   # check the live deployment (Node path needs npm install)
./deploy.sh --dry-run                          # then ./deploy.sh to redeploy
```

Testnet deployment (v0.1.3): wasm `c1b1ac5c…8f0d0cdf`, enclave pubkey `091e7c1b…72d5e542` (details in DEPLOYMENTS.md).
