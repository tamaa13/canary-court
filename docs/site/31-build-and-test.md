---
title: Build and test
description: How to build each part reproducibly, run every test suite, and re-check our published results yourself.
section: Operate
order: 31
---

# Build and test

Everything here runs offline unless it says **testnet**. You need Node 24 and pnpm. You need Rust only for the contract and the enclave.

## Contracts

```bash
cd contracts
cargo test -p redteam -p tusdc     # unit tests, incl. a simulated OutLayer callback
scripts/test-sandbox.sh            # near-workspaces: real promise chain against a mock OutLayer, real NEP-141
```

There are [86 unit tests and 12 sandbox tests](https://github.com/tamaa13/canary-court/tree/main/contracts). The sandbox suite runs the main flow and all attack scenarios on a local chain.

## Enclave

```bash
cd enclave
cargo test                          # host tests
./build.sh                          # reproducible wasm, rustc 1.88 pinned; prints its sha256
(cd verify && npm install && node verify.mjs enclave)   # testnet, read-only: check the live deployment
```

The build is reproducible. The sha256 that `./build.sh` prints must equal the hash the contract pins in `get_config().enclave_code`. For enclave v0.1.3 that is `c1b1ac5c…0d0cdf` ([`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)).

`verify.mjs` also takes `finding <tx> <signer>` (one evaluation end to end) and `model <model_id>` (a fresh-nonce NEAR AI attestation).

## Agents

```bash
cd agents
pnpm install
pnpm test                    # unit tests, ECIES vectors, attack scenarios
pnpm demo --dry-run          # the full market in-process: no keys, no network
pnpm attacks --dry-run       # 5 attack scenarios in-process: all 21 expectations held, PASS S1…S5
```

The live versions (`pnpm demo`, `pnpm attacks`) run on testnet and need funded keys. See [`agents/README.md`](https://github.com/tamaa13/canary-court/blob/main/agents/README.md).

## End-to-end harness

```bash
cd web
pnpm install
pnpm typecheck
pnpm test                    # harness self-test: 12 injected spec violations, each must be caught
pnpm e2e:mock                # 54 steps against an in-process model of the contract + enclave: 52 pass, 2 n/a (testnet-only)
pnpm e2e:testnet             # testnet: prints the cost, then exits
pnpm e2e:testnet --yes       # testnet: the full run, ~30 min, 7 throwaway accounts
```

The live run creates fresh accounts, funds them, runs the whole market, checks every rule, and deletes the accounts. A step that ran but had nothing to check (for example the timeout path when no timeout happened) is reported as n/a, never as a pass. Most of the NEAR comes back to the funder. A run spends the OutLayer fees ([0.02 NEAR](https://github.com/tamaa13/canary-court/blob/main/contracts/VIEWS.md) per attack, minus refunds) and gas. Set `E2E_TARGET_MODEL=Qwen/Qwen3.6-35B-A3B-FP8` to use live TEE inference instead of the enclave's deterministic mock target. [`web/e2e/README.md`](https://github.com/tamaa13/canary-court/blob/main/web/e2e/README.md) explains how to read a report.

## Re-check our published results

These commands only read from chain; they never sign. Run them from `web/`.

| You want to check | Run | Our result |
|---|---|---|
| the final release run | read [`release-final.md`](https://github.com/tamaa13/canary-court/blob/main/web/e2e/reports/release-final.md) | 54 steps on enclave v0.1.3: 53 pass, 1 not exercised (07.5) |
| the attestation chain of that run | `pnpm verify:attestation e2e/reports/release-final-v0.1.3-fgm7h6.json out.json` | [64/64](https://github.com/tamaa13/canary-court/blob/main/web/e2e/reports/release-final-v0.1.3-reverify-0508.json) |
| infrastructure incidents of a run | `pnpm verify:incidents out.json fgm7h6` | [0](https://github.com/tamaa13/canary-court/blob/main/web/e2e/reports/release-final-v0.1.3-incidents.json) |
| the treasury demo fixture | `pnpm verify:demo ../agents/fixtures/demo-receipts.json out.md` | [95/95](https://github.com/tamaa13/canary-court/blob/main/web/e2e/reports/demo-verify-treasury.md) |
| the live contract's state | `pnpm e2e:probe` | n/a |

The public RPC endpoints rate-limit per IP. The tools back off and retry. If one still fails with HTTP 429, wait a minute and run it again.

## Dashboard

```bash
cd site
pnpm install
pnpm dev          # http://localhost:3100 and /app
```
