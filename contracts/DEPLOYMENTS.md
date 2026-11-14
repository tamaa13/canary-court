# Canary Court deployments (testnet only)

Account names keep the original `redteam` / `tusdc` ids.

| what | account | notes |
|---|---|---|
| escrow | `redteam.arifnovrian.testnet` | owner `arifnovrian.testnet`; token `tusdc.arifnovrian.testnet`; OutLayer `outlayer.testnet` |
| mock USDC | `tusdc.arifnovrian.testnet` | NEP-141, 6 decimals, symbol `tUSDC`, public `mint` ≤ 1000 tUSDC/call |
| OutLayer | `outlayer.testnet` | `request_execution(source, resource_limits?, input_data?, secrets_ref?, response_format?, payer_account_id?, params?)` |

- Code: branch `contracts`, `contracts/redteam`, `contracts/tusdc`. Build with `cd contracts/<crate> && cargo near build non-reproducible-wasm`.
- `redteam` is already registered on `tusdc` (storage_deposit done at deploy), so `ft_transfer_call` to it works immediately.
- Method list, JSON shapes, error codes and events: [VIEWS.md](VIEWS.md).
- Explorer: https://testnet.nearblocks.io/address/redteam.arifnovrian.testnet
- RPC: `https://archival-rpc.testnet.fastnear.com` (near-cli-rs profile `testnet`, the helpers' default; override with `NET=...`). `test.rpc.fastnear.com` rate-limits under load, and `rpc.testnet.near.org` is deprecated (429).
- Sealing: targets must carry `client_pubkey` (the root client's on-chain key) and payloads `job_id` (the job you submit to), encrypted to `get_config.enclave_pubkey`.

## Agent function-call keys
Agents hold **only** a function-call access key: receiver `redteam.arifnovrian.testnet`, allowance e.g. 1 NEAR (gas only), with these methods (all 0-deposit):

```
register_agent, register_target, create_job, place_bid, counter_bid, accept_bid,
create_subjob, submit_finding, expire_job, withdraw, withdraw_compute
```

Not in the list, by design:
- `deposit_compute` (payable) and `tusdc.ft_transfer_call` (1 yocto). These are setup-time only, with the full-access key.
- `set_enclave`/`set_policy` (owner only).
- `on_*` callbacks (private).

Agents never hold a key for `tusdc`. They cannot `ft_transfer`; funds leave only via `redteam.withdraw` / `withdraw_compute`, and only to the caller.

Add such a key (setup script, run with the agent's full-access key):
```bash
near account add-key sub1.arifnovrian.testnet grant-function-call-access \
  --allowance '1 NEAR' --contract-account-id redteam.arifnovrian.testnet \
  --function-names 'register_agent, register_target, create_job, place_bid, counter_bid, accept_bid, create_subjob, submit_finding, expire_job, withdraw, withdraw_compute' \
  autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
```

## Setup per agent (full-access key, once)
```bash
source contracts/scripts/nr.sh            # rt_call / rt_view / tusdc_call / tusdc_view helpers
A=client.arifnovrian.testnet
tusdc_call $A mint '{"amount":"1000000000"}'                                  # 1000 tUSDC, auto-registers storage
tusdc_call $A ft_transfer_call '{"receiver_id":"redteam.arifnovrian.testnet","amount":"500000000","msg":""}' '1 yoctoNEAR' '100.0 Tgas'
rt_call   $A deposit_compute '{}' '0.2 NEAR'                                   # 10 OutLayer fees @ 0.02
rt_view   balance_of '{"account_id":"client.arifnovrian.testnet"}'
```

## Example calls (0-deposit; function-call key is enough)
```bash
PK=<hex x25519 pubkey, 64 chars>
rt_call client.arifnovrian.testnet   register_agent "{\"role\":\"client\",\"x25519_pubkey\":\"$PK\",\"meta\":\"client agent\"}"
rt_call provider.arifnovrian.testnet register_agent "{\"role\":\"provider\",\"x25519_pubkey\":\"$PK\",\"meta\":\"lead\"}"
rt_call client.arifnovrian.testnet   register_target '{"target_id":"support-bot","enc_target":"<b64 ECIES to enclave>","categories":["prompt_injection","tool_misuse"]}'
DL=$(( $(date +%s) * 1000 + 3600000 ))
rt_call client.arifnovrian.testnet   create_job "{\"target_id\":\"support-bot\",\"budget\":\"100000000\",\"reward_per_finding\":\"10000000\",\"categories\":[\"prompt_injection\",\"tool_misuse\"],\"deadline_ms\":$DL}"
rt_call provider.arifnovrian.testnet place_bid '{"job_id":0,"price_per_finding":"12000000","note":"2 specialists"}'
rt_call client.arifnovrian.testnet   counter_bid '{"job_id":0,"bidder":"provider.arifnovrian.testnet","price_per_finding":"10000000"}'
rt_call provider.arifnovrian.testnet place_bid '{"job_id":0,"price_per_finding":"10000000","note":"ok"}'   # accept the counter
rt_call client.arifnovrian.testnet   accept_bid '{"job_id":0,"bidder":"provider.arifnovrian.testnet"}'
rt_call provider.arifnovrian.testnet create_subjob "{\"parent_id\":0,\"budget\":\"30000000\",\"reward_per_finding\":\"6000000\",\"categories\":[\"prompt_injection\"],\"deadline_ms\":$DL}"
rt_call sub1.arifnovrian.testnet     place_bid '{"job_id":1,"price_per_finding":"6000000","note":""}'
rt_call provider.arifnovrian.testnet accept_bid '{"job_id":1,"bidder":"sub1.arifnovrian.testnet"}'
rt_call sub1.arifnovrian.testnet     submit_finding '{"job_id":1,"enc_payload":"<b64 ECIES to enclave>","category":"prompt_injection"}'   # 300 TGas (default in rt_call)
rt_view get_finding '{"finding_id":0}'          # poll until status != "Pending"
rt_call sub1.arifnovrian.testnet     withdraw '{"amount":"6000000"}'
rt_call sub1.arifnovrian.testnet     withdraw_compute '{"amount":"100000000000000000000000"}'   # 0.1 NEAR back (e2e teardown)
rt_call anyone.testnet               expire_job '{"job_id":0}'   # after deadline; children first, refunds roll up
rt_view check_counterparty '{"account_id":"mallory.arifnovrian.testnet"}'
rt_view get_policy_log '{"from":0,"limit":50}'
```

near-api-js: `account.functionCall({contractId, methodName, args, gas: 300_000_000_000_000n, attachedDeposit: 0n})`. Error strings contain `ERR_<CODE>:`.

## Current config
Read it live with `rt_view get_config '{}'`. Testnet policy (owner can change it with `set_policy`):

| field | value |
|---|---|
| `max_budget` | 1000 tUSDC |
| `max_depth` | 1 |
| `max_children` | 2 |
| `min_rep_completed` | 0 |
| `warn_reward_cap_bps` | 5000 |
| `rate_limit_per_hour` | 30 (create_job + create_subjob + register_target) |
| `outlayer_fee` | 0.02 NEAR |
| `allowed_categories` | prompt_injection, tool_misuse, data_exfiltration, jailbreak |
| `min_age_blocks` | 60 (~1 min of Warn for a freshly registered agent) |
| `strikes_to_block` | 2 |
| `max_findings_per_job` | 20 |
| `min_deadline_ms` | 60000 |
| `max_deadline_ms` | 7 d |
| `pending_timeout_ms` | 900000 |

OutLayer `estimate_execution_cost` for the default limits `{max_instructions: 1e10, max_memory_mb: 128, max_execution_seconds: 90}` is 0.010001 NEAR, so the 0.02 fee covers it with margin.

## Owner ops
```bash
rt_call arifnovrian.testnet set_enclave '{"code":{"Project":{"project_id":"<owner>/<name>","version_key":null}},"enclave_pubkey":"<hex64>","secrets_ref":{"profile":"<p>","account_id":"<acct>"},"resource_limits":{"max_instructions":10000000000,"max_memory_mb":128,"max_execution_seconds":90}}'
rt_call arifnovrian.testnet set_policy '{"policy":{ ...full Policy object from get_config... }}'
```

## Deploy log
- 2026-11-13 22:47 WIB: `tusdc` deployed + `new(owner_id=arifnovrian.testnet)`. Code sha256 `68d962958a27551e6bc63dc8516fa9063e255261c555ad3147ba33b47d0f63ca` (re-checked on-chain 2026-11-14).
- 2026-11-13 22:49 WIB: `redteam` deployed + `new(...)`. Code sha256 `e837ad8ae8e04796f1fc8e99b2e9462e2387b5d88e43e198371344cfd1e98bcd`. The enclave was a placeholder until `set_enclave` (see below).
- `redteam` storage_deposit on `tusdc`: tx `EBCLkHgiw4SDkySn3SDKhnVfYufGSUNK9u9tEku7Z9Cx`.
- 2026-11-13 23:08 WIB: `redteam` code upgrade (state-compatible, no migration). Added `withdraw_compute`, and `register_target` now counts toward the rate limit. Code sha256 `7b3c0f2e94a2c48c5d8d29da593ed59f9d5bd8497569ad3d2df4c5a23fd861ec`, tx `9zWa68H3eRJfENd7gTZfadFTCYvDz3enfMaUZU8wP3LP`.
- 2026-11-13 23:21 WIB: `redteam` code upgrade (state-compatible, no migration):
  - result_hash dedup per root job (`duplicate` policy-log action)
  - solvency guard `ERR_STORAGE`, plus the `get_solvency` view and owner-only `resync_compute_liabilities`
  - withdraw callbacks re-credit only on `PromiseError::Failed`
  - Code sha256 `3c2f051521bd34c9088d2faa58ae938f0ab3536d2f6c3e22dbc975e34a709147`, tx `5tzXVfLuVcEaMUVhiNMu4bPfPYPmMtr4CDL3s8QSonzG`.
  - +3 NEAR top-up beforehand (tx `EMNbKczpyGWCA62rGXYGYwrp9gzUYkdBYZ5VTVECSUvE`); the liabilities counter was then persisted via `resync_compute_liabilities`.
- 2026-11-13 23:10 WIB: `set_enclave` → WasmUrl `981db5c8…` (wasm32-wasip2), pubkey `6428e550fa98a79635f928a2ed4cef7b8bc4d3997ffe87b1bcb85d7ec223ac6c`, secrets_ref `{"profile":"enclave","account_id":"arifnovrian.testnet"}`, limits `{1e10, 256 MB, 90 s}` (tx `BdwnYZzBU4SNzSZ1HMK7B6xxXJCGNVW4Pc9ZKWR9tKk2`).
  - First live evaluation: tx `HQqbqC9sLY4EB53p3KFKcjvZauNSUuYav9n9LGQaTovn` (OutLayer request 39425): job 4 / finding 0 → Valid/high, 2 tUSDC paid, ~76 s.
- 2026-11-13 23:27 WIB: `redteam` code upgrade (state-compatible). Changes:
  - dedup on the enclave `dedup_key` (falls back to result_hash), with `root_job_id` sent to the enclave
  - C1 `ERR_TARGET_LOCKED`; C2 `ERR_KEY_LOCKED` / `ERR_BAD_KEY`
  - C4 strict output validation; C5 code in `enclave_updated`; C6 `client_fault` fee refund
  - Code sha256 `68f9fb693c60ffc496c110ad9f0bbb206bf508d6c5e980444a78247bacc4197b`, tx `DCuGznkn6uzpJ5aLH61VbsE1YGK53pjjrTUYx6hJp2mP`.
- 2026-11-13 23:29 WIB: `set_enclave` → enclave **v0.1.1**. WasmUrl `df9880fc8740ab108123ca7493953dd09a9f84f64efd660443cfb6d78ea12f98`, pubkey `e73962ea23aafed8275bb36212fce296f26c94edce5018de6a094ac7dbc9073b`, tx `HueXtXoCSG3pmQwaxmMCtii2z9H5WQrXPQ1LoGqP3szy`. **Targets sealed to the old pubkey (6428e550…) no longer decrypt; re-register targets** (they fail as client-fault `TARGET_DECRYPT_FAILED`, fee refunded).
  - Sanity: target `rtc-mock-v011` (mock model), job 8.
  - Finding 5: tx `r1aCZECvdgJNPxfy2HaA8fRiFm6hisY8erAYfP7je3C` → Valid/high, paid 2 tUSDC (~23 s).
  - Finding 6: same attack in a fresh ciphertext, tx `4vCDwU2ceBdAakrKQYazxxrVeJEHhPvGeTPh5rPvmCRn` → different result_hash, same dedup_key → Valid + unpaid, policy log `duplicate`.
- 2026-11-13 23:55 WIB: `redteam` code upgrade (state-compatible) for enclave v0.1.2:
  - `TARGET_BINDING_MISMATCH` joins the client-fault refund list
  - `PAYLOAD_BINDING_MISMATCH` strikes only with a contract-verified `sha256(error_record) == result_hash`
  - Canary Court naming in rustdoc/Cargo/memo
  - Code sha256 `c81bd1645aa7c6b82b38a71aa4d980c5b3b7a4bd41a95a93a11d44c9ff4f5d09`, tx `4WzhPtt2FgZi418a2k4w4sZg5q6DB7YEFcceTx7EYZ7d`.
- 2026-11-14 00:00 WIB: `set_enclave` → enclave **v0.1.2**. WasmUrl `1ab104255db5223df8352923e02f9cb042e3f546f115ba8d727eab0147c5f28a`, pubkey `edcfab71a2cda4b744f60030354b86b3cd6f0db32f85986088fdc23500e83f5c`, tx `59kJjHd5FFjmVHN4RB7Qsct8BxwcqwGpeYXMyAEraJsj`.
  - Targets must now be sealed with `client_pubkey` (= the root client's registered key), and payloads with `job_id`.
  - Sanity ($0, mock targets):
    - job 16, bound: tx `FYhMAFGXdPFsg8D6ADt8aBKhjisMd1tFWnPHCqckS8Gx` → Valid/high, paid.
    - job 17, target bound to another client: tx `EV8EYd2JvzjSJjQU44qfACf9fqptPQkaeFat8fKTNp4S` → Failed `TARGET_BINDING_MISMATCH`, `client_fault`, fee refunded.
    - job 18, payload sealed for job 16, submitted by throwaway `rtc-sanity.arifnovrian.testnet`: tx `BiHNsms5JUyEUtMLrXAjj9qPfu7n3T86hrctHRr4897h` → Failed `PAYLOAD_BINDING_MISMATCH` + strike, evidence `deb497e517df12adb7fd3df003722ca36d465f672f7295d4b78d28a6c1d8523e` (verified on-chain).
- 2026-11-14 00:08 WIB: `redteam` code upgrade (state-compatible). **Fix:** the lead margin is paid only when the sub's leg is paid. Before this, an unpaid sub finding (subjob budget exhausted) still paid the lead its margin from the parent escrow. rt-agents found it live on findings 20/22 (policy seq 79-84). Code sha256 `f05e3dc9362b62f5947cd78a11c70c4214c616cc402685525f0ed2fb570ff880`, tx `6caAHEDYcu6EZHEV5FfSHsnDmeRdPzYRt2uH1q6BmJPP`.
- 2026-11-14 00:31 WIB: `redteam` code upgrade (state-compatible). On a null output or promise failure (OutLayer queue/yield timeout), refund `fee − outlayer_max_charge` to the attacker. That's exactly 0.009 NEAR with the current limits; see `get_config.infra_refund`. Logged `infra_timeout`, not counted in `agent.failed`. Code sha256 `2063042cbda558b0e571bf9bd4ea831dd78fede7bebf02fd86a4276616c45047`, tx `DeZNEin5PNeHVHoAFaaBVog7UtMHVqX9sFj9bkjFCPNm`. **Current lock.sh candidate.**
- 2026-11-14 02:47 WIB: `set_enclave` → enclave **v0.1.3** (manipulation-heuristic precision fix for treasury payloads; no interface change). WasmUrl `c1b1ac5cd1a270880554a321f2a6736858fdac1b00964763f71c26498f0d0cdf`, pubkey `091e7c1b45f635f3015ce7dff55fdbc0944f52abf7190f7b8dd0e7b572d5e542`, tx `DCoezLFAoJJfAeEiBuy1wiZ1yWx9wxgGtn5GaizEa7S8`.
  - 0 findings were Pending before and after the switch; secrets_ref and limits are unchanged; contract code is still `2063042c…`.
  - Targets must be re-sealed to the new pubkey.
  - Sanity: job 73 / finding 72, tx `5vPYHdcxUdXhS5fwsbJQUBYMdKMHor9QiKJpR5u8R37a`. The attacker was the throwaway `rtc-sanity`, a Warn agent, so the run was restricted with dual eval → Valid/high, paid 50% (1 tUSDC).
- RPC note: under team load `test.rpc.fastnear.com` (profile `testnet-fastnear`) answered "rate limit exceeded". Helpers and lock.sh now default to profile `testnet` (archival-rpc.testnet.fastnear.com).

## Tests
- Unit (86 incl. tusdc, includes a simulated OutLayer callback): `cd contracts && cargo test -p redteam -p tusdc`
- Sandbox (near-workspaces, real promise chain against `mock-outlayer`, real NEP-141): `contracts/scripts/test-sandbox.sh`
  - `main_flow`: full tree with counter-offer, 2 subjobs, sub + lead-margin payouts, real withdraw, re-credit on a failed ft_transfer, expiry roll-up children-first. Also: PANIC/NULL/ERROR/MISMATCH all → Failed with the fee kept; ERR_GAS; withdraw_compute.
  - `attacks`: (1) an injected agent with an FC key can't reach tusdc, attach a deposit, call private callbacks, forge ft_on_transfer, or withdraw to anyone but itself; (2) evaluator manipulation ×2 → strikes with evidence → blocklist → Block; (3) fresh agent Warn → restricted/no-subcontract/dual/50%; unregistered and blocked agents rejected; (4) runaway lead: ERR_BUDGET_CAP / ERR_REWARD / ERR_CATEGORY / ERR_MAX_CHILDREN / ERR_DEPTH / ERR_RATE_LIMIT / ERR_NOT_OWNER.
