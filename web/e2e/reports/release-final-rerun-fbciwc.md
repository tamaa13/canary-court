# Canary Court e2e: run `fbciwc` on testnet: **PASS**

- **23 passed · 0 failed · 0 skipped** (23 steps, 293 checks, 77 txs)
- Contract `redteam.arifnovrian.testnet` · token `tusdc.arifnovrian.testnet` · funder `arifnovrian.testnet`
- Deployed: contract wasm sha256 `2063042cbda558b0e571bf9bd4ea831dd78fede7bebf02fd86a4276616c45047` · enclave wasm `1ab104255db5223df8352923e02f9cb042e3f546f115ba8d727eab0147c5f28a` (enclave v0.1.2)
- Started 2026-11-13T18:31:37.680Z · took 257 s
- OutLayer infra timeouts: **0**
- Run accounts: client=`efbciwc-client.arifnovrian.testnet`, lead=`efbciwc-lead.arifnovrian.testnet`, sub1=`efbciwc-sub1.arifnovrian.testnet`, sub2=`efbciwc-sub2.arifnovrian.testnet`, newbie=`efbciwc-newbie.arifnovrian.testnet`, mallory=`efbciwc-mallory.arifnovrian.testnet`, thief=`efbciwc-thief.arifnovrian.testnet`

## Summary

| Step | Test | Result | Checks | Txs | Time |
|---|---|---|---|---|---|
| **01** | **Setup & registration** | | | | |
| 01.1 | contract config exposes enclave key and spec policy | ✅ pass | 7/7 | 0 | 0.3 s |
| 01.2 | provision fresh per-run agent accounts (FA key for setup, FC key for actions) | ✅ pass | 21/21 | 14 | 30.8 s |
| 01.3 | agent keys are function-call keys scoped to redteam | ✅ pass | 14/14 | 0 | 1.5 s |
| 01.4 | register client, lead, sub1, sub2 (FC key, 0 deposit) | ✅ pass | 25/25 | 8 | 20.7 s |
| 01.5 | fund: tUSDC mint → ft_transfer_call into escrow; compute deposits (setup FA key) | ✅ pass | 20/20 | 14 | 36.1 s |
| 01.6 | register target: enc_target is ECIES to the enclave, never plaintext | ✅ pass | 9/9 | 3 | 7.9 s |
| **02** | **Job → bid → counter → accept** | | | | |
| 02.1 | create_job locks budget from the client balance | ✅ pass | 9/9 | 1 | 3.5 s |
| 02.3 | lead bids; client cannot bid on its own job | ✅ pass | 4/4 | 2 | 5.5 s |
| 02.4 | client counters once; only the client may counter | ✅ pass | 5/5 | 3 | 7.9 s |
| 02.5 | lead accepts the counter by re-bidding at counter_price | ✅ pass | 3/3 | 1 | 2.7 s |
| 02.6 | accept_bid (lead verdict Allow) assigns J1 unrestricted | ✅ pass | 11/11 | 3 | 11.2 s |
| **03** | **Counterparty Allow / Warn / Block** | | | | |
| 03.1 | check_counterparty: aged, clean agents → Allow; unregistered → Block | ✅ pass | 7/7 | 0 | 1.5 s |
| **04** | **Subjob carving & caps** | | | | |
| 04.1 | create_subjob S1 carves budget from J1 | ✅ pass | 9/9 | 1 | 5.4 s |
| 04.3 | create_subjob S2; third subjob → ERR_MAX_CHILDREN | ✅ pass | 5/5 | 2 | 6.2 s |
| 04.4 | subs bid on subjobs; lead (as client of the subjob) accepts | ✅ pass | 14/14 | 6 | 15.3 s |
| 04.7 | setup for client fault: a job on a broken target (canary too short → BAD_TARGET) | ✅ pass | 5/5 | 4 | 10.3 s |
| **03** | **Counterparty Allow / Warn / Block** | | | | |
| 03.2 | young agents get Warn → assignment auto-restricted (cap 50%, no subcontract, dual eval) | ✅ pass | 22/22 | 8 | 22.3 s |
| **05** | **Valid finding → atomic payout, privacy** | | | | |
| 05.1 | submit findings: payloads ECIES-encrypted to the enclave; fee charged from compute | ✅ pass | 12/12 | 4 | 46.0 s |
| 05.2 | all evaluations land; money is conserved at every observed block (atomic payouts) | ✅ pass | 3/3 | 0 | 3.5 s |
| **07** | **OutLayer / enclave failure → Failed** | | | | |
| 07.1 | malformed ciphertext → enclave error → Failed (fee kept, no strike, not invalid) | ✅ pass | 8/8 | 0 | 3.4 s |
| 07.2 | client fault (broken target) → Failed, attacker's fee refunded, policy log client_fault | ✅ pass | 6/6 | 0 | 2.7 s |
| **10** | **Attack scenarios (receipts)** | | | | |
| 10.1 | scenario 1 live: prompt-injected agent tries to move funds — key scope stops it | ✅ pass | 4/4 | 3 | 3.3 s |
| 10.2 | attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain | ✅ pass | 70/70 | 0 | 9.0 s |

## Details

### 01.1 contract config exposes enclave key and spec policy (PASS)

- ✓ enclave configured (needed from 01.6 on)  
  <sub>enclave_pubkey="edcfab71a2cda4b744f60030354b86b3cd6f0db32f85986088fdc23500e83f5c"</sub>
- ✓ token_id = tusdc.arifnovrian.testnet
- ✓ policy.max_depth = 1
- ✓ policy.max_children = 2
- ✓ policy.strikes_to_block = 2
- ✓ policy.warn_reward_cap_bps = 5000
- ✓ policy.min_deadline_ms ≤ side deadline  
  <sub>60000</sub>
- _policy: min_age_blocks=60, outlayer_fee=20000000000000000000000, rate_limit=30/h_
- _enclave_code: {"WasmUrl":{"build_target":"wasm32-wasip2","hash":"1ab104255db5223df8352923e02f9cb042e3f546f115ba8d727eab0147c5f28a","url":"https://test.fastfs.io/arifnovrian.testnet/outlayer.testnet/1ab104255db5223df8352923e02f9cb042e3f546f115ba8d727eab0147c5f28a.wasm"}}_

### 01.2 provision fresh per-run agent accounts (FA key for setup, FC key for actions) (PASS)

- ✓ efbciwc-client.arifnovrian.testnet does not exist yet
- ✓ create client
- ✓ add FC key client
- ✓ efbciwc-lead.arifnovrian.testnet does not exist yet
- ✓ create lead
- ✓ add FC key lead
- ✓ efbciwc-sub1.arifnovrian.testnet does not exist yet
- ✓ create sub1
- ✓ add FC key sub1
- ✓ efbciwc-sub2.arifnovrian.testnet does not exist yet
- ✓ create sub2
- ✓ add FC key sub2
- ✓ efbciwc-newbie.arifnovrian.testnet does not exist yet
- ✓ create newbie
- ✓ add FC key newbie
- ✓ efbciwc-mallory.arifnovrian.testnet does not exist yet
- ✓ create mallory
- ✓ add FC key mallory
- ✓ efbciwc-thief.arifnovrian.testnet does not exist yet
- ✓ create thief
- ✓ add FC key thief

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [FzYao3v9…](https://testnet.nearblocks.io/txns/FzYao3v9VpHPU7Pesba9SchhkZ2zZeP48g7E12HBek4L) | create client | `arifnovrian` → `efbciwc-client.CreateAccount` | ok |
| [Fa5atsM2…](https://testnet.nearblocks.io/txns/Fa5atsM2R7ofiVXLfrpgizkL14yHTU5AMC3CGWMj8xiE) | fc key client | `efbciwc-client` → `efbciwc-client.AddKey` | ok |
| [AbCtssW4…](https://testnet.nearblocks.io/txns/AbCtssW4goDnA3tkPKpdLavnVdHEHqASawzgXzBsi6qd) | create lead | `arifnovrian` → `efbciwc-lead.CreateAccount` | ok |
| [GkTWFwX7…](https://testnet.nearblocks.io/txns/GkTWFwX7TTuRzRibmLDFLBhzUgENz5kfuvj8u6P18orQ) | fc key lead | `efbciwc-lead` → `efbciwc-lead.AddKey` | ok |
| [G7FrLXun…](https://testnet.nearblocks.io/txns/G7FrLXun25rsTBLjTDqG1g14i9zk2TaBkpmNtcMPsv5p) | create sub1 | `arifnovrian` → `efbciwc-sub1.CreateAccount` | ok |
| [Eb6kMJ2P…](https://testnet.nearblocks.io/txns/Eb6kMJ2PVNQ6zNQ4rSBuk1FbHg2kxtjg83dcAj8cspPB) | fc key sub1 | `efbciwc-sub1` → `efbciwc-sub1.AddKey` | ok |
| [1DArHmFH…](https://testnet.nearblocks.io/txns/1DArHmFHtyYsr4JRNgdMV9Sq4Uqyg7CKJencv2BVCcK) | create sub2 | `arifnovrian` → `efbciwc-sub2.CreateAccount` | ok |
| [EBXHB7NP…](https://testnet.nearblocks.io/txns/EBXHB7NPaXWR2BepzVVKTCur4uzhfKEgbqnoN99dGjaD) | fc key sub2 | `efbciwc-sub2` → `efbciwc-sub2.AddKey` | ok |
| [6v37sqYb…](https://testnet.nearblocks.io/txns/6v37sqYbJgus1DB3vvHcvGyAPcnoyRvLLSjadCvPLz4F) | create newbie | `arifnovrian` → `efbciwc-newbie.CreateAccount` | ok |
| [EDHVSLmz…](https://testnet.nearblocks.io/txns/EDHVSLmzd3jaPGKkwheU1g43GVWQEzDuXiBweqYJiJ9b) | fc key newbie | `efbciwc-newbie` → `efbciwc-newbie.AddKey` | ok |
| [BrshRpGC…](https://testnet.nearblocks.io/txns/BrshRpGCQrriq2YpHRnUFuJepDWuxwdi8kggpGBWuuyd) | create mallory | `arifnovrian` → `efbciwc-mallory.CreateAccount` | ok |
| [2eHoHuQ6…](https://testnet.nearblocks.io/txns/2eHoHuQ6Jn1FVXgukDbFscncdkU5aeXrLj2eXHSwtXBu) | fc key mallory | `efbciwc-mallory` → `efbciwc-mallory.AddKey` | ok |
| [Cop5bdzZ…](https://testnet.nearblocks.io/txns/Cop5bdzZf3cWtaK3b8TkfYBh5d6wJGLHQgtSkSs5H11m) | create thief | `arifnovrian` → `efbciwc-thief.CreateAccount` | ok |
| [Hxr3WekR…](https://testnet.nearblocks.io/txns/Hxr3WekRjcgmmdZNdFmm9dnqDPPy9yB2v5h5nTqDqoSx) | fc key thief | `efbciwc-thief` → `efbciwc-thief.AddKey` | ok |

### 01.3 agent keys are function-call keys scoped to redteam (PASS)

- ✓ client FC key receiver = redteam.arifnovrian.testnet
- ✓ client FC key cannot call on_finding_evaluated / ft_transfer
- ✓ lead FC key receiver = redteam.arifnovrian.testnet
- ✓ lead FC key cannot call on_finding_evaluated / ft_transfer
- ✓ sub1 FC key receiver = redteam.arifnovrian.testnet
- ✓ sub1 FC key cannot call on_finding_evaluated / ft_transfer
- ✓ sub2 FC key receiver = redteam.arifnovrian.testnet
- ✓ sub2 FC key cannot call on_finding_evaluated / ft_transfer
- ✓ newbie FC key receiver = redteam.arifnovrian.testnet
- ✓ newbie FC key cannot call on_finding_evaluated / ft_transfer
- ✓ mallory FC key receiver = redteam.arifnovrian.testnet
- ✓ mallory FC key cannot call on_finding_evaluated / ft_transfer
- ✓ thief FC key receiver = redteam.arifnovrian.testnet
- ✓ thief FC key cannot call on_finding_evaluated / ft_transfer

### 01.4 register client, lead, sub1, sub2 (FC key, 0 deposit) (PASS)

- ✓ register_agent client succeeds
- ✓ client.role = client
- ✓ client.x25519_pubkey = 78909385715816348df528b6fd36cd57367324a08e5a583ae7ce8dd1e4cb6f4d
- ✓ client starts clean
- ✓ register_agent lead succeeds
- ✓ lead.role = provider
- ✓ lead.x25519_pubkey = 4638f1ef59585417bb7bad360967ca9ad80b2522a0768a40d6a3e485c3820e77
- ✓ lead starts clean
- ✓ register_agent sub1 succeeds
- ✓ sub1.role = provider
- ✓ sub1.x25519_pubkey = afd9198a230a06e8203cad94ae779f72688e9daa6b89de452308fb1ea08afd1a
- ✓ sub1 starts clean
- ✓ register_agent sub2 succeeds
- ✓ sub2.role = provider
- ✓ sub2.x25519_pubkey = ee2ae471aafaf8a6f42a6f67b92b702ccb86a6c2b6e86bbd848b68c55c8aa15e
- ✓ sub2 starts clean
- ✓ register_agent thief succeeds
- ✓ thief.role = client
- ✓ thief.x25519_pubkey = 97665af6422adc3ccba82cac1ed93089ae078a46ac4ce6df5858c188a9de7a03
- ✓ thief starts clean
- ✓ role cannot change on re-register rejected with ERR_ROLE  
  <sub>Smart contract panicked: ERR_ROLE: role is fixed at first registration</sub>
- ✓ bad x25519 pubkey rejected with ERR_INPUT  
  <sub>Smart contract panicked: ERR_INPUT: x25519_pubkey must be 32-byte hex</sub>
- ✓ all-zero (low-order) x25519 pubkey rejected with ERR_BAD_KEY  
  <sub>Smart contract panicked: ERR_BAD_KEY: x25519_pubkey is zero / a small-order point</sub>
- ✓ sub1 key unchanged after rejected re-register = afd9198a230a06e8203cad94ae779f72688e9daa6b89de452308fb1ea08afd1a
- ✓ list_agents includes the run agents

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [HBGuJLFP…](https://testnet.nearblocks.io/txns/HBGuJLFPcNzQZyVYoeSxT9AUVEjNdJcZNH3Yby8v7ZcC) | register_agent client | `efbciwc-client` → `redteam.register_agent` | ok |
| [ArtTVeu7…](https://testnet.nearblocks.io/txns/ArtTVeu7nL3qBiPc64bw8dBhQcR9rJa3MbCcLUDKLfxB) | register_agent lead | `efbciwc-lead` → `redteam.register_agent` | ok |
| [95zwLgiK…](https://testnet.nearblocks.io/txns/95zwLgiKWYXGffeZKxwyKBvX4kirQ9iR5uCgjccYmK2z) | register_agent sub1 | `efbciwc-sub1` → `redteam.register_agent` | ok |
| [CTo6CWwh…](https://testnet.nearblocks.io/txns/CTo6CWwhkVSrwaysnxfTjwZUhjYcokpNk9gjQodgpjPV) | register_agent sub2 | `efbciwc-sub2` → `redteam.register_agent` | ok |
| [2zNQUxq4…](https://testnet.nearblocks.io/txns/2zNQUxq4JaawDr5Ug8gmcH5ccgSYAY6CQcZ6r1vuym6p) | register_agent thief | `efbciwc-thief` → `redteam.register_agent` | ok |
| [BtFTyVwd…](https://testnet.nearblocks.io/txns/BtFTyVwdFP4qLkfftUK4AA4dBmy9Fuoy2jFJDquR7SYs) | role cannot change on re-register | `efbciwc-lead` → `redteam.register_agent` | ERR_ROLE |
| [HjBikvH3…](https://testnet.nearblocks.io/txns/HjBikvH3REZbqbWTBCmjyPpuCwqDd8pSCDHCvv5UR8Rx) | bad x25519 pubkey | `efbciwc-sub1` → `redteam.register_agent` | ERR_INPUT |
| [2cxnozC8…](https://testnet.nearblocks.io/txns/2cxnozC8nM5ctQArE5yHf4K1SihBZrgo5AkNsiXFu47w) | all-zero (low-order) x25519 pubkey | `efbciwc-sub1` → `redteam.register_agent` | ERR_BAD_KEY |

### 01.5 fund: tUSDC mint → ft_transfer_call into escrow; compute deposits (setup FA key) (PASS)

- ✓ mint client succeeds
- ✓ mint lead succeeds
- ✓ mint sub1 succeeds
- ✓ mint sub2 succeeds
- ✓ mint newbie succeeds
- ✓ mint mallory succeeds
- ✓ mint thief succeeds
- ✓ thief ft_transfer_call → redteam succeeds
- ✓ client ft_transfer_call → redteam succeeds
- ✓ client internal USDC = 3000000
- ✓ deposit_compute lead succeeds
- ✓ lead compute balance = 100000000000000000000000
- ✓ deposit_compute sub1 succeeds
- ✓ sub1 compute balance = 100000000000000000000000
- ✓ deposit_compute sub2 succeeds
- ✓ sub2 compute balance = 160000000000000000000000
- ✓ deposit_compute newbie succeeds
- ✓ newbie compute balance = 100000000000000000000000
- ✓ deposit_compute mallory succeeds
- ✓ mallory compute balance = 100000000000000000000000

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [BqHq4i6R…](https://testnet.nearblocks.io/txns/BqHq4i6RwGx6MhJTqtPFNYXQ2DGFMBzYhWRfULu5GHJk) | mint client | `efbciwc-client` → `tusdc.mint` | ok |
| [DY72Koyu…](https://testnet.nearblocks.io/txns/DY72Koyug9goQWkrbsSzfvhPEYpk9eX93QqFGxUpEoGU) | mint lead | `efbciwc-lead` → `tusdc.mint` | ok |
| [BHazsiPX…](https://testnet.nearblocks.io/txns/BHazsiPXET4k65iqsdfEdCmY4tnWEpGX4fYPcnHQnxYp) | mint sub1 | `efbciwc-sub1` → `tusdc.mint` | ok |
| [9tfFxgmM…](https://testnet.nearblocks.io/txns/9tfFxgmMsYzUNuXNse8SK2DgiuEDC2MKkXRtvKwW1xr3) | mint sub2 | `efbciwc-sub2` → `tusdc.mint` | ok |
| [GpPiqp1L…](https://testnet.nearblocks.io/txns/GpPiqp1L6LQxvhcixbZc8cKvij1zUwnafswXoAmNWbu7) | mint newbie | `efbciwc-newbie` → `tusdc.mint` | ok |
| [2Xe3N576…](https://testnet.nearblocks.io/txns/2Xe3N576cxj932JAYmGgrFgHFBDv6snaANXt7f3Qt535) | mint mallory | `efbciwc-mallory` → `tusdc.mint` | ok |
| [Ft2JXBKy…](https://testnet.nearblocks.io/txns/Ft2JXBKyF5nYHi4mDyxhAoyVJ4sYmVx9RanGnUsePgRe) | mint thief | `efbciwc-thief` → `tusdc.mint` | ok |
| [A6sE2W6v…](https://testnet.nearblocks.io/txns/A6sE2W6vPtMZsoVYFhw4XmBuDGTK4Y9MowbXqkmz3UKH) | thief ft_transfer_call → redteam | `efbciwc-thief` → `tusdc.ft_transfer_call` | ok |
| [6sY8xPWs…](https://testnet.nearblocks.io/txns/6sY8xPWsRgUzDknHk9Br23F3HKaVcmVJCWFN4cs4yWPE) | client ft_transfer_call → redteam | `efbciwc-client` → `tusdc.ft_transfer_call` | ok |
| [4sDhdrpz…](https://testnet.nearblocks.io/txns/4sDhdrpzwQuF6gaukA52HpPUqKDJ23jWqWK8YxMXSwtK) | deposit_compute lead | `efbciwc-lead` → `redteam.deposit_compute` | ok |
| [7YgUce4e…](https://testnet.nearblocks.io/txns/7YgUce4ejQn1emsSrCQQwycFBrHef7UeF9Ut9Vhx1ZM4) | deposit_compute sub1 | `efbciwc-sub1` → `redteam.deposit_compute` | ok |
| [Gb7XMbTU…](https://testnet.nearblocks.io/txns/Gb7XMbTUsJBXxnWWrP5r4GFDBCtm6mtDfDCxUf4Cgcmj) | deposit_compute sub2 | `efbciwc-sub2` → `redteam.deposit_compute` | ok |
| [CKKmP8Pg…](https://testnet.nearblocks.io/txns/CKKmP8PgS6fHP3FWZwPrbqfGzt5mmfNV5CCUMDbeSXVE) | deposit_compute newbie | `efbciwc-newbie` → `redteam.deposit_compute` | ok |
| [7RNDAcPA…](https://testnet.nearblocks.io/txns/7RNDAcPAyAYAFXAah44M7tBino83cDPv1i9rWKh5fQ18) | deposit_compute mallory | `efbciwc-mallory` → `redteam.deposit_compute` | ok |

### 01.6 register target: enc_target is ECIES to the enclave, never plaintext (PASS)

- ✓ enclave_pubkey is 32-byte hex (set_enclave done)  
  <sub>enclave_pubkey="edcfab71a2cda4b744f60030354b86b3cd6f0db32f85986088fdc23500e83f5c"</sub>
- ✓ register_target succeeds
- ✓ target.owner = efbciwc-client.arifnovrian.testnet
- ✓ enc_target stored as ECIES envelope
- ✓ canary not visible in get_target
- ✓ system prompt not visible in get_target
- ✓ provider cannot register a target rejected with ERR_ROLE  
  <sub>Smart contract panicked: ERR_ROLE: efbciwc-sub1.arifnovrian.testnet must have role client</sub>
- ✓ owner re-registers its target before any job (update allowed) succeeds
- ✓ target still owned by the client = efbciwc-client.arifnovrian.testnet

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [EeL6Nj1d…](https://testnet.nearblocks.io/txns/EeL6Nj1dGL6L7gyvRRPAZAiTn7QQRZf1cWb72M8zv5K3) | register_target | `efbciwc-client` → `redteam.register_target` | ok |
| [8GmWmsFd…](https://testnet.nearblocks.io/txns/8GmWmsFdoUEusHeywuTm8UkZfRD2vQrJvZ5tAbdJZpbj) | provider cannot register a target | `efbciwc-sub1` → `redteam.register_target` | ERR_ROLE |
| [2iYL1r3w…](https://testnet.nearblocks.io/txns/2iYL1r3wNDkyL2Qyq1ABe9agA14HzJHd9W13HtDgBGVW) | owner re-registers its target before any job (update allowed) | `efbciwc-client` → `redteam.register_target` | ok |

### 02.1 create_job locks budget from the client balance (PASS)

- ✓ create_job J1 succeeds
- ✓ J1.status = Open
- ✓ J1.depth = 0
- ✓ J1.parent_id is null
- ✓ J1.client = efbciwc-client.arifnovrian.testnet
- ✓ J1.root_client = efbciwc-client.arifnovrian.testnet
- ✓ J1.remaining = 1000000
- ✓ J1.reward_per_finding = 100000
- ✓ client balance locked = 2000000

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [AKeyGnye…](https://testnet.nearblocks.io/txns/AKeyGnyedTtSvYuWzXnCeLK8QUkKh1MDYai5mqPhH6xA) | create_job J1 | `efbciwc-client` → `redteam.create_job` | ok |

### 02.3 lead bids; client cannot bid on its own job (PASS)

- ✓ lead place_bid 0.12 succeeds
- ✓ bid.price_per_finding = 120000
- ✓ bid.status = Open
- ✓ client cannot bid rejected with ERR_ROLE \| ERR_SELF_DEAL  
  <sub>Smart contract panicked: ERR_ROLE: efbciwc-client.arifnovrian.testnet must have role provider</sub>

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [B7dnKeL3…](https://testnet.nearblocks.io/txns/B7dnKeL3ccJfZiUJVTJoPjEaPDNZFmQetKqyNcWubujD) | lead place_bid 0.12 | `efbciwc-lead` → `redteam.place_bid` | ok |
| [Ev24Bsgv…](https://testnet.nearblocks.io/txns/Ev24BsgvuK6gTUGftWYuhjVLkYqDZ6FJHiZn8b6UHvNQ) | client cannot bid | `efbciwc-client` → `redteam.place_bid` | ERR_ROLE |

### 02.4 client counters once; only the client may counter (PASS)

- ✓ non-client counter rejected with ERR_NOT_CLIENT  
  <sub>Smart contract panicked: ERR_NOT_CLIENT: only the job client</sub>
- ✓ client counter_bid 0.10 succeeds
- ✓ bid.status = Countered
- ✓ bid.counter_price = 100000
- ✓ second counter on the same bid rejected with ERR_BID  
  <sub>Smart contract panicked: ERR_BID: bid already countered</sub>

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [D9KijWZH…](https://testnet.nearblocks.io/txns/D9KijWZHGjUJEUqoTXbQ6QeCBZ3Hq7JH3ygb58Yrn5ZJ) | non-client counter | `efbciwc-sub1` → `redteam.counter_bid` | ERR_NOT_CLIENT |
| [6BArZGkH…](https://testnet.nearblocks.io/txns/6BArZGkHnShubRFsbuuYTbXPxq4X4ZM9hcLubAJKTWSP) | client counter_bid 0.10 | `efbciwc-client` → `redteam.counter_bid` | ok |
| [8yNUrVnT…](https://testnet.nearblocks.io/txns/8yNUrVnTdrudkJ2fu4vPpGdezTte72J5BqqAuUqgKyGX) | second counter on the same bid | `efbciwc-client` → `redteam.counter_bid` | ERR_BID |

### 02.5 lead accepts the counter by re-bidding at counter_price (PASS)

- ✓ lead re-bid at counter succeeds
- ✓ bid.price_per_finding = 100000
- ✓ bid.status back to Open  
  <sub>status=Open</sub>

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [HrrrQwpT…](https://testnet.nearblocks.io/txns/HrrrQwpT59zCy2UoUfcKt98hK4XCiXe4LT71gRHy4Ymf) | lead re-bid at counter | `efbciwc-lead` → `redteam.place_bid` | ok |

### 02.6 accept_bid (lead verdict Allow) assigns J1 unrestricted (PASS)

- ✓ check_counterparty(lead) reaches Allow (after ~0s)
- ✓ non-client accept rejected with ERR_NOT_CLIENT  
  <sub>Smart contract panicked: ERR_NOT_CLIENT: only the job client</sub>
- ✓ client accept_bid lead succeeds
- ✓ J1.status = Assigned
- ✓ J1.provider = efbciwc-lead.arifnovrian.testnet
- ✓ J1.reward_per_finding (= accepted price) = 100000
- ✓ J1.restricted = false
- ✓ J1.can_subcontract = true
- ✓ bid.status = Accepted
- ✓ policy log accept_bid verdict = Allow
- ✓ job no longer biddable rejected with ERR_STATUS  
  <sub>Smart contract panicked: ERR_STATUS: job is not Open</sub>

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [8e6w4DLK…](https://testnet.nearblocks.io/txns/8e6w4DLKcD2NQuGky3GEXLQNv3GvribVQcYc9sBMXZLG) | non-client accept | `efbciwc-sub1` → `redteam.accept_bid` | ERR_NOT_CLIENT |
| [9GPeHDpy…](https://testnet.nearblocks.io/txns/9GPeHDpykCs743oNaKKUdcorvW5kpAZL39dPNqFKLgWf) | client accept_bid lead | `efbciwc-client` → `redteam.accept_bid` | ok |
| [CrmhY4Fx…](https://testnet.nearblocks.io/txns/CrmhY4FxwN2YugcunKZUB663G9uGCpt1NAs3xHTnnS13) | job no longer biddable | `efbciwc-sub1` → `redteam.place_bid` | ERR_STATUS |

### 03.1 check_counterparty: aged, clean agents → Allow; unregistered → Block (PASS)

- ✓ check_counterparty(lead) reaches Allow (after ~0s)
- ✓ lead Allow carries reasons
- ✓ check_counterparty(sub1) reaches Allow (after ~0s)
- ✓ sub1 Allow carries reasons
- ✓ check_counterparty(sub2) reaches Allow (after ~0s)
- ✓ sub2 Allow carries reasons
- ✓ unregistered verdict = Block

### 04.1 create_subjob S1 carves budget from J1 (PASS)

- ✓ lead create_subjob S1 succeeds
- ✓ S1.depth = 1
- ✓ S1.parent_id = 61
- ✓ S1.client (= lead) = efbciwc-lead.arifnovrian.testnet
- ✓ S1.root_client = efbciwc-client.arifnovrian.testnet
- ✓ S1.status = Open
- ✓ J1.remaining = 700000
- ✓ J1.children = [62]
- ✓ policy log create_subjob entry

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [CFn8dSKs…](https://testnet.nearblocks.io/txns/CFn8dSKsa2q9u83dHUDbabFMvoPFsEKFnsa48HW2oLXX) | lead create_subjob S1 | `efbciwc-lead` → `redteam.create_subjob` | ok |

### 04.3 create_subjob S2; third subjob → ERR_MAX_CHILDREN (PASS)

- ✓ lead create_subjob S2 succeeds
- ✓ J1.remaining = 460000
- ✓ J1.children = [62,63]
- ✓ third subjob rejected with ERR_MAX_CHILDREN  
  <sub>Smart contract panicked: ERR_MAX_CHILDREN: max 2 subjobs per job</sub>
- ✓ J1.remaining unchanged = 460000

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [Agms9DSz…](https://testnet.nearblocks.io/txns/Agms9DSzaHM52JY6cQMNr8eYvFZu9H9t9SJJ7bN3XLKD) | lead create_subjob S2 | `efbciwc-lead` → `redteam.create_subjob` | ok |
| [GR3watFw…](https://testnet.nearblocks.io/txns/GR3watFwidtpLn64d9g9XRAB5pbHofsdLZWDKzRMTBPy) | third subjob | `efbciwc-lead` → `redteam.create_subjob` | ERR_MAX_CHILDREN |

### 04.4 subs bid on subjobs; lead (as client of the subjob) accepts (PASS)

- ✓ sub1 bid S1 succeeds
- ✓ sub2 bid S2 succeeds
- ✓ lead cannot bid on its own subjob rejected with ERR_SELF_DEAL  
  <sub>Smart contract panicked: ERR_SELF_DEAL: cannot bid on your own job</sub>
- ✓ root client cannot accept on a subjob rejected with ERR_NOT_CLIENT  
  <sub>Smart contract panicked: ERR_NOT_CLIENT: only the job client</sub>
- ✓ lead accept sub1 succeeds
- ✓ lead accept sub2 succeeds
- ✓ S1.status = Assigned
- ✓ S1.provider = efbciwc-sub1.arifnovrian.testnet
- ✓ S1.restricted = false
- ✓ S1.can_subcontract (depth 1) = false
- ✓ S2.status = Assigned
- ✓ S2.provider = efbciwc-sub2.arifnovrian.testnet
- ✓ S2.restricted = false
- ✓ S2.can_subcontract (depth 1) = false

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [4pHJ5GkS…](https://testnet.nearblocks.io/txns/4pHJ5GkSDyr6jB67uRTfyecffVsvNCBbtaFoMs5nqauW) | sub1 bid S1 | `efbciwc-sub1` → `redteam.place_bid` | ok |
| [EbGsgFce…](https://testnet.nearblocks.io/txns/EbGsgFcegTkFB3c6RX19ogA8hgRNMfwtvGTKwyrt5vtX) | sub2 bid S2 | `efbciwc-sub2` → `redteam.place_bid` | ok |
| [BeVkze9Z…](https://testnet.nearblocks.io/txns/BeVkze9ZHZc2uXEZkfwQNngYRJWKZfEd2GPbqAdV1Bpz) | lead cannot bid on its own subjob | `efbciwc-lead` → `redteam.place_bid` | ERR_SELF_DEAL |
| [v8w4bxHF…](https://testnet.nearblocks.io/txns/v8w4bxHFsNydWYGf5kV5k6t7dGfoiBE8WzavcyqdcDL) | root client cannot accept on a subjob | `efbciwc-client` → `redteam.accept_bid` | ERR_NOT_CLIENT |
| [63xErbBN…](https://testnet.nearblocks.io/txns/63xErbBN6owbuhcChKVboLaTi6SQG5vpmJoBG1HdzHrG) | lead accept sub1 | `efbciwc-lead` → `redteam.accept_bid` | ok |
| [7dGyfNB8…](https://testnet.nearblocks.io/txns/7dGyfNB8HSjpfsRcnZxjsyHDm1A5NHbJsS5rr18HxFHp) | lead accept sub2 | `efbciwc-lead` → `redteam.accept_bid` | ok |

### 04.7 setup for client fault: a job on a broken target (canary too short → BAD_TARGET) (PASS)

- ✓ register broken target succeeds
- ✓ create_job JX on the broken target succeeds
- ✓ sub2 bids JX succeeds
- ✓ client accepts sub2 on JX succeeds
- ✓ JX.status = Assigned

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [5ANcXJfq…](https://testnet.nearblocks.io/txns/5ANcXJfqMZRwFNbWzEHLk8xoizsCsQ5brqRzBHWcYnYT) | register broken target | `efbciwc-client` → `redteam.register_target` | ok |
| [BZsiAXNv…](https://testnet.nearblocks.io/txns/BZsiAXNvtuC5QzaXALGpNzZpqTUP69PLv3DafNPGzHWj) | create_job JX on the broken target | `efbciwc-client` → `redteam.create_job` | ok |
| [95XG6fHV…](https://testnet.nearblocks.io/txns/95XG6fHVmunoKhyQFLhrKHusRinz4x4tM94C3AwgNrHJ) | sub2 bids JX | `efbciwc-sub2` → `redteam.place_bid` | ok |
| [GjYgVPr2…](https://testnet.nearblocks.io/txns/GjYgVPr2Z2PQrge4EYKRBgJy6FrL5oC7uwyE8BkRUGki) | client accepts sub2 on JX | `efbciwc-client` → `redteam.accept_bid` | ok |

### 03.2 young agents get Warn → assignment auto-restricted (cap 50%, no subcontract, dual eval) (PASS)

- ✓ register_agent newbie succeeds
- ✓ register_agent mallory succeeds
- ✓ create_job JW succeeds
- ✓ create_job JM succeeds
- ✓ newbie bid JW succeeds
- ✓ mallory bid JM succeeds
- ✓ newbie verdict (registered < min_age_blocks ago) = Warn
- ✓ newbie Warn reason mentions age  
  <sub>new agent: registered 20 blocks ago (< 60)</sub>
- ✓ mallory verdict (registered < min_age_blocks ago) = Warn
- ✓ mallory Warn reason mentions age  
  <sub>new agent: registered 16 blocks ago (< 60)</sub>
- ✓ client accept newbie (Warn) succeeds
- ✓ client accept mallory (Warn) succeeds
- ✓ JW.restricted = true
- ✓ JW.can_subcontract = false
- ✓ JW.payout_per_finding (capped) = 100000
- ✓ policy log JW verdict = Warn
- ✓ policy log JW marks auto-escalation  
  <sub>assigned to efbciwc-newbie.arifnovrian.testnet RESTRICTED (auto-escalation): reward capped at 5000 bps, no subcontracting, dual evaluation</sub>
- ✓ JM.restricted = true
- ✓ JM.can_subcontract = false
- ✓ JM.payout_per_finding (capped) = 50000
- ✓ policy log JM verdict = Warn
- ✓ policy log JM marks auto-escalation  
  <sub>assigned to efbciwc-mallory.arifnovrian.testnet RESTRICTED (auto-escalation): reward capped at 5000 bps, no subcontracting, dual evaluation</sub>

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [7Di7enmc…](https://testnet.nearblocks.io/txns/7Di7enmcm9MoLCiHS7JerLh67G4aF8EEfLBLHrJH5PY3) | register_agent newbie | `efbciwc-newbie` → `redteam.register_agent` | ok |
| [23zG3iqR…](https://testnet.nearblocks.io/txns/23zG3iqRiVS1Rz5V1nTXAYem5jyUnGzEzc9aRddzNLPz) | register_agent mallory | `efbciwc-mallory` → `redteam.register_agent` | ok |
| [CwDJHZTF…](https://testnet.nearblocks.io/txns/CwDJHZTFDwNFQSawhBsgt83eysETG6eLHEDDmERj3RA7) | create_job JW | `efbciwc-client` → `redteam.create_job` | ok |
| [74TXQ7qs…](https://testnet.nearblocks.io/txns/74TXQ7qserhvg9nSe2H7STrXvaKjtomGZhPcGRF69ktF) | create_job JM | `efbciwc-client` → `redteam.create_job` | ok |
| [GNs89UYy…](https://testnet.nearblocks.io/txns/GNs89UYysc53ZAym8N1qJQwdnL9GQKmYzw11CH2FmYct) | newbie bid JW | `efbciwc-newbie` → `redteam.place_bid` | ok |
| [DnzwXGJh…](https://testnet.nearblocks.io/txns/DnzwXGJhXeo6mspzSx8GMVMWjpvhbTszgcGwSTkccB3J) | mallory bid JM | `efbciwc-mallory` → `redteam.place_bid` | ok |
| [BvagcKeC…](https://testnet.nearblocks.io/txns/BvagcKeCqHHjY1nzQANqLwAryXf1WkgzceWMsmL5si3o) | client accept newbie (Warn) | `efbciwc-client` → `redteam.accept_bid` | ok |
| [8RU9JjZt…](https://testnet.nearblocks.io/txns/8RU9JjZtLGmFjLkwu8FS55MZygMjnXqcpx1uRvZMiGVp) | client accept mallory (Warn) | `efbciwc-client` → `redteam.accept_bid` | ok |

### 05.1 submit findings: payloads ECIES-encrypted to the enclave; fee charged from compute (PASS)

- ✓ sub2 → S2 (malformed ciphertext) succeeds
- ✓ sub2 → S2 (malformed ciphertext): finding.attacker = efbciwc-sub2.arifnovrian.testnet
- ✓ sub2 → JX (broken client target) succeeds
- ✓ sub2 → JX (broken client target): finding.attacker = efbciwc-sub2.arifnovrian.testnet
- ✓ wave 1: sub2Malformed, sub2ClientFault evaluated (after ~0s)
- ✓ lead compute = deposit − fees (refunds applied) = 100000000000000000000000
- ✓ sub1 compute = deposit − fees (refunds applied) = 100000000000000000000000
- ✓ sub2 compute = deposit − fees (refunds applied) = 140000000000000000000000
- ✓ newbie compute = deposit − fees (refunds applied) = 100000000000000000000000
- ✓ mallory compute = deposit − fees (refunds applied) = 100000000000000000000000
- ✓ submit to a job you do not hold rejected with ERR_NOT_PROVIDER  
  <sub>Smart contract panicked: ERR_NOT_PROVIDER: only the job's provider</sub>
- ✓ category outside the job rejected with ERR_CATEGORY  
  <sub>Smart contract panicked: ERR_CATEGORY: category 'jailbreak' not in job categories</sub>
- _E2E_ONLY_FINDINGS: submitting only sub2Malformed, sub2ClientFault_
- _sub2 → S2 (malformed ciphertext): status right after submit = Failed (on testnet the tx returns once the yielded callback has run)_
- _sub2 → JX (broken client target): status right after submit = Failed (on testnet the tx returns once the yielded callback has run)_
- _compute before 05.1: lead=100000000000000000000000, sub1=100000000000000000000000, sub2=160000000000000000000000, newbie=100000000000000000000000, mallory=100000000000000000000000_

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| [EzJxo1ca…](https://testnet.nearblocks.io/txns/EzJxo1cazpVAL58FzDsGdCGYMws4SduJawM2M4CEuCJZ) | sub2 → S2 (malformed ciphertext) | `efbciwc-sub2` → `redteam.submit_finding` | ok |
| [GJbuBmH9…](https://testnet.nearblocks.io/txns/GJbuBmH9cjyFiuWRVcbUaipozwM5FQD2Zy5x2bepKrzK) | sub2 → JX (broken client target) | `efbciwc-sub2` → `redteam.submit_finding` | ok |
| [FoNc3kv5…](https://testnet.nearblocks.io/txns/FoNc3kv57URuHqzHnmtKLNNchGfDypaepwRs1LqBow63) | submit to a job you do not hold | `efbciwc-sub1` → `redteam.submit_finding` | ERR_NOT_PROVIDER |
| [BXhkECBD…](https://testnet.nearblocks.io/txns/BXhkECBDvVgMp85VQm16hLj2ryacDcHxuQ9vbFEV8h3o) | category outside the job | `efbciwc-sub1` → `redteam.submit_finding` | ERR_CATEGORY |

### 05.2 all evaluations land; money is conserved at every observed block (atomic payouts) (PASS)

- ✓ 2 evaluations resolved (after ~0s)
- ✓ conservation held in all 2 pinned-block samples
- ✓ contract solvent (get_solvency headroom ≥ 0) in all 2 samples
- _min solvency headroom seen: 3202938647479946699999985 yoctoNEAR_

### 07.1 malformed ciphertext → enclave error → Failed (fee kept, no strike, not invalid) (PASS)

- ✓ status = Failed
- ✓ paid_attacker = 0
- ✓ no report on failure
- ✓ sub2 strikes = 0
- ✓ sub2.invalid counts only Invalid findings (the Failed one is not counted) = 0
- ✓ sub2.failed counts the malformed finding  
  <sub>failed=2</sub>
- ✓ enclave error code = DECRYPT_FAILED
- ✓ sub2 compute: attacker-fault fee kept, client-fault fees refunded = 140000000000000000000000

### 07.2 client fault (broken target) → Failed, attacker's fee refunded, policy log client_fault (PASS)

- ✓ status = Failed
- ✓ paid_attacker = 0
- ✓ enclave error code = BAD_TARGET
- ✓ policy log client_fault entry for this finding  
  <sub>copycat.arifnovrian.testnet job 32: finding 30 failed with TARGET_BINDING_MISMATCH (client fault); fee 20000000000000000000000 refunded to mallory2.arifnovrian.testnet \| ef9jqla-thief.arifnovrian.testnet job 55: finding 49 failed with TARGET_BINDING_MISMATCH (client fault); fee 20000000000000000000000 refunded to ef9jqla-sub2.arifnovrian.testnet \| efbciwc-client.arifnovrian.testnet job 64: findi</sub>
- ✓ client_fault actor = root client  
  <sub>efbciwc-client.arifnovrian.testnet</sub>
- ✓ sub2 strikes = 0

### 10.1 scenario 1 live: prompt-injected agent tries to move funds — key scope stops it (PASS)

- ✓ FC key → tusdc.ft_transfer to attacker rejected with /InvalidAccessKey\|ReceiverMismatch\|DepositWithFunctionCall\|receiver\|not allowed\|permission/i  
  <sub>Deposit is not allowed with function call</sub>
- ✓ rejected before inclusion (no tx hash)
- ✓ FC key → deposit-carrying call rejected with /InvalidAccessKey\|Deposit\|not allowed\|permission\|MethodNameMismatch/i  
  <sub>Deposit is not allowed with function call</sub>
- ✓ forged evaluation callback (FA key, contract level) rejected with /private\|Method.*not found\|MethodNotFound/i  
  <sub>Smart contract panicked: Method on_finding_evaluated is private</sub>

| tx | label | signer → receiver.method | outcome |
|---|---|---|---|
| — | FC key → tusdc.ft_transfer to attacker | `efbciwc-lead` → `tusdc.ft_transfer` | Deposit is not allowed with function call |
| — | FC key → deposit-carrying call | `efbciwc-lead` → `redteam.deposit_compute` | Deposit is not allowed with function call |
| [BnBDMhh1…](https://testnet.nearblocks.io/txns/BnBDMhh1fh4YN3ZmjekBrygTHhof9PWtkKYcsCWpm3GP) | forged evaluation callback (FA key, contract level) | `efbciwc-sub2` → `redteam.on_finding_evaluated` | Smart contract panicked: Method on_finding_evaluated is private |

### 10.2 attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain (PASS)

- ✓ receipts is a non-empty array
- ✓ scenario 1 covered
- ✓ scenario 2 covered
- ✓ scenario 3 covered
- ✓ scenario 4 covered
- ✓ receipts come from a live run (not --dry-run)  
  <sub>0/21 entries flagged mock:true</sub>
- ✓ s4-budget-over-remaining: shape
- ✓ s4-budget-over-remaining: runner marked ok  
  <sub>ERR_BUDGET_CAP: budget exceeds parent remaining 40000000</sub>
- ✓ s4-budget-over-remaining: on-chain panic ∈ ERR_BUDGET_CAP  
  <sub>Smart contract panicked: ERR_BUDGET_CAP: budget exceeds parent remaining 40000000</sub>
- ✓ s4-reward-over-parent: shape
- ✓ s4-reward-over-parent: runner marked ok  
  <sub>ERR_REWARD: subjob reward exceeds parent reward_per_finding</sub>
- ✓ s4-reward-over-parent: on-chain panic ∈ ERR_REWARD  
  <sub>Smart contract panicked: ERR_REWARD: subjob reward exceeds parent reward_per_finding</sub>
- ✓ s4-two-subjobs-allowed: shape
- ✓ s4-two-subjobs-allowed: runner marked ok
- ✓ s4-two-subjobs-allowed: on-chain tx succeeded (no error expected)
- ✓ s4-third-subjob: shape
- ✓ s4-third-subjob: runner marked ok  
  <sub>ERR_MAX_CHILDREN: max 2 subjobs per job</sub>
- ✓ s4-third-subjob: on-chain panic ∈ ERR_MAX_CHILDREN  
  <sub>Smart contract panicked: ERR_MAX_CHILDREN: max 2 subjobs per job</sub>
- ✓ s4-client-over-max-budget: shape
- ✓ s4-client-over-max-budget: runner marked ok  
  <sub>ERR_BUDGET_CAP: budget exceeds policy max 1000000000</sub>
- ✓ s4-client-over-max-budget: on-chain panic ∈ ERR_BUDGET_CAP\|ERR_BALANCE  
  <sub>Smart contract panicked: ERR_BUDGET_CAP: budget exceeds policy max 1000000000</sub>
- ✓ s4-depth-2: shape
- ✓ s4-depth-2: runner marked ok  
  <sub>ERR_DEPTH: max depth 1 reached</sub>
- ✓ s4-depth-2: on-chain panic ∈ ERR_DEPTH\|ERR_NO_SUBCONTRACT  
  <sub>Smart contract panicked: ERR_DEPTH: max depth 1 reached</sub>
- ✓ s3-warn-escalation: shape
- ✓ s3-warn-escalation: runner marked ok
- ✓ s3-warn-escalation: on-chain tx succeeded (no error expected)
- ✓ s3-restricted-subcontract: shape
- ✓ s3-restricted-subcontract: runner marked ok  
  <sub>ERR_NO_SUBCONTRACT: provider is restricted on this job (can_subcontract=false)</sub>
- ✓ s3-restricted-subcontract: on-chain panic ∈ ERR_NO_SUBCONTRACT  
  <sub>Smart contract panicked: ERR_NO_SUBCONTRACT: provider is restricted on this job (can_subcontract=false)</sub>
- ✓ s1-ft-transfer: shape
- ✓ s1-ft-transfer: runner marked ok  
  <sub>AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call</sub>
- ✓ s1-ft-transfer: rejected with ReceiverMismatch\|DepositWithFunctionCall  
  <sub>AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call</sub>
- ✓ s1-near-transfer: shape
- ✓ s1-near-transfer: runner marked ok  
  <sub>AccessKeyRequiresFullAccessActionError: Access key requires full access</sub>
- ✓ s1-near-transfer: rejected with RequiresFullAccess\|ReceiverMismatch  
  <sub>AccessKeyRequiresFullAccessActionError: Access key requires full access</sub>
- ✓ s1-add-key: shape
- ✓ s1-add-key: runner marked ok  
  <sub>AccessKeyRequiresFullAccessActionError: Access key requires full access</sub>
- ✓ s1-add-key: rejected with RequiresFullAccess\|ReceiverMismatch  
  <sub>AccessKeyRequiresFullAccessActionError: Access key requires full access</sub>
- ✓ s1-forge-deposit: shape
- ✓ s1-forge-deposit: runner marked ok  
  <sub>AccessKeyMethodNameMismatchActionError: Access key does not allow method ft_on_transfer</sub>
- ✓ s1-forge-deposit: rejected with MethodNameMismatch  
  <sub>AccessKeyMethodNameMismatchActionError: Access key does not allow method ft_on_transfer</sub>
- ✓ s1-withdraw-deposit: shape
- ✓ s1-withdraw-deposit: runner marked ok  
  <sub>AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call</sub>
- ✓ s1-withdraw-deposit: rejected with DepositWithFunctionCall  
  <sub>AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call</sub>
- ✓ s1-spend-client-escrow: shape
- ✓ s1-spend-client-escrow: runner marked ok  
  <sub>ERR_NOT_CLIENT: only the job client</sub>
- ✓ s1-spend-client-escrow: on-chain panic ∈ ERR_NOT_CLIENT\|ERR_STATUS  
  <sub>Smart contract panicked: ERR_NOT_CLIENT: only the job client</sub>
- ✓ s1-honest-hire-ignores-injection: shape
- ✓ s1-honest-hire-ignores-injection: runner marked ok
- ✓ s5-target-replay: shape
- ✓ s5-target-replay: runner marked ok
- ✓ s5-target-replay: on-chain tx succeeded (no error expected)
- ✓ s5-target-replay: enclave output error = TARGET_BINDING_MISMATCH  
  <sub>["TARGET_BINDING_MISMATCH"]</sub>
- ✓ s5-payload-replay: shape
- ✓ s5-payload-replay: runner marked ok
- ✓ s5-payload-replay: on-chain tx succeeded (no error expected)
- ✓ s5-payload-replay: enclave output error = PAYLOAD_BINDING_MISMATCH  
  <sub>["PAYLOAD_BINDING_MISMATCH"]</sub>
- ✓ s2-manipulation-1: shape
- ✓ s2-manipulation-1: runner marked ok
- ✓ s2-manipulation-1: on-chain tx succeeded (no error expected)
- ✓ s2-manipulation-1: enclave flagged manipulation  
  <sub>[true]</sub>
- ✓ s2-blocklisted: shape
- ✓ s2-blocklisted: runner marked ok
- ✓ s3-block-bid: shape
- ✓ s3-block-bid: runner marked ok  
  <sub>ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b1f54ec2c611f932f2b3f1b5eb9260cc83ab69ba3b8a8fcc7dee3db1)</sub>
- ✓ s3-block-bid: on-chain panic ∈ ERR_COUNTERPARTY_BLOCK  
  <sub>Smart contract panicked: ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b1f54ec2c611f932f2b3f1b5eb9260cc83ab69ba3b8a8fcc7dee3db1)</sub>
- ✓ s3-block-submit: shape
- ✓ s3-block-submit: runner marked ok  
  <sub>ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b1f54ec2c611f932f2b3f1b5eb9260cc83ab69ba3b8a8fcc7dee3db1)</sub>
- ✓ s3-block-submit: on-chain panic ∈ ERR_COUNTERPARTY_BLOCK  
  <sub>Smart contract panicked: ERR_COUNTERPARTY_BLOCK: mallory2.arifnovrian.testnet: blocklisted: 2 manipulation strikes (evidence: 1100efb247c7b19983253a191d0dc19c640f4d736f0d590f51be5c1ff8bfcf5a,0b4b8ae9b1f54ec2c611f932f2b3f1b5eb9260cc83ab69ba3b8a8fcc7dee3db1)</sub>
- _scenario 5 (replay attacks) present_
- _s4-budget-over-remaining: https://testnet.nearblocks.io/txns/813fgxfJ53ERs5tXZ5h4RyTg3ZFUdAjnuv4ePVK2PUtj_
- _s4-reward-over-parent: https://testnet.nearblocks.io/txns/2jfPn7NUPiHYu3Zi9c4BKdvSukSqx3tUsLc9qhJ9pM6y_
- _s4-two-subjobs-allowed: https://testnet.nearblocks.io/txns/37rZ8VvVwMpyTKRC86uUYxaKeYzwy4pGKZePqCUFYVus_
- _s4-third-subjob: https://testnet.nearblocks.io/txns/BMPtuaKye34gRqqea9w13TFE8859xEBrVHGPwfU1uWjX_
- _s4-client-over-max-budget: https://testnet.nearblocks.io/txns/57K9PnEU1ZQHz6UHdyuVGgdgJnVi1yzUH5eGK5Lx7ieE_
- _s4-depth-2: https://testnet.nearblocks.io/txns/EMSCSM29cj4ntEU19NmqDWLDszJpV3YrG5X1mHaQJt2r_
- _s3-warn-escalation: https://testnet.nearblocks.io/txns/HvTg34t5zyMcRm8mYPM1r6G5s26hg6mtKq2B6RWDducm_
- _s3-restricted-subcontract: https://testnet.nearblocks.io/txns/JBX4x7aogCsTXdofmFwDkwo9Kg7yfptsqKFz6nTRLxwj_
- _s1-spend-client-escrow: https://testnet.nearblocks.io/txns/Edcy1MPZ2WqrNAn8j178XzddWufiSXLJVCqr9MHj8DQY_
- _s5-target-replay: https://testnet.nearblocks.io/txns/XccUa2uNkRswMhsoRCXYatnDRK2byUzrJosUZR7F4Mb_
- _s5-payload-replay: https://testnet.nearblocks.io/txns/G3sKj6tUUFPoBRdoNc8evGroxFeJKa36NF8YnP6UQgcV_
- _s2-manipulation-1: https://testnet.nearblocks.io/txns/YFMiWmu1nxQdtiugfV8yWRzsDCqWTuRiwcUDk1rW2uT_
- _s3-block-bid: https://testnet.nearblocks.io/txns/8euY3JSwa2czt9GRPrBbG9pRjdDfAXGwHRwNSVz3xit1_
- _s3-block-submit: https://testnet.nearblocks.io/txns/DMe7HXGgyhLGrqtv7NRK6rxPPtva9XzSWEvP6NCzBZir_
