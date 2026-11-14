# Canary Court `redteam` contract: methods, JSON shapes, errors, events

Source of truth for rt-agents / rt-web. The samples below were generated from the contract (`cargo test -p redteam print_view_samples -- --ignored --nocapture`).

**JSON conventions**
- `U128` values (USDC amounts in 6-decimal base units, NEAR amounts in yocto) are **strings**.
- `u64` values (ids, `deadline_ms`, `ts_ms`, `seq`, `block_height`) and `u8`/`u32` values are **numbers**.
- Enums are **strings**. Missing optionals are `null`.
- Paginated views take `from` and `limit`, both optional numbers (limit defaults to 50, max 200).

## Calls (all 0-deposit unless marked)

| method | args | returns | who |
|---|---|---|---|
| `new` | `owner_id, token_id, outlayer_id, enclave_code: JSON, enclave_pubkey: hex64, secrets_ref?: JSON, resource_limits?: JSON` | – | init |
| `set_enclave` | `code: JSON, enclave_pubkey: hex64, secrets_ref?: JSON, resource_limits?: JSON` | – | owner |
| `set_policy` | `policy: Policy` (full object, see get_config) | – | owner |
| `resync_compute_liabilities` | `extra_accounts: [AccountId]` (non-agent depositors) | `U128` new Σ compute | owner |
| `deposit_compute` | – (**payable**, attach NEAR) | `U128` new compute balance | anyone |
| `ft_on_transfer` | via `tusdc.ft_transfer_call(receiver_id=redteam, amount, msg="")` | – | token |
| `withdraw` | `amount: U128` | Promise→`bool` | anyone with balance |
| `withdraw_compute` | `amount: U128` (yoctoNEAR) | Promise→`bool` (NEAR transfer to caller, re-credit on failure) | anyone with compute balance |
| `register_agent` | `role: "client"\|"provider"\|"evaluator", x25519_pubkey: hex64, meta: String(≤512)` | `Agent` | anyone. Re-calling updates pubkey/meta; the role is fixed. The pubkey is frozen while you're client/lead of a job before its deadline (`ERR_KEY_LOCKED`). Zero/small-order keys → `ERR_BAD_KEY`. |
| `register_target` | `target_id: [A-Za-z0-9._-]{1,64}, enc_target: base64(≤8192), categories: [String]` | `Target` | client. Re-registering an id is refused until the max deadline of jobs on it (`ERR_TARGET_LOCKED`). |
| `create_job` | `target_id, budget: U128, reward_per_finding: U128, categories: [String], deadline_ms: u64` | `u64` job id | client = target owner |
| `place_bid` | `job_id, price_per_finding: U128, note: String(≤256)` | – | provider (re-bid updates the price; that's how a counter is accepted) |
| `counter_bid` | `job_id, bidder, price_per_finding: U128` | – | job client, once per bid |
| `accept_bid` | `job_id, bidder` | – | job client |
| `create_subjob` | `parent_id, budget: U128, reward_per_finding: U128, categories, deadline_ms` | `u64` job id | parent.provider |
| `submit_finding` | `job_id, enc_payload: base64(≤8192), category?: String` | `u64` finding id (evaluation lands async) | job.provider. **Attach 300 TGas** |
| `on_finding_evaluated` | `job_id, finding_id` | `FindingStatus` | private (OutLayer callback) |
| `expire_job` | `job_id` | – | anyone, after deadline |

Agent function-call key method list (0-deposit, receiver = redteam):
`register_agent, register_target, create_job, place_bid, counter_bid, accept_bid, create_subjob, submit_finding, expire_job, withdraw, withdraw_compute`

### Semantics
- **accept_bid** uses the bid's current `price_per_finding`. It must be ≤ `job.reward_per_finding`, and the job's reward is then lowered to that price. It runs `check_counterparty(bidder)`:
  - `Block` → `ERR_COUNTERPARTY_BLOCK`.
  - `Warn` → `restricted=true`, `payout_per_finding = price * warn_reward_cap_bps / 10000`, `can_subcontract=false`, and the enclave gets `dual:true`.
  - The winning bid becomes `Accepted` and all others `Rejected`.
- **create_subjob** checks, in order:
  1. caller is the provider (`ERR_NOT_PROVIDER`)
  2. parent is `Assigned` (`ERR_STATUS`)
  3. `parent.depth < max_depth` (`ERR_DEPTH`)
  4. `parent.can_subcontract` and the lead's verdict is `Allow` (`ERR_NO_SUBCONTRACT`; Block gives `ERR_COUNTERPARTY_BLOCK`)
  5. fewer than 2 children (`ERR_MAX_CHILDREN`)
  6. `budget ≤ parent.remaining` (`ERR_BUDGET_CAP`)
  7. `reward ≤ budget` and `reward ≤ parent.reward_per_finding` (`ERR_REWARD`)
  8. categories ⊆ parent's (`ERR_CATEGORY`)
  9. deadline in `(now, parent.deadline]` (`ERR_DEADLINE`)
  10. rate limit (`ERR_RATE_LIMIT`)
- **Duplicates:** per root job (the root and its subjobs), the same attack is paid at most once. The key is the enclave's `dedup_key` (HMAC over root_job_id + the category the contract sent + normalized payload) when present, else `result_hash`. A repeat is `Valid` + `unpaid:true`, logged as `duplicate`, and does not count toward `completed` or close the job. This only catches *identical* evaluated results: at temperature 0 the same payload usually yields the same response, but paraphrases still pay.
- **Solvency:** `register_agent`, `register_target` and `submit_finding` panic `ERR_STORAGE` if `balance − storage_cost < Σ compute deposits + 0.5 NEAR`, so contract-paid storage can never eat agent deposits.
- **Valid finding payouts:**
  - Root job: the provider gets `payout_per_finding`.
  - Subjob: the sub gets `subjob.payout_per_finding` from `subjob.remaining`, and the lead gets `parent.reward_per_finding - subjob.reward_per_finding` from `parent.remaining`. The lead margin is paid **only if the sub's leg was paid** for that finding. An unpaid sub leg (subjob budget exhausted, or a duplicate) means `paid_lead = 0`, and the margin stays in `parent.remaining`.
  - If remaining is insufficient, the finding is `Valid` + `unpaid:true` and the job becomes `Closed` (its remaining is refunded up the tree).
- **Evaluation outcomes:**
  - `valid && !manipulation` → Valid; `agent.completed += 1` (unless it's a duplicate).
  - `manipulation` → Invalid + strike (evidence = `result_hash`), even if `valid`. At `strikes_to_block` strikes → `blocked`.
  - `!valid` → Invalid; `agent.invalid += 1`.
  - **OutLayer produced nothing** (promise failure `"outlayer execution failed"`, or null output `"outlayer: run failed or produced no output"`, e.g. a queue/yield timeout) → **Failed**, with:
    - `fee_paid − outlayer_max_charge` refunded to the attacker's compute. With the current limits that's exactly **0.009 NEAR**, see `get_config.infra_refund`;
    - a policy-log entry `infra_timeout` (detail `finding <id> (job <id>): …`);
    - **no** `agent.failed` increment, and no strike;
    - `finding.error` keeps OutLayer's original message.
  - OutLayer `success:false`, enclave `error != null`, unparseable output, a `job_id`/`finding_id` mismatch, or malformed fields → **Failed**. No strike, the fee is kept, and `agent.failed += 1`.
    - Malformed fields mean `result_hash` is missing or not 64 lowercase hex, `dedup_key` is not 64 hex, or `severity` is not one of high|medium|low|none. The error is `"bad output: …"`.
  - **Client-fault** enclave errors `TARGET_DECRYPT_FAILED`, `BAD_TARGET`, `MODEL_NOT_ALLOWED` and `TARGET_BINDING_MISMATCH` → Failed, but the attacker's fee goes back to their compute balance, and the policy log gets `client_fault` (actor = root client).
  - **Errors never strike, except attacker-fault errors with attested evidence.** Today that's only `PAYLOAD_BINDING_MISMATCH` (a payload sealed for another job). It's Failed + strike, the fee is kept, and the evidence is `result_hash`. It strikes **only if all** of these hold:
    - the output carries `error_record` (the verbatim compact JSON string);
    - `sha256(error_record) == result_hash` (64 lowercase hex);
    - the record has `v:1`, `code == error`, and `job_id`/`finding_id` matching this request.

    Anything else gives no strike. That's fail-closed in the attacker's favour; the finding is just Failed.
  - Enclave `warnings` `BAD_CLIENT_KEY` / `BAD_LEAD_KEY` are non-fatal: the verdict stands (Valid is paid), that report is null, and `client_fault` is logged without a refund.
- **expire_job**:
  - Expires active children first, then the job itself.
  - Refunds roll up: child → parent.remaining (if the parent is active) → root client USDC balance.
  - Pending findings → `ERR_PENDING`, unless they're older than `pending_timeout_ms`, in which case they're force-Failed.
- **check_counterparty** returns:
  - `Block` if the agent is not registered or is blocked (2 strikes).
  - `Warn` if any of these hold: has strikes (the reason text reads `"N manipulation strike(s), evidence <hash>"` for every strike kind; a `PAYLOAD_BINDING_MISMATCH` strike is identified in its `strike` policy-log entry); `block_height - registered_block < min_age_blocks`; `completed < min_rep_completed`; `invalid ≥ 3 && invalid > 2*completed`.
  - `Allow` otherwise.
- **Rate limit:** `create_job` + `create_subjob` + `register_target` per agent, in a fixed 1-hour window. `register_target` counts because the contract pays for target storage.

## Errors
Every panic is `"ERR_<CODE>: human text"`. On-chain it shows up as `Smart contract panicked: ERR_<CODE>: ...`.

| code | when |
|---|---|
| `ERR_NOT_OWNER` | owner-only method |
| `ERR_NOT_REGISTERED` | caller (or required agent) not registered |
| `ERR_ROLE` | wrong role (create_job/register_target need client, place_bid needs provider) or role change on re-register |
| `ERR_NOT_TARGET_OWNER` | create_job on someone else's target / target_id taken |
| `ERR_NOT_CLIENT` | counter/accept by non-client |
| `ERR_NOT_PROVIDER` | submit_finding / create_subjob by non-provider |
| `ERR_BUDGET_CAP` | budget 0, > policy.max_budget, or subjob budget > parent.remaining |
| `ERR_REWARD` | reward 0 or > budget; subjob reward > parent reward; accepted bid price > job reward |
| `ERR_DEPTH` | subjob of a subjob |
| `ERR_MAX_CHILDREN` | 3rd subjob |
| `ERR_NO_SUBCONTRACT` | restricted provider, or lead currently Warn |
| `ERR_CATEGORY` | category not in policy / target / parent / job |
| `ERR_COUNTERPARTY_BLOCK` | verdict Block (bid, accept, create_job, create_subjob, submit) |
| `ERR_RATE_LIMIT` | > rate_limit_per_hour jobs |
| `ERR_DEADLINE` | deadline out of range / passed / expire before deadline |
| `ERR_BALANCE` | insufficient internal USDC |
| `ERR_COMPUTE` | compute balance < outlayer_fee, or withdraw_compute > balance |
| `ERR_STATUS` | wrong job status (not Open / Assigned / active), enclave not configured |
| `ERR_NOT_FOUND` | job / bid / target / finding not found |
| `ERR_SELF_DEAL` | bidding on your own job (client or root client) |
| `ERR_BID` | bid closed, countered twice, > 20 bids |
| `ERR_PENDING` | expire_job while an evaluation is in flight |
| `ERR_FINDINGS_CAP` | > max_findings_per_job |
| `ERR_GAS` | not enough gas attached to submit_finding |
| `ERR_INPUT` | bad pubkey / size limits / zero amounts / invalid policy |
| `ERR_STORAGE` | contract solvency guard: storage would eat agent compute deposits (owner must top up) |
| `ERR_TARGET_LOCKED` | register_target on an existing id before the max deadline of jobs on it |
| `ERR_KEY_LOCKED` | register_agent with a new pubkey while client/lead of a job before its deadline |
| `ERR_BAD_KEY` | x25519_pubkey is zero / a small-order point (libsodium blocklist, top bit ignored) |
| `ERR_TOKEN` | ft_on_transfer from a token other than tusdc |

tusdc: `ERR_MINT_CAP` (mint > 1000 tUSDC per call), `ERR_NOT_OWNER` (mint_to).

## Policy log actions (`get_policy_log`)
Only non-reverting decisions are logged:

| action | logged when |
|---|---|
| `accept_bid` | verdict Allow/Warn; detail says `RESTRICTED (auto-escalation)` on Warn |
| `create_subjob` | lead verdict, carve amount, lead margin |
| `strike` | verdict after the strike + evidence (detail says `manipulation attempt` or `attacker-fault enclave error PAYLOAD_BINDING_MISMATCH`) |
| `blocklist` | strike count reached `strikes_to_block` |
| `expire` | job expired |
| `refund` | detail says `rolled up to job N` / `refunded to root client X` |
| `close` | job closed |
| `unpaid` | valid finding could not be paid |
| `lead_margin_unpaid` | sub was paid but `parent.remaining` < margin (lead not paid) |
| `force_fail` | stale pending finding force-Failed |
| `withdraw_compute` | unused compute NEAR refunded to the caller |
| `duplicate` | valid finding repeats an already-recorded `dedup_key` (or `result_hash`) under the same root job; not paid |
| `infra_timeout` | OutLayer produced no output (yield timeout / worker failure); `fee − outlayer_max_charge` (0.009 NEAR now) refunded, not counted as failed |
| `client_fault` | enclave error TARGET_DECRYPT_FAILED / BAD_TARGET / MODEL_NOT_ALLOWED / TARGET_BINDING_MISMATCH (fee refunded to the attacker), or warning BAD_CLIENT_KEY / BAD_LEAD_KEY (no refund) |

## Events (logs)
Events use the NEP-297 format: `EVENT_JSON:{"standard":"redteam","version":"1.0.0","event":<name>,"data":[{...}]}`.

Event names:
- `agent_registered`, `target_registered`
- `deposit_usdc`, `deposit_compute`, `withdraw`, `withdraw_refunded`, `withdraw_compute_refunded`
- `job_created`, `subjob_created`
- `bid_placed`, `bid_countered`, `bid_accepted`
- `finding_submitted`, `finding_evaluated`
- `policy` (every policy-log entry)
- `enclave_updated`, `policy_updated`

## Enclave input (built by submit_finding, sent as OutLayer `input_data`)
```json
{"op":"evaluate","job_id":1,"root_job_id":0,"finding_id":0,"category":"prompt_injection","enc_target":"<b64>","enc_payload":"<b64>",
 "client_pubkey":"<hex root client>","lead_pubkey":"<hex lead>|null","dual":false}
```
The output is parsed from any of these forms:
- the bare §5 object
- `{"success":true,"result"|"output": <obj or JSON string>}`
- `{"Json"|"Text": ...}`
- a JSON string of any of the above

`v` must be `1`, and `job_id`/`finding_id` must match.

## View samples
```
=== get_job(1)
{"id":1,"parent_id":0,"depth":1,"client":"lead","root_client":"client","provider":"sub1","target_id":"bot",
 "budget":"30000000","remaining":"24000000","reward_per_finding":"6000000","payout_per_finding":"6000000",
 "categories":["prompt_injection"],"deadline_ms":1800003700000,"status":"Assigned","restricted":false,
 "can_subcontract":false,"children":[],"findings":[0],"pending":0,"created_ms":1800000100000}
   status: "Open" | "Assigned" | "Expired" | "Closed"

=== get_finding(0)   (get_findings(job_id) -> [Finding])
{"id":0,"job_id":1,"attacker":"sub1","category":"prompt_injection","status":"Valid","severity":"high",
 "manipulation":false,"unpaid":false,"paid_attacker":"6000000","paid_lead":"4000000",
 "report_for_client":"Q0xJRU5UUkVQT1JU","report_for_lead":null,"result_hash":"<64 hex>","dedup_key":"<64 hex>|null","error":null,
 "created_ms":1800000100000,"evaluated_ms":1800000100000}
   status: "Pending" | "Valid" | "Invalid" | "Failed"

=== get_bids(0)
[{"bidder":"lead","price_per_finding":"10000000","note":"accept counter","counter_price":"10000000",
  "status":"Accepted","created_ms":1800000100000}]
   status: "Open" | "Countered" | "Accepted" | "Rejected"

=== get_agent(sub1)   (list_agents(from, limit) -> [Agent])
{"account_id":"sub1","role":"provider","x25519_pubkey":"3333…","meta":"sub1","registered_ms":1800000000000,
 "registered_block":1,"completed":1,"invalid":0,"failed":0,
 "strikes":[{"finding_id":3,"evidence_hash":"…","ts_ms":…}],"blocked":false}

=== get_target(bot)
{"target_id":"bot","owner":"client","enc_target":"RU5DVEFSR0VU","categories":["prompt_injection","tool_misuse",
 "data_exfiltration","jailbreak"],"created_ms":1800000000000}

=== check_counterparty
{"level":"Allow","reasons":["age 100 blocks, 1 completed, 0 invalid, 0 strikes"]}
{"level":"Warn","reasons":["new agent: registered 0 blocks ago (< 60)"]}
{"level":"Block","reasons":["not registered"]}
{"level":"Block","reasons":["blocklisted: 2 manipulation strikes (evidence: h1,h2)"]}

=== balance_of(sub1)
{"usdc":"6000000","compute":"980000000000000000000000"}

=== get_config()
{"owner":"arifnovrian.testnet","token_id":"tusdc.arifnovrian.testnet","outlayer_id":"outlayer.testnet",
 "enclave_code":{"WasmUrl":{"url":"https://test.fastfs.io/…/<sha256>.wasm","hash":"<sha256>","build_target":"wasm32-wasip2"}},
 "enclave_pubkey":"<hex64>","secrets_ref":{"profile":"enclave","account_id":"arifnovrian.testnet"},
 "resource_limits":{"max_instructions":10000000000,"max_memory_mb":256,"max_execution_seconds":90},
 "policy":{"max_budget":"1000000000","max_depth":1,"max_children":2,"min_rep_completed":0,
   "warn_reward_cap_bps":5000,"rate_limit_per_hour":30,"outlayer_fee":"20000000000000000000000",
   "allowed_categories":["prompt_injection","tool_misuse","data_exfiltration","jailbreak"],
   "min_age_blocks":60,"strikes_to_block":2,"max_findings_per_job":20,"min_deadline_ms":60000,
   "max_deadline_ms":604800000,"pending_timeout_ms":900000},
 "outlayer_max_charge":"11000000000000000000000","infra_refund":"9000000000000000000000"}
   outlayer_max_charge = worst-case OutLayer charge under resource_limits (base 0.001 + instr + exec seconds
   + 2 s compile at outlayer.testnet pricing), rounded UP to 0.001 NEAR; infra_refund = outlayer_fee − that

=== get_policy_log(0, 3)
[{"seq":0,"ts_ms":1800000100000,"block_height":101,"actor":"client","action":"accept_bid","job_id":0,
  "verdict":{"level":"Allow","reasons":["age 100 blocks, 0 completed, 0 invalid, 0 strikes"]},
  "detail":"assigned to lead"},
 {"seq":1,…,"actor":"lead","action":"create_subjob","job_id":1,"verdict":{…},
  "detail":"carved 30000000 from job 0 (lead margin 4000000/finding)"}]

=== get_solvency()
{"balance":"8991…","storage_usage":372000,"storage_cost":"3720000000000000000000000",
 "compute_liabilities":"1320000000000000000000000","reserve":"500000000000000000000000",
 "headroom":"3951…","solvent":true}
   headroom = balance − storage_cost − compute_liabilities (signed decimal string); solvent = headroom ≥ reserve
   storage per item at 1e19 yocto/byte (0.01 NEAR/KB): agent ~0.6 KB, target ≤ ~8.3 KB, job ~0.8 KB,
   policy-log entry ~0.3 KB, finding ~0.5 KB + reports. A valid root finding with a typical 1.3 KB report is ~2 KB
   (0.02 NEAR). Worst case (2 reports × 6.8 KB) is ~14 KB (0.14 NEAR).

=== get_counts()
{"agents":5,"jobs":3,"findings":2,"policy_log":5}
```
