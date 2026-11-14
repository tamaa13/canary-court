# Canary Court e2e: run `f8op5e` on testnet: **PASS**

- **1 passed · 0 failed · 0 skipped** (1 steps, 70 checks, 0 txs)
- Contract `redteam.arifnovrian.testnet` · token `tusdc.arifnovrian.testnet` · funder `arifnovrian.testnet`
- Started 2026-11-13T17:17:06.800Z · took 4 s
- Run accounts: client=`ef8op5e-client.arifnovrian.testnet`, lead=`ef8op5e-lead.arifnovrian.testnet`, sub1=`ef8op5e-sub1.arifnovrian.testnet`, sub2=`ef8op5e-sub2.arifnovrian.testnet`, newbie=`ef8op5e-newbie.arifnovrian.testnet`, mallory=`ef8op5e-mallory.arifnovrian.testnet`, thief=`ef8op5e-thief.arifnovrian.testnet`

## Summary

| Step | Test | Result | Checks | Txs | Time |
|---|---|---|---|---|---|
| **10** | **Attack scenarios (receipts)** | | | | |
| 10.2 | attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain | ✅ pass | 70/70 | 0 | 3.7 s |

## Details

### 10.2 attack receipts (agents/fixtures/attack-receipts.json) re-verified on chain (PASS)

- ✓ receipts is a non-empty array
- ✓ scenario 1 covered
- ✓ scenario 2 covered
- ✓ scenario 3 covered
- ✓ scenario 4 covered
- ✓ receipts come from a live run (not --dry-run)  
  <sub>entries flagged mock:true</sub>
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
