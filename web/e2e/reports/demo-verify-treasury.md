# Canary Court: independent check of the live demo fixture: **all consistent**

- Fixture: `~/projects/near-redteam-agents/agents/fixtures/demo-receipts.json` (Canary Court, recorded 2026-11-13T20:30:38.845Z, 41 receipts, 8 findings).
- Checked against `redteam.arifnovrian.testnet` read-only (views, tx status, enclave/verify). Nothing signed. 2026-11-13T20:48:44.547Z.
- 95 ✓ · 0 ✗ · 0 n/a

## Fixture self-report

- ✓ fixture ok flag  
  <sub>17/17 checks</sub>
- ✓ fixture contract = redteam.arifnovrian.testnet  
  <sub>redteam.arifnovrian.testnet</sub>

## Receipts re-fetched from chain (archival RPC)

- ✓ client-1: register_target → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/7jCsVHe1ZMbLxx8FT2NxPjxTmBiY6SEniMU7rmTBhfMk</sub>
- ✓ client-2: create_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/AZSYbgvRJF63hGGW3i6reLBCYzGwva1FQ32TxdPkDLhA</sub>
- ✓ lead-3: place_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/GaAZK23M5XBDwSTLkcRPTE7dQe6vtw3VetAYhjjGZM7A</sub>
- ✓ client-4: accept_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/2XJtJpCG7wfwHqPcYhGWrVjpQRd9eMMUP7RbBKRSDxYT</sub>
- ✓ lead-5: create_subjob → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/ChzPvMB9EDj6Kt489N8q1RrEwbUhKqAhUmt1rahEtgAb</sub>
- ✓ lead-6: create_subjob → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/9BhP5SYBdXupJTNdGA3dtugDED23Qmv5HqmLir1NY3qD</sub>
- ✓ sub1-7: place_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/BXC2WjGMyWWzgK9ZeSQsWD3KuTfUHf1aBAgj9nSA8A13</sub>
- ✓ sub2-8: place_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/HkD1EytoCstLrQV4QqzBvpSWxZVLL8w6C9KE3Gqtiw1C</sub>
- ✓ lead-9: accept_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/HJQheMApHkxr47zWKgBomZ4Q9uphThgguYmxvkpnxqxv</sub>
- ✓ lead-10: accept_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/Fvtb4F35og92oKCw9Vkk5kWHUn25ykfHzVf9PXTDczM5</sub>
- ✓ client-11: register_target → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/BwrmRd7jhv2L9UDveUXgSpxLfbVhNLrrc1mGWFCPxM7Q</sub>
- ✓ client-12: create_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/4H3KnUvUUXQjZarGDdFMwk51V7j49Jh1ZYo6E3JntKmb</sub>
- ✓ lead-13: place_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/vWBKki9X8RM2mmo3piFqwZgGGgWfFiAjwKWfY7w2phd</sub>
- ✓ client-14: accept_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/LjzHg9vAABQ1ApwQ47DPrTyZTbwdEwg5gsy1ioT7FJN</sub>
- ✓ lead-15: create_subjob → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/CuRa6LR8ZZwDRsxHEnV9CCP2ozhJwBz59myS5QnqUuyC</sub>
- ✓ lead-16: create_subjob → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/sLRo6ihLRsDN5SZr2uCDfLjGg41ucnsJyfs4HHXNM98</sub>
- ✓ sub1-17: place_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/5Dt9RVGBFAyusFv57utw5NFbdSRYNLSkzDELc5HLrVFh</sub>
- ✓ sub2-18: place_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/FLmv7weQFpUQhomJbY7aYCKWob1E9vtd7EHfA1LTzees</sub>
- ✓ lead-19: accept_bid → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/G3sLSTzKfqxUiuaVbxTTAsvkmDxqNKnymdxurAw5gtXR</sub>
- ✓ sub1-20: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/E1wqKXG4psS4N3ZtgYCva4NDmwKeFSLrBhErqDu4ndty</sub>
- ✓ sub1-21: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/FeWm5AUhh5h6v5G2hS94sFZbMrgZsXnrmseB7PscvYy4</sub>
- ✓ sub2-22: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/65KMCie9E6RSN8tCsQaVxFA2hJQrfkXx95VkZvaeLdXj</sub>
- ✓ sub2-23: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/5q5KDV7TQ83qSGZrLUYncK6uibsi6SoU8vQwyj5DGhzV</sub>
- ✓ sub1-24: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/5jQ2LkDUCDYBS64czPHgQh3FNwJhoagjYT6TjhY78HtZ</sub>
- ✓ sub1-25: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/9BksHD9Dt5Hn1zeMV8WmoYzK9UG6AxkxA39r4xfScJ7a</sub>
- ✓ sub1-26: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/HADApZaQUNFRXn97sMFyZXad64px1hFpiMn8AsZMJDz3</sub>
- ✓ sub1-27: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/872mwM9Xu3jSzUefqGtMKK6zU6K3YemwJJBcQtbJUcmb</sub>
- ✓ lead-28: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/F8qj92BYjrmsdVgznY5Z1VQhPmQCKnH8VZ97sMHHX9DE</sub>
- ✓ lead-29: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/A2MJgmim4UBTtYADYT47pJQpaJ4BhXzsvt66L7YoREGX</sub>
- ✓ lead-30: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/QFdxCRoamcvNDbFVeuCgtBUqHXF6VBFuQ8VtdWnTV4G</sub>
- ✓ lead-31: submit_finding → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/5LjvsFNZTctYQ3zYVthjpNNv4Z2hqzbkoA9pGPJnamWv</sub>
- ✓ client-32: expire_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/FWN39bBFqaHX6tmTX7fHTAEAj4sMJaBVJAjx4CBtDqh9</sub>
- ✓ client-33: expire_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/EZtYvK4zjX8ASXyCkk63GZk4hu7ih2t9niLmRoijxZXR</sub>
- ✓ client-34: expire_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/7Ug6D8tZEox512asfehvug4s9ab2rypaudHFhejW7ipQ</sub>
- ✓ client-35: expire_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/5euypZkmvP8hef5GMDyetYUmfEAhkP4xtjR7793jixrD</sub>
- ✓ client-36: expire_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/zHsaGdNvtb1MJEkDAspiCoW9xYktUXm5q9EpNxV8UNL</sub>
- ✓ client-37: expire_job → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/8Pgo2GtxLbACcAyn3F1v1j5w7mNfr84fnzQ1N1cR5iAS</sub>
- ✓ lead-38: withdraw → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/F2uFECdmkkoEnwXj1PzUXtxJD6xJsWhQ6eXvTBU4cMiq</sub>
- ✓ sub1-39: withdraw → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/6bExYL5PU9B88pvbEppTywDLvLbggZongPYzx5RBsTXm</sub>
- ✓ sub2-40: withdraw → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/HoBoZj5fAsw8PHUm9NmUfGjS7ta9o5RLbAga3xuQTArN</sub>
- ✓ client-41: withdraw → ok on chain (fixture: ok)  
  <sub>https://testnet.nearblocks.io/txns/5HQrK6L2SZaKyEHiSp1XTZyfrUsjUJ8rgLByrTpQDGeh</sub>

## Findings: fixture vs get_finding

- ✓ #74 [v1] job 81 sub1: Valid paid 15000000/3000000
- ✓ #74 report_for_client is a sealed ECIES envelope
- ✓ #75 [v1] job 81 sub1: Invalid paid 0/0
- ✓ #76 [v1] job 82 sub2: Valid paid 6000000/6000000
- ✓ #76 report_for_client is a sealed ECIES envelope
- ✓ #77 [v1] job 82 sub2: Invalid paid 0/0
- ✓ #80 [v2] job 84 sub1: Failed paid 0/0 (outlayer: run failed or produced no output)
- ✓ #81 [v2] job 84 sub1: Invalid paid 0/0
- ✓ #84 [v2] job 83 provider: Failed paid 0/0 (outlayer: run failed or produced no output)
- ✓ #85 [v2] job 83 provider: Failed paid 0/0 (outlayer: run failed or produced no output)

## OutLayer infra timeouts → infra_timeout refund

- ✓ 3 finding(s) in the fixture failed with an OutLayer error  
  <sub>#80, #84, #85</sub>
- ✓ #80: infra_timeout logged  
  <sub>seq 296: finding 80 (job 84): OutLayer produced no output (outlayer: run failed or produced no output); 9000000000000000000000 of the fee refunded</sub>
- ✓ #80: actor = attacker  
  <sub>sub1.arifnovrian.testnet</sub>
- ✓ #80: refund = get_config.infra_refund (9000000000000000000000)
- ✓ #84: infra_timeout logged  
  <sub>seq 299: finding 84 (job 83): OutLayer produced no output (outlayer: run failed or produced no output); 9000000000000000000000 of the fee refunded</sub>
- ✓ #84: actor = attacker  
  <sub>provider.arifnovrian.testnet</sub>
- ✓ #84: refund = get_config.infra_refund (9000000000000000000000)
- ✓ #85: infra_timeout logged  
  <sub>seq 300: finding 85 (job 83): OutLayer produced no output (outlayer: run failed or produced no output); 9000000000000000000000 of the fee refunded</sub>
- ✓ #85: actor = attacker  
  <sub>provider.arifnovrian.testnet</sub>
- ✓ #85: refund = get_config.infra_refund (9000000000000000000000)
- ✓ all OutLayer infra timeouts in the demo jobs: 7  
  <sub>seq 294 → finding 78, seq 295 → finding 79, seq 296 → finding 80, seq 297 → finding 82, seq 298 → finding 83, seq 299 → finding 84, seq 300 → finding 85</sub>
- ✓ superseded #82: Failed with infra_timeout (refunded) and resubmitted  
  <sub>seq 297</sub>
- ✓ superseded #83: Failed with infra_timeout (refunded) and resubmitted  
  <sub>seq 298</sub>
- ✓ superseded #78: Failed with infra_timeout (refunded) and resubmitted  
  <sub>seq 294</sub>
- ✓ superseded #79: Failed with infra_timeout (refunded) and resubmitted  
  <sub>seq 295</sub>
- ✓ every timeout is either a superseded resubmit or a final finding in the fixture  
  <sub>4 superseded + 3 final = 7</sub>
- ✓ fixture infra.infra_timeouts = the on-chain infra_timeout findings  
  <sub>chain [78, 79, 80, 82, 83, 84, 85] vs fixture [78, 79, 80, 82, 83, 84, 85]</sub>
- ✓ fixture infra.submissions (12) = submit_finding receipts

## Money: ledger and lead-margin invariants (both demo trees)

- ✓ [v1] job #80: budget 80000000 = paid 30000000 + refunded 50000000 + escrow 0
- ✓ [v1] #74: lead margin = parent reward − sub reward  
  <sub>3000000</sub>
- ✓ [v1] #75 (Invalid): no lead margin without a sub reward  
  <sub>paid_lead=0</sub>
- ✓ [v1] #76: lead margin = parent reward − sub reward  
  <sub>6000000</sub>
- ✓ [v1] #77 (Invalid): no lead margin without a sub reward  
  <sub>paid_lead=0</sub>
- ✓ [v2] job #83: budget 80000000 = paid 0 + refunded 80000000 + escrow 0
- ✓ [v2] #78 (Failed): no lead margin without a sub reward  
  <sub>paid_lead=0</sub>
- ✓ [v2] #79 (Failed): no lead margin without a sub reward  
  <sub>paid_lead=0</sub>
- ✓ [v2] #80 (Failed): no lead margin without a sub reward  
  <sub>paid_lead=0</sub>
- ✓ [v2] #81 (Invalid): no lead margin without a sub reward  
  <sub>paid_lead=0</sub>

## Privacy spot check (views of the demo jobs)

- ✓ no canary-shaped plaintext in jobs / findings / bids  
  <sub>16163 bytes scanned</sub>

## Attestation chain (enclave/verify) for every submit_finding tx

- ✓ sub1-20: finding #74 live: 9 ✓, 0 n/a
- ✓ fresh-nonce NEAR AI attestation for the demo's signing key (nonce 23339e6f…)  
  <sub>✓ Fresh nonce echoed by the model TEE; ✓ Attested signing key = key that signed our response; ✓ Intel TDX quote binds signing key + nonce (report_data); ✓ NVIDIA GPU evidence bound to the nonce; n/a Quote/GPU signature chains (Intel DCAP, NVIDIA NRAS)</sub>
- ✓ sub1-21: finding #75 live: 9 ✓, 0 n/a
- ✓ sub2-22: finding #76 live: 9 ✓, 1 n/a
- ✓ sub2-23: finding #77 live: 10 ✓, 0 n/a
- ✓ sub1-24: finding #78 timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected  
  <sub>✓ exec.requested ✓ exec.code ✓ exec.caller ✓ exec.secrets</sub>
- ✓ sub1-25: finding #79 timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected  
  <sub>✓ exec.requested ✓ exec.code ✓ exec.caller ✓ exec.secrets</sub>
- ✓ sub1-26: finding #80 timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected  
  <sub>✓ exec.requested ✓ exec.code ✓ exec.caller ✓ exec.secrets</sub>
- ✓ sub1-27: finding #81 live: 9 ✓, 0 n/a
- ✓ lead-28: finding #82 timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected  
  <sub>✓ exec.requested ✓ exec.code ✓ exec.caller ✓ exec.secrets</sub>
- ✓ lead-29: finding #83 timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected  
  <sub>✓ exec.requested ✓ exec.code ✓ exec.caller ✓ exec.secrets</sub>
- ✓ lead-30: finding #84 timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected  
  <sub>✓ exec.requested ✓ exec.code ✓ exec.caller ✓ exec.secrets</sub>
- ✓ lead-31: finding #85 timed out in the OutLayer queue; request attested (pinned build, caller redteam, secret profile), no output expected  
  <sub>✓ exec.requested ✓ exec.code ✓ exec.caller ✓ exec.secrets</sub>
