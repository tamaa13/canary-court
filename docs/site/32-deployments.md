---
title: Deployments
description: Testnet addresses, every contract and enclave version with its hash and transaction, and how you can verify each of them yourself.
section: Operate
order: 32
---

# Deployments

Everything runs on **NEAR testnet**. Nothing is deployed on mainnet. The full operator log is in [`contracts/DEPLOYMENTS.md`](../../contracts/DEPLOYMENTS.md).

## Addresses

| what | account | notes |
|---|---|---|
| escrow | [`redteam.arifnovrian.testnet`](https://testnet.nearblocks.io/address/redteam.arifnovrian.testnet) | owner `arifnovrian.testnet` |
| mock USDC | [`tusdc.arifnovrian.testnet`](https://testnet.nearblocks.io/address/tusdc.arifnovrian.testnet) | NEP-141, 6 decimals, symbol `tUSDC`, public `mint` ≤ 1000 per call |
| TEE compute | `outlayer.testnet` | OutLayer `request_execution` → yield/resume → our callback |
| RPC | `https://archival-rpc.testnet.fastnear.com` | `test.rpc.fastnear.com` rate-limits under load; `rpc.testnet.near.org` is deprecated |

## Current versions

| component | version | hash | set in tx |
|---|---|---|---|
| `redteam` code | infra refund | sha256 `2063042cbda558b0e571bf9bd4ea831dd78fede7bebf02fd86a4276616c45047` | [`DeZNEin5…`](https://testnet.nearblocks.io/txns/DeZNEin5PNeHVHoAFaaBVog7UtMHVqX9sFj9bkjFCPNm) |
| enclave | v0.1.3 | wasm `c1b1ac5cd1a270880554a321f2a6736858fdac1b00964763f71c26498f0d0cdf`, pubkey `091e7c1b45f635f3015ce7dff55fdbc0944f52abf7190f7b8dd0e7b572d5e542` | [`DCoezLFA…`](https://testnet.nearblocks.io/txns/DCoezLFAoJJfAeEiBuy1wiZ1yWx9wxgGtn5GaizEa7S8) |
| `tusdc` code | v0.1.0 | sha256 `68d962958a27551e6bc63dc8516fa9063e255261c555ad3147ba33b47d0f63ca` | deployed 2026-11-13 22:47 WIB |

## `redteam` code history

Every upgrade was code-only and state-compatible. No state migration was ever run.

| date (WIB) | sha256 | change | tx |
|---|---|---|---|
| 11-13 22:49 | `e837ad8a…` | first deploy | – |
| 11-13 23:08 | `7b3c0f2e…` | `withdraw_compute`; `register_target` rate-limited | [`9zWa68H3…`](https://testnet.nearblocks.io/txns/9zWa68H3eRJfENd7gTZfadFTCYvDz3enfMaUZU8wP3LP) |
| 11-13 23:21 | `3c2f0515…` | `result_hash` dedup, solvency guard, `get_solvency` | [`5tzXVfLu…`](https://testnet.nearblocks.io/txns/5tzXVfLuVcEaMUVhiNMu4bPfPYPmMtr4CDL3s8QSonzG) |
| 11-13 23:27 | `68f9fb69…` | `dedup_key`, target lock, key freeze, strict output checks, client-fault refund | [`DCuGznkn…`](https://testnet.nearblocks.io/txns/DCuGznkn6uzpJ5aLH61VbsE1YGK53pjjrTUYx6hJp2mP) |
| 11-13 23:55 | `c81bd164…` | enclave v0.1.2 support (binding errors, verified replay strike) | [`4WzhPtt2…`](https://testnet.nearblocks.io/txns/4WzhPtt2FgZi418a2k4w4sZg5q6DB7YEFcceTx7EYZ7d) |
| 11-14 00:08 | `f05e3dc9…` | fix: lead margin only when the sub is paid | [`6caAHEDY…`](https://testnet.nearblocks.io/txns/6caAHEDYcu6EZHEV5FfSHsnDmeRdPzYRt2uH1q6BmJPP) |
| 11-14 00:31 | `2063042c…` | 0.009 NEAR refund on OutLayer timeouts (`infra_timeout`) | [`DeZNEin5…`](https://testnet.nearblocks.io/txns/DeZNEin5PNeHVHoAFaaBVog7UtMHVqX9sFj9bkjFCPNm) |

## Enclave history (`set_enclave`)

| date (WIB) | enclave | wasm | pubkey | tx |
|---|---|---|---|---|
| 11-13 23:10 | v0.1.0 | `981db5c8…` | `6428e550…` | [`BdwnYZzB…`](https://testnet.nearblocks.io/txns/BdwnYZzBU4SNzSZ1HMK7B6xxXJCGNVW4Pc9ZKWR9tKk2) |
| 11-13 23:29 | v0.1.1 | `df9880fc…` | `e73962ea…` | [`HueXtXoC…`](https://testnet.nearblocks.io/txns/HueXtXoCSG3pmQwaxmMCtii2z9H5WQrXPQ1LoGqP3szy) |
| 11-14 00:00 | v0.1.2 | `1ab10425…` | `edcfab71…` | [`59kJjHd5…`](https://testnet.nearblocks.io/txns/59kJjHd5FFjmVHN4RB7Qsct8BxwcqwGpeYXMyAEraJsj) |
| 11-14 02:47 | v0.1.3 | `c1b1ac5c…` | `091e7c1b…` | [`DCoezLFA…`](https://testnet.nearblocks.io/txns/DCoezLFAoJJfAeEiBuy1wiZ1yWx9wxgGtn5GaizEa7S8) |

Each enclave build has a new key. Targets sealed to an older pubkey fail as client fault (`TARGET_DECRYPT_FAILED`, fee refunded). Always read the current pubkey from `get_config`.

## Proof transactions

| what it shows | tx |
|---|---|
| First live TEE evaluation: Valid/high, 2 tUSDC paid in the same receipt tree | [`HQqbqC9s…`](https://testnet.nearblocks.io/txns/HQqbqC9sLY4EB53p3KFKcjvZauNSUuYav9n9LGQaTovn) |
| Dedup: the same attack twice. The second copy is Valid + unpaid (`duplicate`). | [`r1aCZECv…`](https://testnet.nearblocks.io/txns/r1aCZECvdgJNPxfy2HaA8fRiFm6hisY8erAYfP7je3C), [`4vCDwU2c…`](https://testnet.nearblocks.io/txns/4vCDwU2ceBdAakrKQYazxxrVeJEHhPvGeTPh5rPvmCRn) |
| Bound target and payload → Valid | [`FYhMAFGX…`](https://testnet.nearblocks.io/txns/FYhMAFGXdPFsg8D6ADt8aBKhjisMd1tFWnPHCqckS8Gx) |
| Copied target → `TARGET_BINDING_MISMATCH`, attacker's fee refunded | [`EV8EYd2J…`](https://testnet.nearblocks.io/txns/EV8EYd2JvzjSJjQU44qfACf9fqptPQkaeFat8fKTNp4S) |
| Replayed payload → `PAYLOAD_BINDING_MISMATCH` + strike with verified evidence | [`BiHNsms5…`](https://testnet.nearblocks.io/txns/BiHNsms5JUyEUtMLrXAjj9qPfu7n3T86hrctHRr4897h) |
| Enclave v0.1.3 sanity: Valid/high, restricted 50% payout | [`5vPYHdcx…`](https://testnet.nearblocks.io/txns/5vPYHdcxUdXhS5fwsbJQUBYMdKMHor9QiKJpR5u8R37a) |
| `redteam` registered on `tusdc` | [`EBCLkHgi…`](https://testnet.nearblocks.io/txns/EBCLkHgiw4SDkySn3SDKhnVfYufGSUNK9u9tEku7Z9Cx) |

## Agent keys

Agents sign market calls with a function-call key. It has receiver `redteam.arifnovrian.testnet` and these methods, all 0-deposit:

```
register_agent, register_target, create_job, place_bid, counter_bid, accept_bid,
create_subjob, submit_finding, expire_job, withdraw, withdraw_compute
```

Such a key cannot reach `tusdc`, cannot attach a deposit and cannot add keys. Funds leave only through `withdraw` and `withdraw_compute`, which pay the caller. The command to add the key is in [`contracts/DEPLOYMENTS.md`](../../contracts/DEPLOYMENTS.md#agent-function-call-keys).

**What a function-call key does not protect.** The key can't send tokens or NEAR, attach deposits or add keys, so a hijacked agent can't move funds *out of the market*. Inside the market it can still act as you:
- A hijacked **client** key can call `create_job` and `accept_bid`, so it can spend your own escrow on a colluding provider. The money stays in the market, but it can be misallocated.
- A hijacked **provider** key can only bid, submit and withdraw to itself.

Your full-access setup key (used once for `storage_deposit`, `mint`, `ft_transfer_call` and `deposit_compute`) is stored on your machine. Keep it out of the agent's reach.

## Locked contract

**Locked on 2026-11-14 (17:38 WIB).** The only full-access key on `redteam.arifnovrian.testnet` was deleted. Nobody can redeploy or change the contract code any more.

| | |
|---|---|
| final code sha256 | `2063042cbda558b0e571bf9bd4ea831dd78fede7bebf02fd86a4276616c45047` |
| key deletion tx | [`EUpzUJw1…`](https://testnet.nearblocks.io/txns/EUpzUJw1b3N8LnEj4N1XY7m6qWCM6SLyXeQmnJDsBqVJ) |
| owner `set_policy` after the lock | [`EL4WBpwK…`](https://testnet.nearblocks.io/txns/EL4WBpwK2ZWdbRhRFFSJvx1HySUkKxYty1Bw3XckTh8J) |

The lock was done by [`contracts/scripts/lock.sh`](../../contracts/scripts/lock.sh). It refuses to run if:
- the deployed hash is not the expected one,
- the owner is the contract itself, or
- an evaluation is in flight.

After locking, it confirmed that no full-access key is left, that the code hash is unchanged, and that the owner can still call `set_policy`. Owner methods keep working because they are authorized by the owner account, not by a key on `redteam`. So the owner stays trusted: it can still change the policy and the enclave, and both changes are visible on-chain.

## Verify it yourself

**1. The code on-chain is the code in the repo.**

```bash
near contract inspect redteam.arifnovrian.testnet network-config testnet now   # SHA-256 checksum [hex]
cd contracts/redteam && cargo near build non-reproducible-wasm                 # prints the same SHA-256
```

Local builds reproduce the deployed hash byte for byte with Rust 1.100 and cargo-near 0.23. This was checked from a clean clone for `68f9fb69…`, and again for the current `2063042c…`. A different toolchain can give a different hash.

**2. Nobody can redeploy it.** The account has no full-access key.

```bash
near account list-keys redteam.arifnovrian.testnet network-config testnet now  # no "full access" rows
```

**3. The configuration is what this page says.**

```bash
near contract call-function as-read-only redteam.arifnovrian.testnet get_config json-args '{}' network-config testnet now
```

Check `enclave_code.WasmUrl.hash`, `enclave_pubkey`, `policy`, `outlayer_max_charge` (0.011 NEAR) and `infra_refund` (0.009 NEAR).

**4. Agent deposits are covered.**

```bash
near contract call-function as-read-only redteam.arifnovrian.testnet get_solvency json-args '{}' network-config testnet now
```

`headroom` = `balance − storage_cost − compute_liabilities` must be ≥ `reserve` (0.5 NEAR), and `solvent` must be `true`.

**5. An evaluation really ran in the TEE.** The enclave team's `verify.mjs` checks, for any `submit_finding` tx:
- the wasm hash,
- that the predecessor is `redteam`,
- the `secrets_ref`,
- that the TDX worker key signed the result.

See [Enclave protocol](24-enclave-protocol.md) and the enclave's `ATTESTATION.md`.

**6. The tests pass.**

```bash
cd contracts && cargo test -p redteam -p tusdc     # 86 unit tests
./scripts/test-sandbox.sh                          # 12 sandbox tests (real chain, mock OutLayer)
```
