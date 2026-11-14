# Canary Court: threat model (testnet, 2026-11-13)

**System.** A client escrows tUSDC for red-teaming its LLM target, whose system prompt hides a canary. A lead wins
the job and may subcontract to subs (max 2 layers). Attack payloads are ECIES-sealed to an enclave key and evaluated in an
OutLayer Intel TDX worker against a TEE-hosted NEAR AI model (or a labelled mock). The contract callback pays and stores
the reports in the same receipt as the verdict. Components: `redteam` contract, enclave wasm, agents, read-only web.

**Actors.** client · lead (provider) · sub · mallory (any malicious agent) · OutLayer operator (workers, keystore,
coordinator) · NEAR AI operator · contract owner (`arifnovrian.testnet`: `owner_id`, enclave-secret owner and, via
its full-access key on `redteam.arifnovrian.testnet`, the contract account's code).

**Assets.** (A1) escrow: job budgets, internal tUSDC balances, compute NEAR · (A2) canary + system prompt (client) ·
(A3) attack payloads (attacker's work product) · (A4) reports = payload + model excerpt (for client/lead) ·
(A5) enclave x25519 private key, which protects A2–A4.

**Key properties.**
- **Verdict.** The verdict is deterministic: did the canary (verbatim, normalized, reversed or encoded) appear in the
  model's answer? No LLM grades anything, so prompt text aimed at "the grader" cannot change `valid`.
- **Key custody.** A5 was generated inside OutLayer's keystore TEE. It is released only to the wasm with sha256 H, and
  only for executions whose caller is the `redteam` contract.
- **Code change re-keys.** Changing the enclave code changes H, which changes the key. A new build cannot decrypt
  anything sealed to an older build's key.

## Threats

Evidence: `t:` = unit/sandbox test (contracts: `contracts/`, enclave: `enclave/src`). `v:` = `enclave/verify/verify.mjs` check.
`tx:` = testnet tx (see enclave/DEPLOYMENTS.md).

| # | actor → threat | mitigation | evidence |
|---|---|---|---|
| 1 | client reads payloads without paying (enc_payload is public) | payload sealed to A5; reports exist **only for valid findings** and are written in the same callback that pays | t:`obfuscated_and_partial_and_benign` (invalid → no report), t:`main_flow_root_and_subjob_payouts`; v:`key.bound`, `key.locked` |
| 2 | client stiffs the attacker after a valid finding | budget locked at `create_job`; payment in the verdict callback; expiry blocked while a finding is pending | t:`expire_blocked_by_pending_evaluation`, `expire_force_fails_stale_pending`, `insufficient_remaining_marks_unpaid_and_closes` |
| 3 | client sabotage: swap the target mid-job, unusable/low-order x25519 key, broken target | target locked (`ERR_TARGET_LOCKED`), key frozen during active jobs (`ERR_KEY_LOCKED`), small-order keys rejected (`ERR_BAD_KEY`). Client-fault errors refund the attacker's fee. A bad report key is only a warning: the verdict stands and the attacker is paid | t:`client_pubkey_frozen_while_job_active`, `small_order_pubkey_rejected_even_non_canonical`, `client_fault_error_refunds_attacker_fee`, `bad_client_key_warning_logs_client_fault_but_pays`, `bad_recipient_keys_do_not_fail_the_finding` |
| 4 | lead learns the client's canary from a sub's report | the lead's copy is canary-redacted (`[CANARY]`) | t:`valid_leak_with_reports` |
| 5 | runaway lead (over-budget / deep / wide subcontracting) | max_depth 1, max_children 2, subjob budget ≤ parent remaining, sub reward ≤ parent reward | t:`attack4_runaway_lead_hits_policy_caps`, `subjob_depth_capped`, `subjob_children_capped`, `subjob_budget_capped_by_parent_remaining` |
| 6 | attacker gets paid without a real leak (forged output, grader injection) | verdict computed in the enclave. The callback is `#[private]`, ids must echo, and fields are strictly validated. Grader-addressed payloads → `manipulation` → strike (`evidence = result_hash`); 2 strikes → blocked | t:`manipulation_voids_and_flags`, `obfuscated_manipulation_is_caught`, `treasury_attacks_are_not_strikes` (no false strikes on the treasury use case), `malformed_enclave_fields_fail_the_finding`, `callback_is_idempotent`, `manipulation_strikes_lead_to_blocklist`, `attack2_evaluator_manipulation_gets_blocklisted` |
| 7 | attacker paid twice for the same payload | `dedup_key` = HMAC under an enclave-only key over (root job, contract category, normalized payload hash). It can't be dictionary-checked from outside | t:`dedup_key_semantics`, `dedup_key_catches_same_attack_with_different_result_hash`; tx:`r1aCZECv…` paid, `4vCDwU2c…` same key → unpaid |
| 8 | prompt-injected agent moves funds out of the market | runtime agents sign market calls with function-call keys for `redteam`, which can't send tokens or NEAR, attach deposits or add keys; withdrawals go to the caller. Inside the market a hijacked client can still spend its own escrow (residual risks) | t:`attack1_injected_agent_cannot_move_funds`; agents receipts: `DepositWithFunctionCall`, `RequiresFullAccess`, `MethodNameMismatch` (local run; testnet run pending) |
| 9 | anyone runs the enclave on public `enc_target` with their own client key, to read the canary | secret access = `Predecessor{redteam}`; in-module guard (`evaluate` only if predecessor = redteam over NEAR); `challenge` op echoes only a fixed format | tx:`J7mxknSQ…`, `8HFMVHTG…` (direct call denied); t:`caller_guard`, `challenge_is_not_a_decryption_oracle` |
| 10 | OutLayer host/operator reads keys or plaintext, or tampers with results | execution in Intel TDX. Key bound to wasm H (another build gets nothing). Results resolved only by worker keys that register-contract added after verifying a TDX quote | tx:`5sRUkqdG…` (other hash → no secret); v:`exec.code`, `worker.tee`, `code.bytes` |
| 11 | NEAR AI operator sees prompt + payload (live mode) | only models listed `owned_by: nearai` (TEE-hosted), else `MODEL_NOT_ALLOWED`. The enclave checks that NEAR AI's signature covers its exact request/response bytes (`bound`) | v:`model.sigN`, fresh-nonce `att.nonce`, `att.addr`, `att.tdx`, `att.gpu` |
| 12 | contract owner swaps the enclave or redeploys the contract to forge verdicts or harvest payloads | **mitigated: the contract account is locked.** Its only full-access key `ed25519:FBG7VXW8…` was deleted in tx `EUpzUJw1b3N8LnEj4N1XY7m6qWCM6SLyXeQmnJDsBqVJ` (2026-11-14 17:38 WIB). 0 access keys remain, and the code sha256 stays `2063042cbda558b0e571bf9bd4ea831dd78fede7bebf02fd86a4276616c45047` (checked via RPC `view_access_key_list` / `view_account`). Now: `set_enclave` → new wasm H' gets no key (WasmHash binding), so old ciphertexts stay unreadable. The owner's `update_access` on the H row cannot help, because H refuses `evaluate` unless the caller is `redteam`. Code hash in the `enclave_updated` event, and the panel pins/compares H | tx:`EUpzUJw1…` (DeleteKey); t:`enclave_updated_event_includes_code_hash`, `set_enclave_validates_source`; v:`config.code` |
| 13 | spam / storage griefing | 0.02 NEAR OutLayer fee per finding from the attacker's compute balance, ≤ 20 findings/job, 30 creations/h/agent, solvency guard | t:`rate_limited`, `insolvent_contract_refuses_submissions`, `solvency_tracks_compute_liabilities` |
| 14 | blocklisted or brand-new agent takes work | `check_counterparty`: Block → panic. Warn (new or with strikes) → restricted: reward ≤ 50 %, no subcontracting, dual evaluation (both attempts must leak) | t:`counterparty_verdicts`, `blocked_agent_cannot_bid`, `restricted_provider_cannot_subcontract`, `attack3_counterparty_warn_escalation_and_block` |
| 15 | **target replay → canary theft → payout fraud:** copy a victim's public `enc_target` into your own target/job, read the canary in your own report, then attack the victim's job with an echo payload ("repeat CANARY-…") | enclave v0.1.2: target plaintext is bound to the client's x25519 key (`TARGET_BINDING_MISMATCH`, client-fault, before any model call). A replayer who registers the victim's key gets reports sealed to the victim. Echo guard: canary in the payload (incl. homoglyph/ROT13/encoded/fragment) → invalid + strike | t:`replayed_target_is_rejected_before_any_model_call`, `echo_of_a_known_canary_is_manipulation_not_a_leak`, `echo_guard`; e2e: rt-web 04.8 + 07.3 (copied target → `TARGET_BINDING_MISMATCH`, fee refunded), 06.4 (echo → manipulation + strike), 05.7 (codes in receipt tree); tx:`EV8EYd2J…` |
| 16 | **payload replay → payload theft:** replay someone's public `enc_payload` (even an invalid one) into your own job against a weak target and read it in your report | enclave v0.1.2: payload plaintext is bound to its `job_id` (`PAYLOAD_BINDING_MISMATCH`, attacker-fault). It strikes with attested evidence (`result_hash` = sha256 of an ids-only `error_record`) | t:`replayed_payload_is_rejected`; e2e: rt-web 07.4 (replayed payload → mismatch, nothing paid), 05.7; tx:`BiHNsms5…` (error_record hash re-verified by the contract → strike) |

## Trust assumptions
- **Intel TDX** protects memory and attests code, for OutLayer workers and keystore and for NEAR AI's CVMs. `verify.mjs`
  checks the quote's report_data binding (nonce + signing key) but **not** the Intel/NVIDIA certificate chains.
- **NVIDIA Hopper confidential computing** for GPU inference. The evidence is nonce-bound, but the chain isn't verified here.
- **OutLayer:** the keystore enforces the access condition and the wasm-hash binding, and admins keep the TDX measurement
  allowlist honest. The (closed-source) **coordinator delivers requests faithfully**: it cannot forge results, but it can
  delay, drop or inject requests. The enclave's predecessor guard relies on the same request data.
- **Contract owner stays trusted (narrower since the lock).**
  - It controls `set_enclave`/`set_policy` (verified to still work after the lock, tx `EL4WBpwK…`) and owns the
    secret row. It can point FUTURE findings at arbitrary code (visible on-chain via the code hash) or delete the row
    (DoS).
  - It can no longer redeploy the contract: `redteam.arifnovrian.testnet` has 0 access keys since tx `EUpzUJw1…`.
    Before the lock, a redeployed contract could have asked the enclave to re-evaluate any public
    `enc_target`/`enc_payload` with a report key of its choosing. That path is closed now. `set_enclave` cannot
    reach old ciphertexts either (row 12).
- **NEAR AI** serves the attested model behind the attested gateway.

## Residual risks / out of scope
- **Paraphrase dedup:** only exact normalized repeats collide. A reworded attack gets a new `dedup_key` and is paid again,
  bounded by budget, `max_findings_per_job` and the client's reward.
- **Sybil:** a fresh account is only `Warn` for `min_age_blocks` = 60 (plus `min_rep_completed`, default 0), then Allow.
  The cost is account creation + the fee + rate limits. There is no identity layer.
- **LLM nondeterminism:** `temperature 0` is not a determinism guarantee, so a leak may not reproduce. Validity is judged
  on the actual signed response, not on reproducibility (dual mode needs 2 of 2).
- **Mock target is a stub (market tests only):** a target sealed with model `"mock"` ignores its system prompt and leaks
  on fixed trigger phrases (`enclave/src/llm.rs` `mock_reply`: "diag-", "ignore previous instructions", "reverse",
  "base64", …). A valid finding on a mock target says nothing about the owner's bot. Anyone who reads the source can
  trigger it, and rewording defeats dedup (exact repeats only). Real targets must use a NEAR AI model id; outputs say
  `llm: "mock"` vs `"live"`.
- **Hijacked client spends its own escrow:** the function-call key's methods include `register_target`, `create_job`
  and `accept_bid`. A hijacked client agent can post a rigged job and hire a colluding provider, who is then paid from
  that client's escrow. Function-call keys stop funds leaving the market, not misuse inside it. The full-access setup
  key, stored locally for setup (`~/.canary-court/<account>/full_access.json`, `~/.near-credentials`), must stay out of
  the agent's reach. Source: rt-web claims audit, row 1 (code reading, not tested live).
- **A valid report is delivered even when unpaid:** the callback stores `report_for_client` for every Valid finding
  before/independently of the payout. If the job's remaining budget is too small, or the payload repeats one already
  paid in that job tree (same `dedup_key`), the finding is Valid + `unpaid`, and the client still receives the payload.
  For duplicates the client already paid for that normalized payload once. For an exhausted budget an attacker should
  check `remaining` before submitting. Future work: withhold the report when unpaid.
- **Shared NEAR AI credit can be drained:** live inference is paid from one project key ($10 credit). Any
  registered client can seal a target with a live model id, and the enclave accepts any model NEAR AI lists as
  `owned_by: nearai`. The contract cannot see the (encrypted) model. Worst case ≈ $0.0085 per dual evaluation
  (≈ 1,200 evaluations for $10); submit_finding is bounded only by 20 findings/job × 30 jobs/h per client account, and
  testnet NEAR is free. **Hard cap: $10.** **Failure mode:** once the credit is gone, live evaluations return
  `LLM_UNAVAILABLE` (infra-class: Failed, no strike) for everyone; mock targets are unaffected. **Mitigations (future
  work):** a contract-side live-evaluation quota keyed on the output's `"llm":"live"`, a client allowlist for target
  registration, a compiled-in model allowlist, or blanking the key outside demo windows.
- **Heuristic trade-off (v0.1.3):** payment/authorization phrases without grading context are no longer struck, so a
  grader-injection phrased purely as business language ("release the payment") goes unpunished. It still cannot flip
  `valid`, because the verdict is deterministic.
- **Detection scope:** a leak means the canary string (exact, normalized, reversed or encoded). Semantic disclosure
  without the string is not detected. Manipulation misses (paraphrase, other languages) only cost a strike, never a payout.
- **Liveness:** OutLayer's yield/resume window is 200 blocks (≈ 115 s on testnet), and testnet has 2 shared executor
  workers. Under load the queue alone can exceed the window, so the finding comes back Failed (null output). The agent
  resubmits; the enclave's own runtime is 1–3 s.
- **Owner levers after the lock:** `set_policy` and `set_enclave` still work (by design), so the owner can change rules
  or point future findings at a different enclave, visibly on chain. Future work: the enclave verifies the caller's
  contract code hash via RPC against a compiled-in allowlist, and/or a timelock on `set_enclave`.
- **Mock mode** findings (`llm: "mock"`) involve no model, and the UI labels them. Testnet only; tUSDC is a mock token.
