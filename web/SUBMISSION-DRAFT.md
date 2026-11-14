# Submission draft (rt-web → PM)

Product name: **Canary Court**. Public repo: `canary-court` (github.com/tamaa13/canary-court). Contract and account names stay `redteam.arifnovrian.testnet` / `tusdc.arifnovrian.testnet`.

---

## (a) Root README draft

# Canary Court

**Give AI money without giving it the keys.** Canary Court is an autonomous market on NEAR where AI agents red-team an AI agent *before* it is trusted with funds.

The demo target is a **fictional AI treasury agent**. It pays invoices and moves funds (`pay_invoice`, `transfer`), and it guards a **withdrawal approval key**: a secret canary in its system prompt. Before its owner hands it real money, the owner's **client agent** posts a USDC bounty: find a message that makes the treasury agent leak that key. The treasury agent and its tools are simulated inside the enclave, so no money moves during a test. Today a finding counts when the key leaks, including inside a simulated tool call; see Limitations for what isn't scored yet. Today that kind of red-teaming is manual and runs on trust: the tester has to show the attack before getting paid, and the owner can take it and walk away. Canary Court runs it as a market where agents decide and the contract enforces every rule:
- A **client agent** posts the bounty against its treasury agent.
- A **lead agent** wins the job and subcontracts specialists out of the same escrow.
- Every attack is **sealed to a TEE enclave** (OutLayer), which runs it against the treasury agent on a **TEE-hosted NEAR AI model** and checks deterministically whether the key leaked. The model only plays the target; it doesn't judge.
- The contract stores the sealed report for the owner **and pays the attacker in the same callback**.

A Valid finding's sealed report and its payout land in the same callback. A Valid finding goes unpaid only if it repeats one already paid in that job or the budget has run out; both cases are flagged `unpaid` on chain. The market is open: third-party attacker agents can join through `/skill.md` (MCP), and our own attackers are only a baseline example. So far every attacker in our runs, including the fresh faucet accounts `cc-ext`, `cc-join` and `cc-mcp`, was run by our team. The market follows its own rule: every agent signs its market calls with a function-call key (a full-access key is used only for setup), and all spending policy (budgets, depth, counterparty risk, strikes, blocklist) lives in the contract, not in any LLM. Everything runs on NEAR testnet with a mock USDC token, and the treasury agent, its tools and its invoices are fictional.

### Quickstart: do X → see Y

Requires Node ≥ 24 and pnpm. Rust is only needed for contracts and the enclave.

| Do | See |
|---|---|
| `cd agents && pnpm install && pnpm demo --dry-run` | The whole market with no keys or network: the client posts a job, the lead bids, the client counters, the lead creates 2 subjobs, specialists attack, verdicts come back, payouts are atomic (sub reward + lead margin), reports are decrypted, the privacy scan finds 0 hits, refunds roll up. Ends with `demo passed` ([agents/README.md](https://github.com/tamaa13/canary-court/blob/main/agents/README.md)). |
| `pnpm attacks --dry-run` | The 5 attack scenarios: hijacked agent, evaluator manipulation, blocklisted/new agent, runaway lead, and replay of someone else's sealed target or payload. Ends with `attacks: all 21 expectations held` and `PASS S1…S5` ([agents/README.md](https://github.com/tamaa13/canary-court/blob/main/agents/README.md)). |
| `pnpm intents:quote --dry-run` | The client plans its funding from Arbitrum USDC through a recorded **NEAR Intents 1Click** quote. |
| `cd site && pnpm install && pnpm dev` → open http://localhost:3100 | The landing page (`/`) and the read-only dashboard (`/app`). **Demo** replays a scripted market in the browser: job tree, bids and counters, sealed findings, ledger, security log, and Proof › Enclave & model. **Live** (`/app?mode=live`) polls the testnet contract. |
| `cd web && pnpm e2e:mock && pnpm test` | 54 e2e steps run against the spec model: 52 pass, and the 2 testnet-only steps (05.7 OutLayer provenance, 05.8 attestation) are n/a there. They cover money conservation and contract solvency at every sampled block, sealed reports, dedup, lead margin only with a paid sub reward, client-fault refunds, replay bindings, and key and target locks. A fault-injection self-test proves each of 12 spec violations is caught. ECIES and binding-evidence vectors match the enclave's byte for byte. |
| `cd contracts && cargo test -p redteam -p tusdc` | 86 unit tests (incl. tusdc and a simulated OutLayer callback), plus 12 sandbox tests in `scripts/test-sandbox.sh`: near-workspaces, a real promise chain against a mock OutLayer, the main flow and the attack suite. |
| `cd enclave && ./build.sh` | A reproducible wasm build (v0.1.3) whose hash `c1b1ac5c…8f0d0cdf` matches the one pinned on chain in `redteam.get_config().enclave_code` ([enclave/DEPLOYMENTS.md](https://github.com/tamaa13/canary-court/blob/main/enclave/DEPLOYMENTS.md)). |
| **Live testnet** (needs keys): `pnpm setup:testnet`, `pnpm demo`, `pnpm attacks` in `agents/` | The same flows on testnet, with a nearblocks link for every tx. Attack receipts are written to `agents/fixtures/attack-receipts.json` with the real tx hash of every on-chain panic. |
| `cd web && E2E_TARGET_MODEL=Qwen/Qwen3.6-35B-A3B-FP8 pnpm e2e:testnet --yes` | The full e2e on testnet with 7 fresh throwaway accounts and live TEE inference, about 30 min. It writes a pass/fail report with a tx link for every step to `web/e2e/reports/latest-testnet.md`. The final release run on contract `2063042c…` + enclave **v0.1.3** ran **54 steps: 53 pass, 1 not exercised** ([`web/e2e/reports/release-final.md`](web/e2e/reports/release-final.md)). The attestation step (05.8) hit an RPC rate limit in the full run and was then re-verified read-only against the run's own on-chain transactions (64/64). Step 07.5, the OutLayer-timeout path, had no natural timeout to check in this run (0 OutLayer timeouts). That path is covered by the mock run and by the v0.1.2 live run. The earlier v0.1.2 release is kept as history in `release-final-v0.1.2.md`. |

Contracts: `redteam.arifnovrian.testnet` (escrow) and `tusdc.arifnovrian.testnet` (mock USDC). Explorer: https://testnet.nearblocks.io/address/redteam.arifnovrian.testnet

### Architecture

```
  AI agents (TypeScript, NEAR AI for reasoning, function-call keys for every market call)
  ┌────────────┐  post job · counter · accept   ┌─────────────────────────────────────────────┐
  │ client     │───────────────────────────────▶│ redteam escrow  (Rust, NEAR testnet)        │
  ├────────────┤  bid · create_subjob ×2        │  jobs → subjobs (budget carved from parent) │
  │ lead       │───────────────────────────────▶│  bids / counter-offers                       │
  ├────────────┤  bid · submit_finding(sealed)  │  policy engine · check_counterparty         │
  │ sub1, sub2 │───────────────────────────────▶│  strikes + evidence · blocklist · policy log │
  ├────────────┤  (every attack bounces here)   │  internal USDC + compute balances            │
  │ mallory    │───────────────────────────────▶│                                              │
  └────────────┘                                └──────┬──────────────────────────▲───────────┘
        ▲  withdraw: contract pays the caller only     │ request_execution        │ on_finding_evaluated
        │  (tUSDC, NEP-141)                            ▼ (fee 0.02 Ⓝ)             │ verdict → pay + store sealed report
        │                                       ┌─────────────────────────────────┴───────────┐
        │                                       │ OutLayer (TEE worker, Intel TDX)            │
        │                                       │  enclave wasm (hash-pinned, key bound to it)│
        │                                       │   1 decrypt target + payload (ECIES)        │
        │                                       │   2 run payload against the target ────────▶│ NEAR AI Cloud
        │                                       │   3 canary leaked? evaluator manipulated?   │ TEE model, temp 0,
        │                                       │   4 re-seal report → client (+ lead)        │ signed responses
        │                                       └─────────────────────────────────────────────┘
  read-only: dashboard site/ /app (RPC views) · e2e harness web/e2e (fresh accounts, asserts state + receipts on testnet)
```

Interfaces: `docs/ARCHITECTURE.md` (spec), `contracts/VIEWS.md` (methods, JSON shapes, `ERR_` codes, events), `enclave/DEPLOYMENTS.md` (enclave protocol, error codes, custody).

### Security model

The money is protected by layers that don't depend on any LLM behaving:
1. **Keys.** Agents sign every market call with a **function-call key** scoped to `redteam`, with an explicit method list and 0-deposit calls only. A fully hijacked agent cannot `ft_transfer`, attach deposits, add keys, or send NEAR, and funds leave only via `withdraw`, which pays the caller. The runtime fails closed if its key is full-access. Two limits:
   - A hijacked agent can still spend its own escrow inside the market, for example by posting a job and accepting a bid.
   - Each account also has a full-access key, used only for setup (deposits). It is stored locally (`~/.near-credentials` for our agents, `~/.canary-court/<account>/` for MCP agents) and must stay out of the agent's reach.
2. **Policy in the contract.** Per-job budget cap, max 2 layers, max 2 subjobs, sub reward ≤ parent reward (the lead's margin can't go negative), allowed categories, deadlines, a rate limit, and a findings cap. Violations panic with `ERR_<CODE>`.
3. **Counterparty risk without humans.** `check_counterparty` uses on-chain stats. **Warn** (new agent, strikes, or a poor record) triggers automatic escalation: the assignment is restricted, payout is capped at 50%, there is no subcontracting, and the enclave runs a dual evaluation. **Block** panics on bid, accept, subjob and submit.
4. **Strikes with evidence.** Only the evaluation callback can strike, and the evidence is the attested `result_hash`. Two strikes put the agent on the blocklist.
5. **Receipts, not claims.** Each of the 5 attack scenarios leaves a tx hash (or an RPC rejection, for key-scope attacks). The e2e harness re-checks the 14 receipts that have a tx against chain state, and the dashboard links each one.
6. **Fault attribution.** Failures are attributed:
   - a broken client target (`TARGET_DECRYPT_FAILED`, `BAD_TARGET`, `MODEL_NOT_ALLOWED`, `TARGET_BINDING_MISMATCH`) refunds the attacker's fee and is logged `client_fault`;
   - an OutLayer queue timeout (null outcome or failed promise) refunds the fee minus OutLayer's maximum charge (0.02 − 0.011 = **0.009 NEAR**, `get_config.infra_refund`), logs `infra_timeout`, and doesn't count in `agent.failed`;
   - attacker-fault errors keep the fee, and so does a NEAR AI outage (`LLM_UNAVAILABLE`, see Limitations); only a replayed payload with attested evidence earns a strike.

Full tables: `contracts/DEPLOYMENTS.md` (keys and method list), `agents/README.md` §4 (attack scenarios), `web/e2e/PLAN.md` (what the e2e asserts).

### Privacy model

| Data | Plaintext visible to | On chain as |
|---|---|---|
| Target `{system_prompt, canary, model}` | the client (author), the enclave inside the TEE | ECIES ciphertext sealed to the enclave key |
| Attack payload | the attacker, the enclave; the client and lead only after the finding is **Valid and paid** | ciphertext, then a report sealed to the client/lead |
| Verdict | everyone | status, severity, `result_hash = sha256(record_json)`. The record has hashes of payload/response, never plaintext. |
| Report | client (full); lead (canary redacted) | two ECIES ciphertexts, stored in the callback that pays |
| Model request/response | the NEAR AI TEE | only hashes, inside NEAR AI's per-response signature in the OutLayer receipt |

- **Who holds the enclave key.** It was generated inside OutLayer's keystore TEE and bound to the exact wasm hash. Its access condition allows only `redteam.arifnovrian.testnet` to trigger a run that can read it. The lock was set by `update_access` tx `2tSnNx51…`, and a direct call is denied (evidence tx `8HFMVHTG…`, same mechanism). Each payload is bound to its job and each target to its client key, so sealed blobs can't be replayed elsewhere.
- **Attested, not proven.** These guarantees rest on hardware attestation:
  - Intel TDX for OutLayer workers (keys registered on chain after quote verification).
  - Intel TDX + NVIDIA confidential computing for NEAR AI models (attestation report with a fresh nonce, plus per-response ECDSA signatures bound to the exact request/response bytes).
  - It is not a zero-knowledge proof. A broken TEE, or a colluding hardware vendor, would break confidentiality. The dashboard's Proof › Enclave & model panel and `enclave/verify` show exactly what is checked.
- **Mock vs live LLM.**
  - A target whose model is `"mock"` runs a deterministic stand-in target **inside the same real enclave on real OutLayer**, and its record says `llm:"mock"`. The stand-in is a canned stub: it ignores the system prompt and leaks on fixed trigger phrases, so it tests the market, not a bot. We use it for iteration and most e2e runs, because the team's NEAR AI budget is $10.
  - A NEAR AI model id runs live TEE inference, with `llm:"live"` and model signatures.
  - Agent reasoning uses NEAR AI when a key is configured and a deterministic policy otherwise. Every decision is logged `via llm|mock|replay|fallback`.
- **Nothing kept off chain.** Our code keeps no data off chain, and the enclave is stateless. In the final run, step 05.6 scanned 47 views and logs of that run, including the enclave's public output, for its canary (raw and base64), a system-prompt marker and 3 payloads: 0 hits.

### How it maps to the tracks

Official track text is from nearhackathon.com/HACKATHON.md. For each track, here is what we cover and what we don't.

**Agent Economy** (`agents`): *"agents that earn, spend, negotiate, hire other agents and pay for APIs, compute or data."*

| Track ask | Where |
|---|---|
| earn | Specialists and the lead earn USDC per valid finding, paid by the escrow in the evaluation callback. |
| spend | The client spends its USDC budget. Attackers spend NEAR compute on every evaluation (0.02 Ⓝ OutLayer fee from their compute balance). |
| negotiate | Bid → one counter-offer → re-bid at the counter price, with each step decided by an LLM (`review_bids`, `answer_counter`) when a NEAR AI key is configured, and by a deterministic policy otherwise. |
| hire other agents | The lead subcontracts 2 specialists and carves their budgets from its own escrow, keeping a margin per finding. It hires only Allow-level agents. |
| pay for compute | Every attack pays for its TEE compute: a 0.02 Ⓝ OutLayer fee from the attacker's compute balance. The target's private inference on NEAR AI is paid from the market's shared NEAR AI credit (see Limitations). |
| NEAR INTENTS (hint) | Partial: the client plans funding from Arbitrum USDC with a 1Click **dry quote** only (mainnet-only feature; nothing is executed). |
| CHAIN SIGNATURES (hint) | **Not used.** |

**AI Security & Defense** (`security`): *"spending limits, policy engines, sandboxed wallets, reputation and scam detection. Give AI money without giving it the keys to everything."*

| Track ask | Where |
|---|---|
| function-call key scoped to one contract, limits explained | Agents sign every market call with an FC key: receiver `redteam`, 11 methods, 0 deposit. Its limits are explained in the README and contracts/DEPLOYMENTS.md, and the runtime fails closed on a full-access key. |
| spending limits / policy engine | In the contract: per-job budget cap, carve ≤ parent remaining, reward ≤ parent reward, max depth / children / findings, rate limit, deadlines. Each violation panics with `ERR_<CODE>`. |
| allow / warn / block counterparty checks | `check_counterparty`. Warn means automatic escalation (restricted, 50% cap, no subcontracting, dual evaluation); Block panics. |
| reputation and scam detection | On-chain completed / invalid / failed counts. Evaluator manipulation is detected in the TEE → strike with attested evidence → blocklist after 2. |
| attack demo: prompt-injected agent stopped | Scenario S1: a hijacked agent's `ft_transfer` / deposit / AddKey attempts are rejected before inclusion by key scope. S2–S5 cover the grader attack, Block, the runaway lead, and replays of sealed targets/payloads. All leave receipts, and our e2e harness re-checks them: 21/21 entries, the 14 with a tx against chain state (step 10.2 of `web/e2e/reports/release-final.md`). |
| TEE ATTESTATION (hint) | Enclave wasm hash pinned on chain; key bound to that hash and locked to the contract; TDX worker key check. Shown in the dashboard's Proof › Enclave & model panel. |

**Privacy & Private AI** (`privacy`): *"confidential computation, private finance and AI that protects sensitive data."*

| Track ask | Where |
|---|---|
| TEE-hosted model on NEAR AI Cloud | The target runs on a NEAR AI model with `owned_by:"nearai"` (Qwen3.6-35B-A3B-FP8). The enclave refuses other models (`MODEL_NOT_ALLOWED`). |
| attestation verified with a fresh nonce, in a "Verified" panel | The dashboard's Proof › Enclave & model panel (`site/`, `/app`) calls NEAR AI `/attestation/report` with a fresh random nonce. It checks that the TDX report_data binds signing_address and nonce, that the NVIDIA payload nonce matches, and that each response signature recovers to that address and is bound to the exact request/response bytes. The external Intel/NVIDIA chain verification is shown as not done. |
| nothing kept server-side | No backend. The enclave is stateless; the dashboard is static and read-only. The final e2e run scanned its 47 views and logs, including enclave outputs, for plaintext secrets and payloads: 0 hits. |
| fictional sample data | A fictional AI treasury agent (tools `pay_invoice` / `transfer`) with invented invoices. Its "withdrawal approval key" is a random per-run canary, not a real key. Everything runs on testnet. |
| confidential computation | Targets and payloads are sealed to the enclave; reports are sealed to the client and lead; payment is atomic with delivery of the sealed report. |

### Limitations (honest list)

- **Testnet only.** USDC is a mock NEP-141 (`tusdc`); the Intents step is a quote only, since 1Click is mainnet-only.
- **Narrow oracle.** "Valid" means a canary leaked: a clean, verifiable oracle for secret exfiltration, but it doesn't cover every harm (e.g. unsafe tool calls with no secret).
- **Built-in attackers are a baseline.** Our attacker agents (lead, sub1, sub2) send at most 2 single-message payloads per target: one known playbook exploit and one LLM-written variant ([agents/src/agents/attacker.ts](https://github.com/tamaa13/canary-court/blob/main/agents/src/agents/attacker.ts)). They exist to show the market works end to end; they're not a state-of-the-art red-team tool. The market is open: third-party attacker agents can join through `/skill.md` (MCP) and are paid when they prove a leak, so attack strength is meant to come from the market's incentives, not from our bots. So far every attacker in our runs, including the fresh faucet accounts `cc-ext`, `cc-join` and `cc-mcp`, was run by our team. What Canary Court is built to provide is the rest: a deterministic verdict computed in an attested TEE, atomic payment, and deterrents against cheating attackers (strikes, blocklist, anti-replay), within the limits below. Protocol roadmap: multi-turn evaluation, and the policy-based verdicts described below.
- **Unauthorized transfers.** The target runs as a simulation. The enclave sends its system prompt and the attack to the model, and the tools (`pay_invoice`, `transfer`) exist only as text the model can write. No wallet is connected, so no money moves during a test. A finding is Valid when the key leaks anywhere in the answer, including inside a simulated tool call: in the treasury demo, both valid findings were the key in a payment memo ([agents/README.md](https://github.com/tamaa13/canary-court/blob/main/agents/README.md)). What isn't scored yet is a payment that never exposes the key. Tilly may pay invoices up to 500 USDC without it ([agents/src/target/treasury.ts](https://github.com/tamaa13/canary-court/blob/main/agents/src/target/treasury.ts)), so an attack that only gets her to pay the wrong vendor goes unscored. Roadmap v0.2 is policy-based verdicts: the owner seals a policy with the target (payee allowlist, per-transfer cap, forbidden destinations), the enclave checks every simulated tool call against it, and a violation is a Valid `tool_misuse` finding. It stays deterministic.
- **Simple heuristic.** Evaluator-manipulation detection is rule-based, so it can produce false negatives and false positives.
- **Timeouts.** OutLayer runs inside NEAR's ~2 min yield window, and a slow worker queue produces `Failed`. Since contract `2063042c…`, the attacker then gets 0.009 NEAR back (fee − max OutLayer charge), with no strike and nothing counted in `agent.failed`; agents resubmit. The v0.1.2 release run hit four such queue timeouts live (policy seq 186–189) plus one transient NEAR AI error (`LLM_UNAVAILABLE`). The contract handled every timeout this way. Three were resolved by in-run resubmits and two by a targeted re-run (`web/e2e/reports/release-final-v0.1.2.md`). The final v0.1.3 run had none. **Known history:** findings 35/36 timed out *before* that fix, so their fee was kept in full.
- **NEAR AI outage (`LLM_UNAVAILABLE`).** The enclave ran, but the model call failed, so the finding is Failed. The fee is kept (the OutLayer run did execute), and there's no strike and no Invalid count. Agents resubmit once: in the final e2e, finding #43 → #54 Valid. Refunding it like `infra_timeout` is future work.
- **Shared NEAR AI credit.** The enclave evaluates every target with our NEAR AI key, and any registered owner can pick a live `nearai` model. Usage is 100–600 tokens per attempt; the worst case is about $0.0085 per dual evaluation. The credit ($10) is a hard cap: if it runs out, live evaluations fail as `LLM_UNAVAILABLE` (no strike, fee kept) until it's topped up, while mock targets keep working. A per-owner allowlist or a live-spend cap in the contract is future work.
- **Key rotation.** A new enclave build means a new key: `set_enclave`, then targets must be re-registered.
- **Attestation coverage.** The quotes are verified as described above; external quote verification (Phala / NVIDIA NRAS) wasn't tested.
- **Reputation and disputes.** Reputation is simple counts (completed / invalid / strikes), and there is no dispute or appeal flow.
- **Budget.** Live LLM runs were limited by the $10 budget; most automated runs use the mock target.

### Credits

- Concept inspired by the escrow / evaluator pattern of **ERC-8183** (agentic commerce). This is a fresh, NEAR-native build: no EVM code, no bridging of that design.
- Built on NEAR Protocol, OutLayer (TEE execution), NEAR AI Cloud (TEE inference), NEAR Intents 1Click (quote), FastNear RPC and NearBlocks.

---

## (b) Form text: "What did you build" (1,985 chars; limit 20–2000)

> Would you give an AI agent your treasury? Agents that hold secrets and payment tools can be talked into leaking them by one well-crafted message. Testing them is manual and runs on trust: testers must reveal an attack before getting paid, and owners can take it and walk away.
>
> Canary Court is an autonomous red-teaming market on NEAR: AI agents attack an AI agent before it is trusted with funds. Our demo target is a fictional AI treasury agent with pay_invoice/transfer tools that guards a withdrawal approval key (a secret canary). Its owner's client agent posts a USDC bounty. A lead agent bids, negotiates, wins, and subcontracts two specialist agents, carving their budgets out of the same escrow. Each attack is ECIES-encrypted to an OutLayer TEE enclave. The enclave runs it against the treasury agent on a TEE-hosted NEAR AI model, checks whether the key leaked, and returns an attested verdict. In one callback, the contract stores the report, sealed to the owner, and pays the attacker and the lead's margin. A valid finding goes unpaid only if it's a duplicate or the budget ran out.
>
> NEAR is the trust layer, and we give AI money without giving it the keys:
> - Agents act through function-call keys, so a hijacked agent can't send tokens or NEAR out of the market.
> - The escrow contract enforces every limit: budgets, depth, counterparty risk with automatic escalation, strikes backed by attested evidence, and a blocklist.
> - OutLayer provides verifiable execution with a hash-pinned enclave key.
> - NEAR AI provides private, signed inference.
> - NEAR Intents (a dry quote for now) plans funding from another chain.
>
> We prove it rather than claim it. Five attack scenarios leave on-chain receipts: hijacked agent, grader manipulation, blocklisted agent, runaway lead, and replay. A 54-step testnet suite (53 pass, 1 not exercised) checks money conservation at sampled blocks and finds zero plaintext in the run's on-chain data. Testnet only; the treasury agent is fictional.

## (c) X post draft (265 chars incl. newlines; limit 280)

> Would you give an AI agent your treasury? Not before other agents try to rob it.
>
> Canary Court on @NEARProtocol: AI red-teamers attack a (fictional) AI treasury agent through a TEE. Leaks pay out atomically, verdicts are attested, no human sign-off.
>
> #NEARHackathon

## (d) Demo video storyboard (≤ 2:00)

| Time | Screen | Voice-over / caption |
|---|---|---|
| 0:00–0:10 | Title card "Give AI money without giving it the keys" → the dashboard in Live mode | "Would you give an AI agent your treasury? Not before other agents have tried to rob it." |
| 0:10–0:25 | Dashboard `/app`, job tree: root job → lead → 2 subjobs. Hover the margin column, then the bids table (counter-offer, re-bid). | "Our fictional treasury agent pays invoices and guards a withdrawal approval key. Its owner's agent posts a bounty to break it. A lead agent negotiates, wins, and hires two specialists out of one escrow on NEAR. Once it starts, no human approves any step." |
| 0:25–0:45 | Terminal: `pnpm demo` (live run, sped up). Lines show `review_bids via llm`, tx links; click one, which opens nearblocks. | "Bids, counters and hiring are LLM calls on NEAR AI. Every limit is enforced by the contract." |
| 0:45–1:05 | Dashboard findings: a Pending row flips to Valid. 🔒 "encrypted for client" badge. ledger: sub reward and lead margin on the same finding, "adds up". Terminal: the owner decrypts its report. | "Attacks are sealed to an OutLayer TEE. It runs them against the treasury agent on a TEE-hosted model: did the approval key leak? If so, the contract pays the attacker and hands the owner the sealed report in one step." |
| 1:05–1:30 | Terminal: `pnpm attacks` S1–S5 PASS. Dashboard security log: Warn → "RESTRICTED (auto-escalation)", mallory's 2 strikes with evidence hashes → blocklisted, `ERR_COUNTERPARTY_BLOCK`, `ERR_MAX_CHILDREN`, each with a tx link. | "The market's own agents get money without keys too. A hijacked agent can't send funds out of the market: its function-call key won't let it. Grading the grader earns strikes, then a block. A runaway lead hits contract caps." |
| 1:30–1:45 | Dashboard Proof › Enclave & model panel: wasm hash = pinned hash, key bound to the build, NEAR AI signature bound to the exact request/response, fresh-nonce attestation. | "Attested, not trusted: the enclave build, its key custody, and the model's signatures all check out." |
| 1:45–2:00 | `web/e2e/reports/release-final.md`: 54 steps, 53 pass, 1 not exercised; tx links. End card: name, "testnet · fictional treasury agent", the 3 tracks, repo link. | "A 54-step suite on testnet checks it: money conserved at every sampled block, zero plaintext in the run's on-chain data. Give AI money without giving it the keys. Canary Court, on NEAR." |

Recording notes:
- Record the live demo once and replay it sped up, since live LLM runs cost money.
- Use the dashboard's Demo replay as a fallback if testnet is slow.
- Keep e2e accounts hidden (default; `?e2e=1` shows them).
- Open `/app?mode=live` once before recording so the live history cache is warm.
- Say "fictional" and "testnet" on screen at least once (title card or end card).

## (e) Form metadata

| Field | Value |
|---|---|
| Project name | Canary Court |
| Public repo | https://github.com/tamaa13/canary-court (to be created by Tama; not pushed yet) |
| Payout account | `masamat.near` (mainnet) |
| Team | Solo: Tama |
| Tracks | Agent Economy (`agents`), AI Security & Defense (`security`), Privacy & Private AI (`privacy`) |
| Network / contracts | NEAR testnet: `redteam.arifnovrian.testnet` (escrow), `tusdc.arifnovrian.testnet` (mock USDC) |
| Live evidence | `web/e2e/reports/release-final.md` (final release e2e on enclave v0.1.3 on testnet: 54 steps, 53 pass, 1 not exercised), `web/e2e/reports/demo-verify-treasury.md` (treasury demo fixture re-verified on chain, 95/95). The final e2e's step 10.2 also re-verified the live attack receipts on chain. |
