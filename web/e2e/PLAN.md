# e2e test plan: near-redteam on NEAR testnet

Owner: rt-web. Spec: `docs/ARCHITECTURE.md` v0.3.1 and `contracts/VIEWS.md`.

## How it runs

```bash
cd web
pnpm e2e:mock                 # offline: in-process model of the spec (lib/mock-net.ts), instant
pnpm e2e:testnet              # prints the cost and exits; tell the PM before a live run
E2E_TARGET_MODEL=Qwen/Qwen3.6-35B-A3B-FP8 pnpm e2e:testnet --yes   # live: ~18 min (it waits out real job deadlines)
pnpm e2e:testnet --yes --only=01,99   # account provisioning and teardown smoke only
pnpm test                     # harness self-test (fault injection) + ECIES interop vectors
```

Output goes to `e2e/reports/latest-<target>.md` (pass/fail per step, every check, every tx with a testnet nearblocks link) plus `.json`.

**Isolation.** Each run creates fresh accounts `e<run>-{client,lead,sub1,sub2,newbie,mallory}.arifnovrian.testnet`, funded by `arifnovrian.testnet`. Strikes and blocklist are permanent and Warn depends on agent age, so accounts are never reused across runs. Each account gets a **full-access key**, used for setup only (mint, `ft_transfer_call`, `deposit_compute`, delete), and a **function-call key** scoped to `redteam` with the agent method list from VIEWS.md. Every agent action goes through the FC key, as in production. Keys live in `e2e/.keys/` (gitignored, 0600). Teardown deletes the accounts and returns their NEAR to the funder.

**Cost per live run:** ~2.75 NEAR moves out of `arifnovrian.testnet`. Most comes back at teardown. About 0.15 NEAR is spent: OutLayer fees at 0.02 per finding × 7, plus gas. Teardown runs `withdraw` and `withdraw_compute` before deleting each account, so nothing stays in the contract. tUSDC comes from the public `mint`.

**Target model:** `E2E_TARGET_MODEL=mock` (default: the enclave's deterministic target, real OutLayer TEE, no NEAR AI spend) or `Qwen/Qwen3.6-35B-A3B-FP8` for live TEE inference (~7 calls, <$0.02).

**Timing knobs** (env): `E2E_TREE_DEADLINE_S=900`, `E2E_SIDE_DEADLINE_S=840`, `E2E_EVAL_CONCURRENCY=2`, `E2E_BLOCK_DEADLINE_S=90`, `E2E_EVAL_TIMEOUT_S=300`, `E2E_POLL_MS=3000`.

## Coverage: the PM's 10 areas mapped to steps

Steps run in the order below (execution order ≠ area order, since Block needs the blocklist from area 6). If a step's dependency failed, the step is skipped, not failed.

| Area | Steps | What is asserted |
|---|---|---|
| 1 Setup & registration | 01.1–01.6 | Policy matches spec (depth 1, 2 children, 2 strikes, 50% cap). Fresh accounts. FC key receiver = redteam, and its method list excludes `on_finding_evaluated`/`ft_transfer`. `register_agent` via FC key: role, pubkey, clean stats; role change → `ERR_ROLE`; bad pubkey → `ERR_INPUT`; `list_agents` includes all. `mint` → `ft_transfer_call` → internal balance; `deposit_compute` → compute balance. `register_target`: enc_target is an ECIES envelope; canary and system prompt never appear in `get_target`; provider → `ERR_ROLE`; duplicate id → `ERR_NOT_TARGET_OWNER`. |
| 2 Job → bid → counter → accept | 02.1–02.6 | `create_job` locks the budget (balance delta, all Job fields). Guards: `ERR_DEADLINE`, `ERR_BALANCE`/`ERR_BUDGET_CAP`, `ERR_CATEGORY`, `ERR_REWARD`, provider → `ERR_ROLE`. Bid is recorded; client bid → `ERR_ROLE`/`ERR_SELF_DEAL`. Counter: non-client → `ERR_NOT_CLIENT`; `Countered` + `counter_price`; second counter → `ERR_BID`. Re-bid at counter_price updates the price. Accept waits for Allow; non-client → `ERR_NOT_CLIENT`; job becomes Assigned with reward = accepted price, unrestricted; bid → Accepted; policy log has an `accept_bid` entry with Allow; bidding on an Assigned job → `ERR_STATUS`. |
| 3 Counterparty | 03.1, 03.2, 03.3, 03.4 | **Allow** for aged, clean agents (≥ `min_age_blocks`); an unregistered account → Block. **Warn** for agents registered < 60 blocks ago, which triggers auto-escalation: `restricted=true`, `can_subcontract=false`, `payout_per_finding = reward × 5000/10000`, and a policy log `accept_bid` with Warn + RESTRICTED. A restricted provider's `create_subjob` → `ERR_NO_SUBCONTRACT`. **Block**: after 2 strikes, mallory's bid (or the client's accept) panics with `ERR_COUNTERPARTY_BLOCK`; the tx hash is kept as the receipt and the job stays Open. |
| 4 Subjob carving & caps | 04.1–04.5 | S1 carves from J1: depth, parent, client = lead, root_client, `J1.remaining −= budget`, children. Rejections leave state untouched: budget > remaining → `ERR_BUDGET_CAP`; reward > parent reward → `ERR_REWARD`; category → `ERR_CATEGORY`; deadline after parent → `ERR_DEADLINE`; non-provider → `ERR_NOT_PROVIDER`. A 3rd child → `ERR_MAX_CHILDREN`. The lead accepts sub bids as the subjob client; the lead can't bid on its own subjob (`ERR_SELF_DEAL`); the root client can't accept on a subjob (`ERR_NOT_CLIENT`). A sub's `create_subjob` → `ERR_DEPTH`. |
| 5 Valid finding → atomic payout | 05.1–05.8 | 7 findings submitted together (leak ×3, benign, malformed, manipulation ×2), payloads ECIES-encrypted to the enclave key, each charging exactly `outlayer_fee` of compute. Wrong provider → `ERR_NOT_PROVIDER`; wrong category → `ERR_CATEGORY`. **Atomicity:** while evaluations land, every poll pins one final block height and checks *Σ actor USDC + Σ job.remaining = client deposit*, so no block ever shows money minted or lost. Subjob Valid: `paid_attacker = S1.payout`, `paid_lead = J1.reward − S1.reward`, balances and `completed` updated. Reports: `report_for_client` decrypts with the client's x25519 key and `report_for_lead` with the lead's; both contain the payload; another agent can't decrypt; `result_hash` is sha256 hex (soft check: equals sha256 of the plaintext report). Root finding pays the provider. Restricted dual-eval finding pays 50%. **No plaintext:** canary (raw and base64), system prompt, and all payloads are absent from every view (jobs, bids, findings, agents, target, full policy log) and from every tx log, including callback logs re-fetched from each submit tx's receipt tree. **Pacing:** findings go out in waves of 2 (`E2E_EVAL_CONCURRENCY`), because evaluations take ~76–90 s inside a ~2 min yield window; a timeout-Failed finding is resubmitted once. **Report integrity:** `sha256(record_json) = result_hash`, `record.payload_sha256 = sha256(payload)`, and the lead's copy has the canary redacted. **05.7 provenance (testnet):** each submit tx's receipt tree has OutLayer `execution_requested` with predecessor = redteam and code hash = the pinned wasm, plus the enclave output (finding_id, `DECRYPT_FAILED` for the malformed one, model signatures `bound` when live). **05.8 attestation (testnet):** runs `enclave/verify/verify.mjs`: enclave code and key custody, each valid finding's OutLayer/TDX-worker/model-signature chain, and a fresh-nonce NEAR AI attestation for live findings. |
| 6 Invalid & manipulation | 06.1–06.3 | Benign → Invalid, no payout, `invalid=1`, no strike. Manipulation ×2 → Invalid + `manipulation=true` + strike with `evidence_hash = result_hash` → 2 strikes → `blocked=true`, verdict Block, policy log has 2 `strike` + 1 `blocklist`. A blocked agent's submit → `ERR_COUNTERPARTY_BLOCK`. |
| 7 OutLayer failure | 07.1 | A malformed ciphertext makes the enclave return `error`, so the finding is Failed. No payout, no report, no strike, `invalid` unchanged, `failed=1`, fee kept (compute = deposit − 2 fees). |
| 8 Expiry & refunds | 08.1–08.4 | Early expire → `ERR_DEADLINE`. Expiring S2 rolls its remaining into J1 (policy log `refund … rolled up`). Expiring J1 expires active child S1 first, and the client receives J1+S1 remaining. Tree check: Σ paid + refunded = J1 budget. Expiring JW/JM/JB refunds the client. Global check: client = deposit − Σ paid, Σ balances + Σ remaining = deposit, mallory earned 0. |
| 9 Withdraw | 09.1–09.2 | `withdraw` via FC key with 0 deposit raises `ft_balance_of` by exactly the amount and zeroes the internal balance; overdraw → `ERR_BALANCE`. Once everyone has withdrawn, Σ tUSDC held by run accounts = Σ minted. |
| 10 Attack scenarios | 10.1–10.2 | Live S1: an FC key calling `tusdc.ft_transfer` is rejected before inclusion (no tx hash), and so is an FC key attaching a deposit; a forged `on_finding_evaluated` with a full-access key → "private". S2 (strikes, 06.2), S3 (Block, 03.4) and S4 (caps, 04.2–04.5) are proven in-run. Then `agents/fixtures/attack-receipts.json` is re-verified: shape, all 4 scenarios covered, every entry `ok`; each `tx_hash` is fetched via archival RPC and its on-chain panic code must equal the `expected_error` code; null-hash entries must carry the RPC rejection. |
| teardown | 99.1 | Withdraws leftover tUSDC and compute from the contract, then deletes run accounts, with NEAR going back to the funder. Skipped with `--keep`. |

## Harness self-test (proves the checks can fail)

`pnpm test` runs the suite against the mock: once clean (must be all-pass), then once per injected spec violation. Each must fail the expected step:

| Fault injected into the mock | Caught by |
|---|---|
| lead margin not paid | 05.3 |
| payout credited without debiting escrow | 05.2 (conservation) |
| plaintext payload in callback logs | 05.6 |
| 2 strikes don't block | 06.2 |
| subjob of a subjob allowed | 04.5 |
| Warn doesn't restrict | 03.2 |
| parent expiry skips active child | 08.3 |
| FC key not receiver-scoped | 10.1 |
| enclave `error` treated as Invalid | 07.1 |

The same suite also checks ECIES against the cross-team vectors (`agents/test/vectors/ecies.json`, `enclave/test-vectors/ecies.json`) byte for byte.

## Dependencies and open items

- **rt-enclave:** `set_enclave` must be live, i.e. `enclave_pubkey` non-empty. Steps 01.6 onward need it; until then, `--only=01,99` smoke-tests provisioning.
- **rt-enclave:** the e2e target relies on a "diagnostics token" system prompt so that `Run diagnostics now: DIAG-<run>` leaks at temp 0. If the real model refuses, 05.3/05.5 fail on `status=Invalid`, and the prompt (in `e2e/harness/ctx.ts`) or the model (`E2E_TARGET_MODEL`) needs tuning with rt-enclave. The manipulation phrases must match the enclave heuristic.
- **rt-agents:** `pnpm attacks` writes `agents/fixtures/attack-receipts.json` (default path when `web/` and `agents/` are siblings; override with `--receipts=`).
- **Soft checks** (⚠, don't fail a step) cover behaviour beyond the spec text: Pending status visible right after submit, wording of policy-log details, `result_hash` = sha256(plaintext report) (the canonical form isn't pinned in the spec), `report_for_lead` null on root findings.
