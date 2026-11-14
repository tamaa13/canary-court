---
title: Built on
description: The NEAR-ecosystem pieces Canary Court uses, what each one does here, and what we don't use.
section: Background
order: 40
---

# Built on

Canary Court is built only on NEAR and official NEAR ecosystem partners.

## NEAR

The escrow contract holds the money and every rule:
- **Function-call access keys** let agents act without holding money keys. A key is scoped to one contract and a method list, with no deposits ([`contracts/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/contracts/DEPLOYMENTS.md)). This is the core of "give AI money without giving it the keys".
- **Promise callbacks** make payment atomic. The OutLayer verdict comes back into `on_finding_evaluated`, which pays and stores the sealed report in one step.
- **Yield/resume** lets a transaction wait for an off-chain TEE result. The window is about 115 seconds ([`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)).
- **Testnet only.** The token is a mock USDC (`tusdc.arifnovrian.testnet`).

Contract: [`redteam.arifnovrian.testnet`](https://testnet.nearblocks.io/address/redteam.arifnovrian.testnet).

## OutLayer

OutLayer runs our enclave, a WebAssembly module, inside Intel TDX workers ([`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)):
- **Code pinned by hash.** The contract stores the wasm's sha256 and asks OutLayer to run exactly that build.
- **Secrets bound to the build.** The enclave's private key was generated inside OutLayer's keystore TEE. Only that exact wasm can read it, and only for runs the escrow contract requested.
- **Attested results.** The result is posted by a worker key that OutLayer registered after checking the worker's TDX quote.

What we rely on and can't check ourselves: OutLayer's coordinator delivers requests faithfully. It can't forge results, but it can delay or drop them ([`enclave/THREAT-MODEL.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/THREAT-MODEL.md)).

## NEAR AI Cloud

For live targets, the target agent runs on a NEAR AI model that is itself hosted in a TEE; targets sealed as `mock` use a deterministic stand-in and call no model (the verdict is always the enclave's own canary check) ([`enclave/DEPLOYMENTS.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)):
- **TEE-hosted models only.** The enclave refuses any model NEAR AI doesn't list as `owned_by: nearai`.
- **Signed responses.** The enclave fetches NEAR AI's signature when it can and checks that it covers the exact request and response bytes it sent and received. Every NEAR AI response in the final run was signed and bound (7/7); a missing signature does not block a verdict.
- **Fresh-nonce attestation.** Anyone can ask NEAR AI for an attestation report bound to their own random nonce. The dashboard's Proof tab (Enclave & model) does this in your browser ([`enclave/ATTESTATION.md`](https://github.com/tamaa13/canary-court/blob/main/enclave/ATTESTATION.md)).

The agents also use NEAR AI for their own decisions (bid, counter, hire), with a deterministic fallback when no key is configured ([`agents/README.md`](https://github.com/tamaa13/canary-court/blob/main/agents/README.md)).

## NEAR Intents

The client agent plans how to fund its escrow from another chain with a NEAR Intents **1Click quote**. This is a **dry quote only**: 1Click is a mainnet feature, and we run on testnet. Nothing is executed ([`agents/README.md`](https://github.com/tamaa13/canary-court/blob/main/agents/README.md)).

## Not used

- **Chain Signatures:** not used.

## Credits

The escrow-and-evaluator design is inspired by ERC-8183 (agentic commerce). This is a fresh, NEAR-native build: no EVM code.
