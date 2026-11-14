use super::*;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig, VMContext};

const USDC: u128 = 1_000_000; // 6 decimals
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const FEE: u128 = 20_000_000_000_000_000_000_000;
const T0_MS: u64 = 1_800_000_000_000;
/// fee 0.02 − ceil_0.001(base 0.001 + 1e4 Minstr × 1e14 + 90 s × 1e20 + 2 s compile × 1e20 = 0.010201) = 0.009
const INFRA_REFUND: u128 = 9_000_000_000_000_000_000_000;
const HOUR: u64 = 3_600_000;
const PK_CLIENT: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const PK_LEAD: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const PK_SUB: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const PK_ENCLAVE: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

struct Env {
    c: Contract,
    block: u64,
    ts_ms: u64,
}

fn ctx(pred: &str, deposit: u128, block: u64, ts_ms: u64) -> VMContext {
    VMContextBuilder::new()
        .current_account_id(acc("redteam"))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .block_height(block)
        .block_timestamp(ts_ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .build()
}

impl Env {
    fn new() -> Self {
        testing_env!(ctx("owner", 0, 1, T0_MS));
        let c = Contract::new(
            acc("owner"),
            acc("tusdc"),
            acc("outlayer"),
            json!({"Project": {"project_id": "redteam.testnet/enclave", "version_key": null}}),
            PK_ENCLAVE.into(),
            Some(json!({"profile": "default", "account_id": "redteam"})),
            None,
        );
        Env {
            c,
            block: 1,
            ts_ms: T0_MS,
        }
    }

    fn as_(&mut self, pred: &str) -> &mut Contract {
        testing_env!(ctx(pred, 0, self.block, self.ts_ms));
        &mut self.c
    }

    fn pay(&mut self, pred: &str, deposit: u128) -> &mut Contract {
        testing_env!(ctx(pred, deposit, self.block, self.ts_ms));
        &mut self.c
    }

    /// Moves the chain forward; views called directly on `e.c` afterwards see the new height/time.
    fn advance(&mut self, blocks: u64, ms: u64) {
        self.block += blocks;
        self.ts_ms += ms;
        testing_env!(ctx("anyone", 0, self.block, self.ts_ms));
    }

    fn callback(&mut self, job_id: JobId, finding_id: FindingId, r: PromiseResult) -> FindingStatus {
        testing_env!(
            ctx("redteam", 0, self.block, self.ts_ms),
            test_vm_config(),
            RuntimeFeesConfig::test(),
            Default::default(),
            vec![r]
        );
        self.c.on_finding_evaluated(job_id, finding_id)
    }

    fn fund_usdc(&mut self, who: &str, amount: u128) {
        let _ = self.as_("tusdc").ft_on_transfer(acc(who), U128(amount), "".into());
    }

    fn usdc(&self, who: &str) -> u128 {
        self.c.balance_of(acc(who)).usdc.0
    }

    fn compute(&self, who: &str) -> u128 {
        self.c.balance_of(acc(who)).compute.0
    }

    fn job(&self, id: JobId) -> Job {
        self.c.get_job(id).unwrap()
    }

    fn deadline(&self) -> u64 {
        self.ts_ms + HOUR
    }
}

fn out_json(job_id: JobId, finding_id: FindingId, valid: bool, manipulation: bool) -> Value {
    json!({
        "v": 1, "job_id": job_id, "finding_id": finding_id, "valid": valid,
        "manipulation": manipulation, "severity": if valid { "high" } else { "none" },
        "report_for_client": "Q0xJRU5UUkVQT1JU", "report_for_lead": null,
        "result_hash": hx(finding_id),
    })
}

/// 64-hex result hash derived from an id (enclave output format).
fn hx(n: u64) -> String {
    format!("{:064x}", n)
}

fn ok(v: Value) -> PromiseResult {
    PromiseResult::Successful(v.to_string().into_bytes())
}

fn wrapped(v: Value) -> PromiseResult {
    ok(json!({"success": true, "result": v, "error": null}))
}

const CATS: [&str; 4] = ["prompt_injection", "tool_misuse", "data_exfiltration", "jailbreak"];

fn cats(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// client, lead, sub1, sub2 registered and aged; client has 1000 USDC; providers have 1 NEAR compute;
/// target "bot" registered.
fn setup() -> Env {
    let mut e = Env::new();
    e.as_("client").register_agent(Role::Client, PK_CLIENT.into(), "client".into());
    e.as_("lead").register_agent(Role::Provider, PK_LEAD.into(), "lead".into());
    e.as_("sub1").register_agent(Role::Provider, PK_SUB.into(), "sub1".into());
    e.as_("sub2").register_agent(Role::Provider, PK_SUB.into(), "sub2".into());
    e.fund_usdc("client", 1000 * USDC);
    for p in ["lead", "sub1", "sub2"] {
        e.pay(p, NEAR).deposit_compute();
    }
    e.as_("client").register_target("bot".into(), "RU5DVEFSR0VU".into(), cats(&CATS));
    e.advance(100, 100_000);
    e
}

/// setup + root job 0 (budget 100, reward 10) assigned to lead, subjobs 1 (30 @6, sub1) and 2 (20 @4, sub2).
fn setup_tree() -> Env {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job(
        "bot".into(),
        U128(100 * USDC),
        U128(10 * USDC),
        cats(&["prompt_injection", "tool_misuse"]),
        d,
    );
    assert_eq!(j, 0);
    e.as_("lead").place_bid(0, U128(12 * USDC), "lead bid".into());
    e.as_("client").counter_bid(0, acc("lead"), U128(10 * USDC));
    assert_eq!(e.c.get_bids(0)[0].status, BidStatus::Countered);
    e.as_("lead").place_bid(0, U128(10 * USDC), "accept counter".into());
    e.as_("client").accept_bid(0, acc("lead"));
    let s1 = e.as_("lead").create_subjob(0, U128(30 * USDC), U128(6 * USDC), cats(&["prompt_injection"]), d);
    let s2 = e.as_("lead").create_subjob(0, U128(20 * USDC), U128(4 * USDC), cats(&["tool_misuse"]), d);
    assert_eq!((s1, s2), (1, 2));
    e.as_("sub1").place_bid(1, U128(6 * USDC), "".into());
    e.as_("lead").accept_bid(1, acc("sub1"));
    e.as_("sub2").place_bid(2, U128(4 * USDC), "".into());
    e.as_("lead").accept_bid(2, acc("sub2"));
    e
}

fn outlayer_call_input() -> Value {
    let receipts = get_created_receipts();
    for r in receipts {
        for a in r.actions {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                ..
            } = a
            {
                if method_name == b"request_execution" {
                    assert_eq!(r.receiver_id, acc("outlayer"));
                    assert_eq!(attached_deposit.as_yoctonear(), FEE);
                    let args: Value = serde_json::from_slice(&args).unwrap();
                    assert_eq!(args["response_format"], "Json");
                    assert_eq!(args["payer_account_id"], "redteam");
                    assert_eq!(args["source"], json!({"Project": {"project_id": "redteam.testnet/enclave", "version_key": null}}));
                    assert_eq!(args["resource_limits"]["max_execution_seconds"], 90);
                    assert_eq!(args["params"], Value::Null);
                    assert_eq!(args["secrets_ref"]["profile"], "default");
                    return serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
                }
            }
        }
    }
    panic!("no request_execution receipt");
}

// ------------------------------------------------------------------ main flow

#[test]
fn main_flow_root_and_subjob_payouts() {
    let mut e = setup_tree();
    assert_eq!(e.usdc("client"), 900 * USDC);
    let root = e.job(0);
    assert_eq!(root.status, JobStatus::Assigned);
    assert_eq!(root.provider, Some(acc("lead")));
    assert!(!root.restricted && root.can_subcontract);
    assert_eq!(root.remaining.0, 50 * USDC);
    assert_eq!(root.children, vec![1, 2]);
    let sub = e.job(1);
    assert_eq!(sub.depth, 1);
    assert_eq!(sub.client, acc("lead"));
    assert_eq!(sub.root_client, acc("client"));
    assert!(!sub.can_subcontract);
    assert_eq!(e.c.get_bids(0)[0].status, BidStatus::Accepted);

    // sub1 finding in subjob 1: sub gets 6, lead gets margin 4.
    let f0 = e.as_("sub1").submit_finding(1, "RU5DUEFZTE9BRA==".into(), Some("prompt_injection".into()));
    assert_eq!(f0, 0);
    let input = outlayer_call_input();
    assert_eq!(input["op"], "evaluate");
    assert_eq!(input["job_id"], 1);
    assert_eq!(input["finding_id"], 0);
    assert_eq!(input["category"], "prompt_injection");
    assert_eq!(input["enc_target"], "RU5DVEFSR0VU");
    assert_eq!(input["client_pubkey"], PK_CLIENT);
    assert_eq!(input["lead_pubkey"], PK_LEAD);
    assert_eq!(input["dual"], false);
    assert_eq!(e.compute("sub1"), NEAR - FEE);
    assert_eq!(e.job(1).pending, 1);
    assert_eq!(e.c.get_finding(0).unwrap().status, FindingStatus::Pending);

    assert_eq!(e.callback(1, 0, ok(out_json(1, 0, true, false))), FindingStatus::Valid);
    let f = e.c.get_finding(0).unwrap();
    assert_eq!((f.paid_attacker.0, f.paid_lead.0, f.unpaid), (6 * USDC, 4 * USDC, false));
    assert_eq!(f.severity.as_deref(), Some("high"));
    assert_eq!(f.result_hash.as_deref(), Some(hx(0).as_str()));
    assert_eq!(e.usdc("sub1"), 6 * USDC);
    assert_eq!(e.usdc("lead"), 4 * USDC);
    assert_eq!(e.job(1).remaining.0, 24 * USDC);
    assert_eq!(e.job(0).remaining.0, 46 * USDC);
    assert_eq!(e.job(1).pending, 0);
    assert_eq!(e.c.get_agent(acc("sub1")).unwrap().completed, 1);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"finding_evaluated\"")));

    // lead attacks the root job itself (no category → job categories joined).
    let f1 = e.as_("lead").submit_finding(0, "UEFZTE9BRA==".into(), None);
    let input = outlayer_call_input();
    assert_eq!(input["category"], "prompt_injection,tool_misuse");
    assert_eq!(input["lead_pubkey"], Value::Null);
    assert_eq!(e.callback(0, f1, wrapped(out_json(0, f1, true, false))), FindingStatus::Valid);
    assert_eq!(e.usdc("lead"), 14 * USDC);
    assert_eq!(e.job(0).remaining.0, 36 * USDC);

    // sub2: plain invalid (no manipulation) → Invalid, no strike.
    let f2 = e.as_("sub2").submit_finding(2, "UEFZTE9BRA==".into(), Some("tool_misuse".into()));
    assert_eq!(e.callback(2, f2, ok(out_json(2, f2, false, false))), FindingStatus::Invalid);
    let a = e.c.get_agent(acc("sub2")).unwrap();
    assert_eq!((a.invalid, a.strikes.len(), a.blocked), (1, 0, false));
    assert_eq!(e.usdc("sub2"), 0);
    assert_eq!(e.c.get_findings(2).len(), 1);

    // withdraw: internal balance → ft_transfer with 1 yocto attached by the contract.
    let _ = e.as_("sub1").withdraw(U128(6 * USDC));
    assert_eq!(e.usdc("sub1"), 0);
    let r = get_created_receipts();
    let ft = r.iter().find(|r| r.receiver_id == acc("tusdc")).expect("ft_transfer receipt");
    match &ft.actions[0] {
        near_sdk::mock::MockAction::FunctionCallWeight {
            method_name,
            attached_deposit,
            args,
            ..
        } => {
            assert_eq!(method_name, b"ft_transfer");
            assert_eq!(attached_deposit.as_yoctonear(), 1);
            let a: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a["receiver_id"], "sub1");
            assert_eq!(a["amount"], (6 * USDC).to_string());
        }
        _ => panic!("expected function call"),
    }

    // conservation: 1000 USDC in = balances + escrow.
    let escrow: u128 = (0..3).map(|i| e.job(i).remaining.0).sum();
    let bal: u128 = ["client", "lead", "sub1", "sub2"].iter().map(|a| e.usdc(a)).sum();
    assert_eq!(escrow + bal + 6 * USDC /* withdrawn */, 1000 * USDC);
}

#[test]
fn withdraw_failure_recredits() {
    let mut e = setup();
    e.fund_usdc("sub1", 5 * USDC);
    let _ = e.as_("sub1").withdraw(U128(5 * USDC));
    assert_eq!(e.usdc("sub1"), 0);
    testing_env!(
        ctx("redteam", 0, e.block, e.ts_ms),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!e.c.on_withdraw(acc("sub1"), U128(5 * USDC)));
    assert_eq!(e.usdc("sub1"), 5 * USDC);
    testing_env!(
        ctx("redteam", 0, e.block, e.ts_ms),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    assert!(e.c.on_withdraw(acc("sub1"), U128(1)));
    assert_eq!(e.usdc("sub1"), 5 * USDC);
    // a successful transfer with a (non-standard) long return value must NOT re-credit
    testing_env!(
        ctx("redteam", 0, e.block, e.ts_ms),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![b'x'; 4096])]
    );
    assert!(e.c.on_withdraw(acc("sub1"), U128(1)));
    assert_eq!(e.usdc("sub1"), 5 * USDC);
}

#[test]
#[should_panic(expected = "ERR_BALANCE")]
fn withdraw_more_than_balance() {
    let mut e = setup();
    let _ = e.as_("sub1").withdraw(U128(1));
}

#[test]
fn ft_on_transfer_credits_and_refunds_unknown_msg() {
    let mut e = setup();
    match e.as_("tusdc").ft_on_transfer(acc("sub1"), U128(7), "".into()) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 0),
        _ => panic!(),
    }
    assert_eq!(e.usdc("sub1"), 7);
    match e.as_("tusdc").ft_on_transfer(acc("sub1"), U128(9), "something".into()) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 9),
        _ => panic!(),
    }
    assert_eq!(e.usdc("sub1"), 7);
}

#[test]
#[should_panic(expected = "ERR_TOKEN")]
fn ft_on_transfer_rejects_other_tokens() {
    let mut e = setup();
    let _ = e.as_("fake-usdc").ft_on_transfer(acc("sub1"), U128(7), "".into());
}

#[test]
fn withdraw_compute_refunds_near_and_logs() {
    let mut e = setup();
    let _ = e.as_("lead").withdraw_compute(U128(NEAR / 4));
    assert_eq!(e.compute("lead"), NEAR - NEAR / 4);
    let r = get_created_receipts();
    let t = r.iter().find(|r| r.receiver_id == acc("lead")).expect("transfer receipt");
    match &t.actions[0] {
        near_sdk::mock::MockAction::Transfer { deposit, .. } => assert_eq!(deposit.as_yoctonear(), NEAR / 4),
        a => panic!("expected transfer, got {:?}", a),
    }
    let log = e.c.get_policy_log(None, None);
    assert_eq!(log.last().unwrap().action, "withdraw_compute");
    // failed transfer → re-credit
    testing_env!(
        ctx("redteam", 0, e.block, e.ts_ms),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!e.c.on_withdraw_compute(acc("lead"), U128(NEAR / 4)));
    assert_eq!(e.compute("lead"), NEAR);
}

#[test]
#[should_panic(expected = "ERR_COMPUTE")]
fn withdraw_compute_capped_by_balance() {
    let mut e = setup();
    let _ = e.as_("lead").withdraw_compute(U128(NEAR + 1));
}

#[test]
fn deposit_compute_credits_caller() {
    let mut e = setup();
    assert_eq!(e.compute("lead"), NEAR);
    e.pay("lead", NEAR / 2).deposit_compute();
    assert_eq!(e.compute("lead"), NEAR + NEAR / 2);
}

// ------------------------------------------------------------ counterparty

#[test]
fn counterparty_verdicts() {
    let mut e = setup();
    assert_eq!(e.c.check_counterparty(acc("nobody")).level, VerdictLevel::Block);
    assert_eq!(e.c.check_counterparty(acc("sub1")).level, VerdictLevel::Allow);
    e.as_("mallory").register_agent(Role::Provider, PK_SUB.into(), "".into());
    let v = e.c.check_counterparty(acc("mallory"));
    assert_eq!(v.level, VerdictLevel::Warn);
    assert!(v.reasons[0].starts_with("new agent"));
    e.advance(60, 60_000);
    assert_eq!(e.as_("anyone").check_counterparty(acc("mallory")).level, VerdictLevel::Allow);
}

#[test]
fn warn_auto_escalation_restricts_job() {
    let mut e = setup();
    e.as_("mallory").register_agent(Role::Provider, PK_SUB.into(), "fresh".into());
    e.pay("mallory", NEAR).deposit_compute();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(100 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
    e.as_("mallory").place_bid(j, U128(10 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("mallory"));
    let job = e.job(j);
    assert!(job.restricted);
    assert!(!job.can_subcontract);
    assert_eq!(job.reward_per_finding.0, 10 * USDC);
    assert_eq!(job.payout_per_finding.0, 5 * USDC);
    let log = e.c.get_policy_log(None, None);
    let last = log.last().unwrap();
    assert_eq!(last.action, "accept_bid");
    assert_eq!(last.verdict.as_ref().unwrap().level, VerdictLevel::Warn);
    assert!(last.detail.contains("RESTRICTED"));

    // dual evaluation requested, reward capped.
    let f = e.as_("mallory").submit_finding(j, "UA==".into(), Some("jailbreak".into()));
    assert_eq!(outlayer_call_input()["dual"], true);
    e.callback(j, f, ok(out_json(j, f, true, false)));
    assert_eq!(e.usdc("mallory"), 5 * USDC);
    assert_eq!(e.job(j).remaining.0, 95 * USDC);
}

#[test]
#[should_panic(expected = "ERR_NO_SUBCONTRACT")]
fn restricted_provider_cannot_subcontract() {
    let mut e = setup();
    e.as_("mallory").register_agent(Role::Provider, PK_SUB.into(), "fresh".into());
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(100 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
    e.as_("mallory").place_bid(j, U128(10 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("mallory"));
    e.as_("mallory").create_subjob(j, U128(10 * USDC), U128(5 * USDC), cats(&["jailbreak"]), d);
}

/// mallory (aged) attacks the evaluator twice → 2 strikes with evidence → blocked.
fn mallory_blocked() -> Env {
    let mut e = setup();
    e.as_("mallory").register_agent(Role::Provider, PK_SUB.into(), "".into());
    e.pay("mallory", NEAR).deposit_compute();
    e.advance(100, 1000);
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(100 * USDC), U128(10 * USDC), cats(&["prompt_injection"]), d);
    e.as_("mallory").place_bid(j, U128(10 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("mallory"));
    assert!(!e.job(j).restricted);
    let f = e.as_("mallory").submit_finding(j, "UA==".into(), None);
    assert_eq!(e.callback(j, f, ok(out_json(j, f, false, true))), FindingStatus::Invalid);
    let v = e.c.check_counterparty(acc("mallory"));
    assert_eq!(v.level, VerdictLevel::Warn);
    assert!(v.reasons[0].contains("strike"));
    // manipulation + "valid" is still not paid.
    let f = e.as_("mallory").submit_finding(j, "UA==".into(), None);
    assert_eq!(e.callback(j, f, ok(out_json(j, f, true, true))), FindingStatus::Invalid);
    assert_eq!(e.usdc("mallory"), 0);
    e
}

#[test]
fn manipulation_strikes_lead_to_blocklist() {
    let e = mallory_blocked();
    let a = e.c.get_agent(acc("mallory")).unwrap();
    assert!(a.blocked);
    assert_eq!(a.strikes.len(), 2);
    assert_eq!(a.strikes[0].evidence_hash, hx(0));
    assert_eq!(a.invalid, 2);
    let v = e.c.check_counterparty(acc("mallory"));
    assert_eq!(v.level, VerdictLevel::Block);
    assert!(v.reasons[0].contains(&hx(0)));
    let log = e.c.get_policy_log(None, None);
    let actions: Vec<&str> = log.iter().map(|l| l.action.as_str()).collect();
    assert_eq!(actions.iter().filter(|a| **a == "strike").count(), 2);
    assert!(actions.contains(&"blocklist"));
}

#[test]
#[should_panic(expected = "ERR_COUNTERPARTY_BLOCK")]
fn blocked_agent_cannot_bid() {
    let mut e = mallory_blocked();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("mallory").place_bid(j, U128(1 * USDC), "".into());
}

#[test]
#[should_panic(expected = "ERR_COUNTERPARTY_BLOCK")]
fn blocked_agent_cannot_be_accepted() {
    let mut e = setup();
    e.as_("mallory").register_agent(Role::Provider, PK_SUB.into(), "".into());
    e.pay("mallory", NEAR).deposit_compute();
    e.advance(100, 1000);
    let d = e.deadline();
    let j1 = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    let j2 = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("mallory").place_bid(j1, U128(1 * USDC), "".into());
    e.as_("mallory").place_bid(j2, U128(1 * USDC), "".into()); // bid placed before the block
    e.as_("client").accept_bid(j1, acc("mallory"));
    for _ in 0..2 {
        let f = e.as_("mallory").submit_finding(j1, "UA==".into(), None);
        e.callback(j1, f, ok(out_json(j1, f, false, true)));
    }
    e.as_("client").accept_bid(j2, acc("mallory"));
}

#[test]
#[should_panic(expected = "ERR_COUNTERPARTY_BLOCK")]
fn blocked_agent_cannot_submit() {
    let mut e = setup();
    e.as_("mallory").register_agent(Role::Provider, PK_SUB.into(), "".into());
    e.pay("mallory", NEAR).deposit_compute();
    e.advance(100, 1000);
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("mallory").place_bid(j, U128(1 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("mallory"));
    for _ in 0..2 {
        let f = e.as_("mallory").submit_finding(j, "UA==".into(), None);
        e.callback(j, f, ok(out_json(j, f, false, true)));
    }
    e.as_("mallory").submit_finding(j, "UA==".into(), None);
}

#[test]
#[should_panic(expected = "ERR_NOT_REGISTERED")]
fn unregistered_bidder_rejected() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("ghost").place_bid(j, U128(1 * USDC), "".into());
}

// ---------------------------------------------------------------- subjob caps

#[test]
#[should_panic(expected = "ERR_DEPTH")]
fn subjob_depth_capped() {
    let mut e = setup_tree();
    let d = e.deadline();
    e.as_("sub1").create_subjob(1, U128(1 * USDC), U128(1 * USDC), cats(&["prompt_injection"]), d);
}

#[test]
#[should_panic(expected = "ERR_MAX_CHILDREN")]
fn subjob_children_capped() {
    let mut e = setup_tree();
    let d = e.deadline();
    e.as_("lead").create_subjob(0, U128(1 * USDC), U128(1 * USDC), cats(&["prompt_injection"]), d);
}

#[test]
#[should_panic(expected = "ERR_BUDGET_CAP")]
fn subjob_budget_capped_by_parent_remaining() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(100 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(10 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    e.as_("lead").create_subjob(j, U128(101 * USDC), U128(5 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_REWARD")]
fn subjob_reward_must_leave_lead_margin() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(100 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(10 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    e.as_("lead").create_subjob(j, U128(50 * USDC), U128(11 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_CATEGORY")]
fn subjob_categories_subset_of_parent() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(100 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(10 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    e.as_("lead").create_subjob(j, U128(50 * USDC), U128(5 * USDC), cats(&["tool_misuse"]), d);
}

#[test]
#[should_panic(expected = "ERR_NOT_PROVIDER")]
fn only_provider_creates_subjobs() {
    let mut e = setup_tree();
    let d = e.deadline();
    e.as_("client").create_subjob(0, U128(1 * USDC), U128(1 * USDC), cats(&["prompt_injection"]), d);
}

// ------------------------------------------------------------------ job caps

#[test]
#[should_panic(expected = "ERR_BUDGET_CAP")]
fn job_budget_capped_by_policy() {
    let mut e = setup();
    let d = e.deadline();
    e.as_("client").create_job("bot".into(), U128(1001 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_BALANCE")]
fn job_budget_needs_balance() {
    let mut e = setup();
    let d = e.deadline();
    e.as_("client").create_job("bot".into(), U128(600 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
    e.as_("client").create_job("bot".into(), U128(600 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_NOT_TARGET_OWNER")]
fn only_target_owner_posts_jobs() {
    let mut e = setup();
    e.as_("client2").register_agent(Role::Client, PK_CLIENT.into(), "".into());
    e.fund_usdc("client2", 100 * USDC);
    let d = e.deadline();
    e.as_("client2").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_ROLE")]
fn providers_cannot_post_jobs() {
    let mut e = setup();
    let d = e.deadline();
    e.as_("lead").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_CATEGORY")]
fn unknown_category_rejected() {
    let mut e = setup();
    let d = e.deadline();
    e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["rm_rf"]), d);
}

#[test]
#[should_panic(expected = "ERR_DEADLINE")]
fn deadline_too_soon() {
    let mut e = setup();
    let d = e.ts_ms + 1000;
    e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_RATE_LIMIT")]
fn rate_limited() {
    let mut e = setup();
    let mut p = e.c.get_config().policy;
    p.rate_limit_per_hour = 2;
    e.as_("owner").set_policy(p);
    let d = e.deadline();
    for _ in 0..3 {
        e.as_("client").create_job("bot".into(), U128(1 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    }
}

#[test]
fn rate_limit_window_resets() {
    let mut e = setup();
    let mut p = e.c.get_config().policy;
    p.rate_limit_per_hour = 1;
    e.as_("owner").set_policy(p);
    e.advance(10, HOUR); // setup's register_target used the previous window
    let d = e.ts_ms + 3 * HOUR;
    e.as_("client").create_job("bot".into(), U128(1 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.advance(10, HOUR);
    e.as_("client").create_job("bot".into(), U128(1 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn set_policy_owner_only() {
    let mut e = setup();
    let p = e.c.get_config().policy;
    e.as_("client").set_policy(p);
}

// --------------------------------------------------------------------- bids

#[test]
#[should_panic(expected = "ERR_BID")]
fn counter_only_once() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(2 * USDC), "".into());
    e.as_("client").counter_bid(j, acc("lead"), U128(1 * USDC));
    e.as_("lead").place_bid(j, U128(2 * USDC), "no".into());
    e.as_("client").counter_bid(j, acc("lead"), U128(1 * USDC));
}

#[test]
#[should_panic(expected = "ERR_REWARD")]
fn accept_requires_price_within_reward() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(2 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
}

#[test]
fn accept_lowers_reward_to_bid_price_and_rejects_others() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(5 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(3 * USDC), "".into());
    e.as_("sub1").place_bid(j, U128(4 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    assert_eq!(e.job(j).reward_per_finding.0, 3 * USDC);
    let bids = e.c.get_bids(j);
    assert_eq!(bids[0].status, BidStatus::Accepted);
    assert_eq!(bids[1].status, BidStatus::Rejected);
}

#[test]
#[should_panic(expected = "ERR_NOT_CLIENT")]
fn only_client_accepts() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(1 * USDC), "".into());
    e.as_("lead").accept_bid(j, acc("lead"));
}

#[test]
#[should_panic(expected = "ERR_SELF_DEAL")]
fn lead_cannot_bid_on_own_subjob() {
    let mut e = setup_tree();
    // subjob 1 is already assigned; carve a fresh one on a new tree instead.
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(2 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(2 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    let s = e.as_("lead").create_subjob(j, U128(5 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(s, U128(1 * USDC), "".into());
}

// --------------------------------------------------------------- submissions

#[test]
#[should_panic(expected = "ERR_COMPUTE")]
fn submit_needs_compute() {
    let mut e = setup();
    e.as_("rich").register_agent(Role::Provider, PK_SUB.into(), "".into());
    e.advance(100, 1000);
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("rich").place_bid(j, U128(1 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("rich"));
    e.as_("rich").submit_finding(j, "UA==".into(), None);
}

#[test]
#[should_panic(expected = "ERR_NOT_PROVIDER")]
fn only_provider_submits() {
    let mut e = setup_tree();
    e.as_("sub2").submit_finding(1, "UA==".into(), None);
}

#[test]
#[should_panic(expected = "ERR_CATEGORY")]
fn submit_category_in_job() {
    let mut e = setup_tree();
    e.as_("sub1").submit_finding(1, "UA==".into(), Some("jailbreak".into()));
}

#[test]
#[should_panic(expected = "ERR_DEADLINE")]
fn submit_after_deadline() {
    let mut e = setup_tree();
    e.advance(10, 2 * HOUR);
    e.as_("sub1").submit_finding(1, "UA==".into(), None);
}

// ------------------------------------------------------- callback edge cases

#[test]
fn callback_failures_mark_failed_without_strike() {
    let mut e = setup_tree();
    let cases: Vec<PromiseResult> = vec![
        PromiseResult::Failed,
        ok(json!({"success": false, "result": null, "error": "wasm trap"})),
        ok(json!({"v": 1, "job_id": 1, "finding_id": 2, "valid": false, "error": "decrypt failed"})),
        ok(json!({"success": true, "result": {"v": 1, "job_id": 1, "finding_id": 3, "valid": false, "manipulation": true, "error": "bad payload"}})),
        ok(out_json(1, 999, true, false)), // id mismatch
        PromiseResult::Successful(b"not json".to_vec()),
        ok(json!({"hello": "world"})),
        ok(Value::Null), // OutLayer: run failed / no output
    ];
    for (i, r) in cases.into_iter().enumerate() {
        let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
        assert_eq!(f, i as u64);
        assert_eq!(e.callback(1, f, r), FindingStatus::Failed, "case {}", i);
        assert!(e.c.get_finding(f).unwrap().error.is_some());
    }
    let a = e.c.get_agent(acc("sub1")).unwrap();
    // PromiseResult::Failed and null are OutLayer infra failures: not counted, partial refund
    assert_eq!((a.failed, a.invalid, a.strikes.len(), a.completed), (6, 0, 0, 0));
    assert_eq!(e.compute("sub1"), NEAR - 8 * FEE + 2 * INFRA_REFUND);
    assert_eq!(e.usdc("sub1"), 0);
    assert_eq!(e.job(1).pending, 0);
}

#[test]
fn callback_accepts_wrapped_and_stringified_output() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    let as_string = Value::String(json!({"success": true, "result": out_json(1, f, true, false).to_string()}).to_string());
    assert_eq!(e.callback(1, f, ok(as_string)), FindingStatus::Valid);
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    let text = json!({"Text": out_json(1, f, true, false).to_string()});
    assert_eq!(e.callback(1, f, ok(text)), FindingStatus::Valid);
    assert_eq!(e.usdc("sub1"), 12 * USDC);
}

#[test]
fn callback_is_idempotent() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f, ok(out_json(1, f, true, false)));
    assert_eq!(e.callback(1, f, ok(out_json(1, f, true, false))), FindingStatus::Valid);
    assert_eq!(e.usdc("sub1"), 6 * USDC);
    assert_eq!(e.callback(1, 12345, ok(out_json(1, 12345, true, false))), FindingStatus::Failed);
}

#[test]
fn insufficient_remaining_marks_unpaid_and_closes() {
    let mut e = setup();
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(15 * USDC), U128(10 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(10 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    let f1 = e.as_("lead").submit_finding(j, "UA==".into(), None);
    let f2 = e.as_("lead").submit_finding(j, "UA==".into(), None);
    e.callback(j, f1, ok(out_json(j, f1, true, false)));
    assert_eq!(e.usdc("lead"), 10 * USDC);
    assert_eq!(e.callback(j, f2, ok(out_json(j, f2, true, false))), FindingStatus::Valid);
    let f = e.c.get_finding(f2).unwrap();
    assert!(f.unpaid);
    assert_eq!(f.paid_attacker.0, 0);
    let job = e.job(j);
    assert_eq!(job.status, JobStatus::Closed);
    assert_eq!(job.remaining.0, 0);
    assert_eq!(e.usdc("client"), 1000 * USDC - 10 * USDC); // 5 left over refunded
    let actions: Vec<String> = e.c.get_policy_log(None, None).into_iter().map(|l| l.action).collect();
    assert!(actions.contains(&"unpaid".to_string()) && actions.contains(&"close".to_string()));
}

// ------------------------------------------------------------------- expiry

#[test]
fn expire_rolls_refunds_up_children_first() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f, ok(out_json(1, f, true, false))); // sub1 +6, lead +4
    e.advance(100, HOUR);
    let before = e.c.get_counts().policy_log;
    e.as_("anyone").expire_job(0);
    for i in 0..3 {
        assert_eq!(e.job(i).status, JobStatus::Expired);
        assert_eq!(e.job(i).remaining.0, 0);
    }
    assert_eq!(e.usdc("client"), 1000 * USDC - 10 * USDC);
    let log = e.c.get_policy_log(Some(before), None);
    let seq: Vec<(String, Option<u64>)> = log.iter().map(|l| (l.action.clone(), l.job_id)).collect();
    assert_eq!(
        seq,
        vec![
            ("expire".to_string(), Some(1)),
            ("refund".to_string(), Some(1)),
            ("expire".to_string(), Some(2)),
            ("refund".to_string(), Some(2)),
            ("expire".to_string(), Some(0)),
            ("refund".to_string(), Some(0)),
        ]
    );
    assert!(log[1].detail.contains("rolled up to job 0"));
    assert!(log[5].detail.contains("root client"));
}

#[test]
fn expire_child_alone_refunds_parent() {
    let mut e = setup_tree();
    let mut p = e.c.get_config().policy;
    p.min_deadline_ms = 0;
    e.as_("owner").set_policy(p);
    let d = e.deadline();
    // free subjob slot: build a fresh tree with a short subjob deadline
    let j = e.as_("client").create_job("bot".into(), U128(50 * USDC), U128(5 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(5 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    let short = e.ts_ms + 1000;
    let s = e.as_("lead").create_subjob(j, U128(20 * USDC), U128(2 * USDC), cats(&["jailbreak"]), short);
    assert_eq!(e.job(j).remaining.0, 30 * USDC);
    e.advance(5, 2000);
    e.as_("anyone").expire_job(s);
    assert_eq!(e.job(s).status, JobStatus::Expired);
    assert_eq!(e.job(j).status, JobStatus::Assigned);
    assert_eq!(e.job(j).remaining.0, 50 * USDC);
}

#[test]
#[should_panic(expected = "ERR_DEADLINE")]
fn expire_before_deadline() {
    let mut e = setup_tree();
    e.as_("anyone").expire_job(0);
}

#[test]
#[should_panic(expected = "ERR_PENDING")]
fn expire_blocked_by_pending_evaluation() {
    let mut e = setup_tree();
    e.advance(100, HOUR - 60_000);
    e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.advance(100, 120_000);
    e.as_("anyone").expire_job(0);
}

#[test]
fn expire_force_fails_stale_pending() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.advance(1000, 2 * HOUR);
    e.as_("anyone").expire_job(0);
    let fi = e.c.get_finding(f).unwrap();
    assert_eq!(fi.status, FindingStatus::Failed);
    assert_eq!(e.usdc("client"), 1000 * USDC);
    // a late callback is ignored
    assert_eq!(e.callback(1, f, ok(out_json(1, f, true, false))), FindingStatus::Failed);
    assert_eq!(e.usdc("sub1"), 0);
    let a = e.c.get_agent(acc("sub1")).unwrap();
    assert_eq!((a.failed, a.strikes.len()), (1, 0));
}

// --------------------------------------------------------------- registry/views

#[test]
#[should_panic(expected = "ERR_INPUT")]
fn register_agent_validates_pubkey() {
    let mut e = Env::new();
    e.as_("xx").register_agent(Role::Provider, "zz".into(), "".into());
}

#[test]
#[should_panic(expected = "ERR_ROLE")]
fn register_agent_role_is_fixed() {
    let mut e = setup();
    e.as_("lead").register_agent(Role::Client, PK_LEAD.into(), "".into());
}

#[test]
fn register_agent_updates_keep_stats_and_age() {
    let mut e = setup();
    let before = e.c.get_agent(acc("lead")).unwrap();
    e.as_("lead").register_agent(Role::Provider, PK_SUB.into(), "v2".into());
    let after = e.c.get_agent(acc("lead")).unwrap();
    assert_eq!(after.registered_block, before.registered_block);
    assert_eq!(after.x25519_pubkey, PK_SUB);
    assert_eq!(after.meta, "v2");
    assert_eq!(e.c.get_counts().agents, 4);
}

#[test]
fn views_and_json_shapes() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f, ok(out_json(1, f, true, false)));
    assert_eq!(e.c.list_jobs(None, None).len(), 3);
    assert_eq!(e.c.list_jobs(Some(1), Some(1))[0].id, 1);
    assert_eq!(e.c.list_jobs(Some(10), None).len(), 0);
    assert_eq!(e.c.list_agents(None, None).len(), 4);
    assert_eq!(e.c.get_target("bot".into()).unwrap().owner, acc("client"));
    assert!(e.c.get_job(99).is_none());
    let job = serde_json::to_value(e.job(1)).unwrap();
    assert_eq!(job["status"], "Assigned");
    assert_eq!(job["budget"], (30 * USDC).to_string());
    assert!(job["deadline_ms"].is_u64());
    assert!(job["parent_id"].is_u64());
    let agent = serde_json::to_value(e.c.get_agent(acc("sub1")).unwrap()).unwrap();
    assert_eq!(agent["role"], "provider");
    assert!(agent.get("rl_count").is_none());
    let finding = serde_json::to_value(e.c.get_finding(f).unwrap()).unwrap();
    assert_eq!(finding["status"], "Valid");
    assert_eq!(finding["paid_attacker"], (6 * USDC).to_string());
    let v = serde_json::to_value(e.c.check_counterparty(acc("sub1"))).unwrap();
    assert_eq!(v["level"], "Allow");
    let bal = serde_json::to_value(e.c.balance_of(acc("sub1"))).unwrap();
    assert!(bal["usdc"].is_string() && bal["compute"].is_string());
    let cfg = serde_json::to_value(e.c.get_config()).unwrap();
    assert_eq!(cfg["policy"]["max_depth"], 1);
    assert_eq!(cfg["policy"]["warn_reward_cap_bps"], 5000);
    assert_eq!(cfg["enclave_code"]["Project"]["project_id"], "redteam.testnet/enclave");
    let log = serde_json::to_value(e.c.get_policy_log(None, Some(1))).unwrap();
    assert_eq!(log[0]["seq"], 0);
    assert_eq!(log[0]["verdict"]["level"], "Allow");
}

/// `cargo test -p redteam print_view_samples -- --ignored --nocapture` → JSON samples for VIEWS.md.
#[test]
#[ignore]
fn print_view_samples() {
    let mut e = setup_tree();
    e.as_("mallory").register_agent(Role::Provider, PK_SUB.into(), "fresh".into());
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), Some("prompt_injection".into()));
    e.callback(1, f, ok(out_json(1, f, true, false)));
    let pending = e.as_("lead").submit_finding(0, "UA==".into(), None);
    let _ = pending;
    e.as_("anyone");
    let p = |name: &str, v: Value| println!("=== {}\n{}", name, serde_json::to_string_pretty(&v).unwrap());
    p("get_job(1)", serde_json::to_value(e.c.get_job(1)).unwrap());
    p("get_finding(0)", serde_json::to_value(e.c.get_finding(0)).unwrap());
    p("get_finding(1) pending", serde_json::to_value(e.c.get_finding(1)).unwrap());
    p("get_bids(0)", serde_json::to_value(e.c.get_bids(0)).unwrap());
    p("get_agent(sub1)", serde_json::to_value(e.c.get_agent(acc("sub1"))).unwrap());
    p("get_target(bot)", serde_json::to_value(e.c.get_target("bot".into())).unwrap());
    p("check_counterparty(sub1)", serde_json::to_value(e.c.check_counterparty(acc("sub1"))).unwrap());
    p("check_counterparty(mallory)", serde_json::to_value(e.c.check_counterparty(acc("mallory"))).unwrap());
    p("check_counterparty(nobody)", serde_json::to_value(e.c.check_counterparty(acc("nobody"))).unwrap());
    p("balance_of(sub1)", serde_json::to_value(e.c.balance_of(acc("sub1"))).unwrap());
    p("get_config()", serde_json::to_value(e.c.get_config()).unwrap());
    p("get_policy_log(0, 3)", serde_json::to_value(e.c.get_policy_log(Some(0), Some(3))).unwrap());
    p("get_counts()", serde_json::to_value(e.c.get_counts()).unwrap());
}

#[test]
#[should_panic(expected = "ERR_INPUT")]
fn set_enclave_validates_source() {
    let mut e = setup();
    e.as_("owner").set_enclave(json!({"WasmHash": {"hash": "x"}}), PK_ENCLAVE.into(), None, None);
}

#[test]
fn set_enclave_updates_config() {
    let mut e = setup();
    e.as_("owner").set_enclave(
        json!({"WasmUrl": {"url": "https://x/e.wasm", "hash": "ab", "build_target": "wasm32-wasip2"}}),
        PK_CLIENT.into(),
        None,
        Some(json!({"max_instructions": 1, "max_memory_mb": 64, "max_execution_seconds": 30})),
    );
    let cfg = e.c.get_config();
    assert_eq!(cfg.enclave_pubkey, PK_CLIENT);
    assert_eq!(cfg.resource_limits["max_execution_seconds"], 30);
    assert_eq!(cfg.secrets_ref.unwrap()["profile"], "default"); // kept when None
}

// ----------------------------------------------------------- dedup + solvency

fn out_hash(job_id: JobId, finding_id: FindingId, hash: &str) -> PromiseResult {
    let mut v = out_json(job_id, finding_id, true, false);
    v["result_hash"] = json!(hash);
    ok(v)
}

#[test]
fn duplicate_result_hash_is_valid_but_not_paid_again() {
    let mut e = setup_tree();
    let f0 = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f0, out_hash(1, f0, &"a".repeat(64)));
    assert_eq!(e.usdc("sub1"), 6 * USDC);
    // same result again in the same subjob
    let f1 = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    assert_eq!(e.callback(1, f1, out_hash(1, f1, &"a".repeat(64))), FindingStatus::Valid);
    let f = e.c.get_finding(f1).unwrap();
    assert!(f.unpaid);
    assert_eq!((f.paid_attacker.0, f.paid_lead.0), (0, 0));
    assert_eq!(e.usdc("sub1"), 6 * USDC);
    assert_eq!(e.usdc("lead"), 4 * USDC);
    assert_eq!(e.job(1).status, JobStatus::Assigned); // a duplicate does not close the job
    assert_eq!(e.c.get_agent(acc("sub1")).unwrap().completed, 1);
    // same result from the lead on the root job (same root) → duplicate too
    let f2 = e.as_("lead").submit_finding(0, "UA==".into(), None);
    e.callback(0, f2, out_hash(0, f2, &"a".repeat(64)));
    assert!(e.c.get_finding(f2).unwrap().unpaid);
    // a different result pays
    let f3 = e.as_("lead").submit_finding(0, "UA==".into(), None);
    e.callback(0, f3, out_hash(0, f3, &"b".repeat(64)));
    assert_eq!(e.usdc("lead"), 14 * USDC);
    let dups = e.c.get_policy_log(None, Some(200)).into_iter().filter(|l| l.action == "duplicate").count();
    assert_eq!(dups, 2);
    // the same hash under a different root job is not a duplicate
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(2 * USDC), cats(&["jailbreak"]), d);
    e.as_("sub2").place_bid(j, U128(2 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("sub2"));
    let f4 = e.as_("sub2").submit_finding(j, "UA==".into(), None);
    e.callback(j, f4, out_hash(j, f4, &"a".repeat(64)));
    assert_eq!(e.usdc("sub2"), 2 * USDC);
}

#[test]
fn solvency_tracks_compute_liabilities() {
    let mut e = setup();
    let s = e.as_("anyone").get_solvency();
    assert_eq!(s.compute_liabilities.0, 3 * NEAR); // lead, sub1, sub2 deposited 1 NEAR each
    assert_eq!(s.reserve.0, SOLVENCY_RESERVE);
    let d = e.deadline();
    let j = e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(2 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(j, U128(2 * USDC), "".into());
    e.as_("client").accept_bid(j, acc("lead"));
    e.as_("lead").submit_finding(j, "UA==".into(), None);
    assert_eq!(e.as_("anyone").get_solvency().compute_liabilities.0, 3 * NEAR - FEE);
    let _ = e.as_("sub1").withdraw_compute(U128(NEAR / 2));
    assert_eq!(e.as_("anyone").get_solvency().compute_liabilities.0, 3 * NEAR - FEE - NEAR / 2);
    // failed transfer → liabilities restored with the balance
    testing_env!(
        ctx("redteam", 0, e.block, e.ts_ms),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    e.c.on_withdraw_compute(acc("sub1"), U128(NEAR / 2));
    assert_eq!(e.as_("anyone").get_solvency().compute_liabilities.0, 3 * NEAR - FEE);
}

#[test]
fn liabilities_seed_from_agents_after_upgrade() {
    let mut e = setup();
    // simulate pre-upgrade state: the counter key does not exist yet
    testing_env!(ctx("anyone", 0, e.block, e.ts_ms));
    env::storage_remove(b"rt:cl");
    assert_eq!(e.c.get_solvency().compute_liabilities.0, 3 * NEAR); // view scans, no write
    e.pay("lead", NEAR).deposit_compute();
    assert_eq!(e.as_("anyone").get_solvency().compute_liabilities.0, 4 * NEAR);
    // owner resync also counts non-agent depositors
    e.pay("stranger", NEAR).deposit_compute();
    assert_eq!(e.as_("owner").resync_compute_liabilities(vec![acc("stranger"), acc("stranger")]).0, 5 * NEAR);
}

#[test]
#[should_panic(expected = "ERR_STORAGE")]
fn insolvent_contract_refuses_state_growth() {
    let mut e = setup();
    // balance barely above what agents deposited → storage would eat deposits
    let low = VMContextBuilder::new()
        .current_account_id(acc("redteam"))
        .predecessor_account_id(acc("newbie"))
        .signer_account_id(acc("newbie"))
        .block_height(e.block)
        .block_timestamp(e.ts_ms * 1_000_000)
        .account_balance(NearToken::from_yoctonear(3 * NEAR + NEAR / 10))
        .build();
    testing_env!(low);
    e.c.register_agent(Role::Provider, PK_SUB.into(), "".into());
}

#[test]
#[should_panic(expected = "ERR_STORAGE")]
fn insolvent_contract_refuses_submissions() {
    let mut e = setup_tree();
    let low = VMContextBuilder::new()
        .current_account_id(acc("redteam"))
        .predecessor_account_id(acc("sub1"))
        .signer_account_id(acc("sub1"))
        .block_height(e.block)
        .block_timestamp(e.ts_ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_yoctonear(3 * NEAR))
        .build();
    testing_env!(low);
    e.c.submit_finding(1, "UA==".into(), None);
}

// ------------------------------------------------- review batch (C1, C2, C4, C5, C6, dedup_key)

#[test]
#[should_panic(expected = "ERR_BAD_KEY")]
fn zero_pubkey_rejected() {
    let mut e = Env::new();
    e.as_("xx").register_agent(Role::Provider, "00".repeat(32), "".into());
}

#[test]
#[should_panic(expected = "ERR_BAD_KEY")]
fn small_order_pubkey_rejected_even_non_canonical() {
    let mut e = Env::new();
    // order-8 point with the top bit set (non-canonical encoding of the same point)
    e.as_("xx").register_agent(
        Role::Provider,
        "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b880".into(),
        "".into(),
    );
}

#[test]
fn small_order_list_matches_only_bad_points() {
    assert!(solvency::is_small_order_x25519(&"00".repeat(32)));
    assert!(solvency::is_small_order_x25519("EDFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7F"));
    assert!(!solvency::is_small_order_x25519(PK_CLIENT));
    assert!(!solvency::is_small_order_x25519(PK_ENCLAVE));
}

#[test]
fn client_pubkey_frozen_while_job_active() {
    let mut e = setup();
    let d = e.deadline();
    e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    // meta-only update with the same key is fine
    e.as_("client").register_agent(Role::Client, PK_CLIENT.into(), "new meta".into());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        e.as_("client").register_agent(Role::Client, PK_SUB.into(), "".into());
    }));
    assert!(r.is_err(), "key change must be refused while the job is active");
    e.advance(10, 2 * HOUR);
    e.as_("client").register_agent(Role::Client, PK_SUB.into(), "".into());
    assert_eq!(e.c.get_agent(acc("client")).unwrap().x25519_pubkey, PK_SUB);
}

#[test]
#[should_panic(expected = "ERR_KEY_LOCKED")]
fn lead_pubkey_frozen_after_subcontracting() {
    let mut e = setup_tree();
    e.as_("lead").register_agent(Role::Provider, PK_SUB.into(), "".into());
}

#[test]
#[should_panic(expected = "ERR_TARGET_LOCKED")]
fn target_immutable_while_jobs_active() {
    let mut e = setup();
    let d = e.deadline();
    e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.as_("client").register_target("bot".into(), "SEFSREVORUQ=".into(), cats(&["jailbreak"]));
}

#[test]
fn target_editable_after_jobs_end() {
    let mut e = setup();
    let d = e.deadline();
    e.as_("client").create_job("bot".into(), U128(10 * USDC), U128(1 * USDC), cats(&["jailbreak"]), d);
    e.advance(10, 2 * HOUR);
    e.as_("client").register_target("bot".into(), "TkVX".into(), cats(&["jailbreak"]));
    assert_eq!(e.c.get_target("bot".into()).unwrap().enc_target, "TkVX");
}

#[test]
fn enclave_input_carries_root_job_id() {
    let mut e = setup_tree();
    e.as_("sub1").submit_finding(1, "UA==".into(), None);
    assert_eq!(outlayer_call_input()["root_job_id"], 0);
    e.as_("lead").submit_finding(0, "UA==".into(), None);
    assert_eq!(outlayer_call_input()["root_job_id"], 0);
    // unit-test artifact: the struct's storage cache is flushed on drop under the current env;
    // give it a fresh gas budget (on-chain every call flushes its own writes).
    e.advance(0, 0);
}

fn out_keyed(job_id: JobId, finding_id: FindingId, dedup_key: &str) -> PromiseResult {
    let mut v = out_json(job_id, finding_id, true, false);
    v["dedup_key"] = json!(dedup_key);
    ok(v)
}

#[test]
fn dedup_key_catches_same_attack_with_different_result_hash() {
    let mut e = setup_tree();
    let k = "c".repeat(64);
    let f0 = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f0, out_keyed(1, f0, &k));
    let f1 = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f1, out_keyed(1, f1, &k)); // result_hash differs (hx(f1)), dedup_key same
    let v = e.c.get_finding(f1).unwrap();
    assert!(v.unpaid);
    assert_eq!(v.dedup_key.as_deref(), Some(k.as_str()));
    assert_eq!(e.usdc("sub1"), 6 * USDC);
    // dedup_key "k:" and result_hash "h:" namespaces don't collide
    let f2 = e.as_("lead").submit_finding(0, "UA==".into(), None);
    let mut out = out_json(0, f2, true, false);
    out["result_hash"] = json!(k.clone());
    e.callback(0, f2, ok(out));
    assert!(!e.c.get_finding(f2).unwrap().unpaid);
    let j = serde_json::to_value(e.c.get_finding(f1).unwrap()).unwrap();
    assert_eq!(j["dedup_key"], k);
}

#[test]
fn malformed_enclave_fields_fail_the_finding() {
    let mut e = setup_tree();
    let mut cases = vec![];
    let mut v = out_json(1, 0, true, false);
    v["severity"] = json!("critical; drop table");
    cases.push(v);
    let mut v = out_json(1, 1, true, false);
    v["result_hash"] = json!("not-a-hash");
    cases.push(v);
    let mut v = out_json(1, 2, true, false);
    v["dedup_key"] = json!("ABC");
    cases.push(v);
    let mut v = out_json(1, 3, true, false);
    v.as_object_mut().unwrap().remove("result_hash");
    cases.push(v);
    for (i, v) in cases.into_iter().enumerate() {
        let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
        assert_eq!(f, i as u64);
        assert_eq!(e.callback(1, f, ok(v)), FindingStatus::Failed, "case {}", i);
        assert!(e.c.get_finding(f).unwrap().error.unwrap().starts_with("bad output"));
    }
    assert_eq!(e.usdc("sub1"), 0);
}

#[test]
fn client_fault_error_refunds_attacker_fee() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    assert_eq!(e.compute("sub1"), NEAR - FEE);
    let liab = e.as_("anyone").get_solvency().compute_liabilities.0;
    let out = json!({"v": 1, "job_id": 1, "finding_id": f, "valid": false, "error": "TARGET_DECRYPT_FAILED"});
    assert_eq!(e.callback(1, f, ok(out)), FindingStatus::Failed);
    assert_eq!(e.compute("sub1"), NEAR);
    assert_eq!(e.as_("anyone").get_solvency().compute_liabilities.0, liab + FEE);
    let log = e.c.get_policy_log(None, Some(200));
    let cf = log.iter().find(|l| l.action == "client_fault").expect("client_fault logged");
    assert_eq!(cf.actor, acc("client"));
    // attacker-fault error keeps the fee
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    let out = json!({"v": 1, "job_id": 1, "finding_id": f, "valid": false, "error": "DECRYPT_FAILED"});
    e.callback(1, f, ok(out));
    assert_eq!(e.compute("sub1"), NEAR - FEE);
}

#[test]
fn bad_client_key_warning_logs_client_fault_but_pays() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    let mut v = out_json(1, f, true, false);
    v["warnings"] = json!(["BAD_CLIENT_KEY"]);
    v["report_for_client"] = Value::Null;
    assert_eq!(e.callback(1, f, ok(v)), FindingStatus::Valid);
    assert_eq!(e.usdc("sub1"), 6 * USDC);
    assert!(e.c.get_policy_log(None, Some(200)).iter().any(|l| l.action == "client_fault"));
}

#[test]
fn enclave_updated_event_includes_code_hash() {
    let mut e = setup();
    e.as_("owner").set_enclave(
        json!({"WasmUrl": {"url": "https://x/e.wasm", "hash": "981db5c8", "build_target": "wasm32-wasip2"}}),
        PK_CLIENT.into(),
        None,
        None,
    );
    assert!(get_logs().iter().any(|l| l.contains("enclave_updated") && l.contains("981db5c8")));
}

// ------------------------------------------------- enclave v0.1.2 binding errors

fn binding_error(job_id: JobId, finding_id: FindingId, root: Option<JobId>, claimed: Option<u64>) -> Value {
    let rec = format!(
        r#"{{"v":1,"job_id":{},"root_job_id":{},"finding_id":{},"code":"PAYLOAD_BINDING_MISMATCH","claimed_job_id":{}}}"#,
        job_id,
        root.map(|r| r.to_string()).unwrap_or("null".into()),
        finding_id,
        claimed.map(|r| r.to_string()).unwrap_or("null".into()),
    );
    let hash = eval::hex_lower(&env::sha256(rec.as_bytes()));
    json!({"v": 1, "job_id": job_id, "finding_id": finding_id, "valid": false, "manipulation": false,
           "error": "PAYLOAD_BINDING_MISMATCH", "error_record": rec, "result_hash": hash})
}

#[test]
fn error_record_hash_matches_enclave_test_vector() {
    testing_env!(ctx("anyone", 0, 1, T0_MS));
    let rec = r#"{"v":1,"job_id":12,"root_job_id":10,"finding_id":3,"code":"PAYLOAD_BINDING_MISMATCH","claimed_job_id":7}"#;
    assert_eq!(
        eval::hex_lower(&env::sha256(rec.as_bytes())),
        "a3a5760bea5d2fbbf389376d529359d3e86da9122208c42bb14ee12f9a34c641"
    );
    let rec2 = r#"{"v":1,"job_id":7,"root_job_id":null,"finding_id":3,"code":"PAYLOAD_BINDING_MISMATCH","claimed_job_id":null}"#;
    assert_eq!(
        eval::hex_lower(&env::sha256(rec2.as_bytes())),
        "da89fb121d7f09e2c7de12181bcf9f69414a8b1d795541cc2257657c168d0999"
    );
    let out = json!({"v":1,"job_id":12,"finding_id":3,"valid":false,"error":"PAYLOAD_BINDING_MISMATCH",
        "error_record": rec, "result_hash":"a3a5760bea5d2fbbf389376d529359d3e86da9122208c42bb14ee12f9a34c641"});
    let f = eval::parse_eval_output(out.to_string().as_bytes(), 12, 3).unwrap_err();
    assert_eq!(f.result_hash.as_deref(), Some("a3a5760bea5d2fbbf389376d529359d3e86da9122208c42bb14ee12f9a34c641"));
    // same record answering a different request → no evidence
    let f = eval::parse_eval_output(out.to_string().as_bytes(), 12, 4).unwrap_err();
    assert!(f.result_hash.is_none());
}

#[test]
fn payload_binding_mismatch_with_attested_record_strikes() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    assert_eq!(e.callback(1, f, ok(binding_error(1, f, Some(0), Some(7)))), FindingStatus::Failed);
    let a = e.c.get_agent(acc("sub1")).unwrap();
    assert_eq!(a.strikes.len(), 1);
    let fi = e.c.get_finding(f).unwrap();
    assert_eq!(a.strikes[0].evidence_hash, fi.result_hash.clone().unwrap());
    assert_eq!(e.compute("sub1"), NEAR - FEE); // fee kept
    let log = e.c.get_policy_log(None, Some(200));
    let s = log.iter().find(|l| l.action == "strike").unwrap();
    assert!(s.detail.contains("PAYLOAD_BINDING_MISMATCH"));
    // second one → blocked
    let f2 = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f2, ok(binding_error(1, f2, Some(0), None)));
    assert!(e.c.get_agent(acc("sub1")).unwrap().blocked);
}

#[test]
fn payload_binding_mismatch_without_valid_evidence_does_not_strike() {
    let mut e = setup_tree();
    let mut cases = vec![];
    // no hash / no record
    cases.push(json!({"v":1,"job_id":1,"finding_id":0,"valid":false,"error":"PAYLOAD_BINDING_MISMATCH"}));
    // hash doesn't match the record
    let mut v = binding_error(1, 1, Some(0), Some(7));
    v["result_hash"] = json!("ab".repeat(32));
    cases.push(v);
    // record for another finding (replayed evidence)
    let mut v = binding_error(1, 999, Some(0), Some(7));
    v["finding_id"] = json!(2);
    cases.push(v);
    // record with a different code than the error
    let mut v = binding_error(1, 3, Some(0), Some(7));
    v["error"] = json!("DECRYPT_FAILED");
    cases.push(v);
    for (i, out) in cases.into_iter().enumerate() {
        let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
        assert_eq!(f, i as u64);
        assert_eq!(e.callback(1, f, ok(out)), FindingStatus::Failed, "case {}", i);
    }
    let a = e.c.get_agent(acc("sub1")).unwrap();
    assert_eq!((a.strikes.len(), a.failed), (0, 4));
}

#[test]
fn target_binding_mismatch_is_client_fault() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    let out = json!({"v":1,"job_id":1,"finding_id":f,"valid":false,"error":"TARGET_BINDING_MISMATCH","result_hash":null});
    assert_eq!(e.callback(1, f, ok(out)), FindingStatus::Failed);
    assert_eq!(e.compute("sub1"), NEAR);
    assert_eq!(e.c.get_agent(acc("sub1")).unwrap().strikes.len(), 0);
    assert!(e.c.get_policy_log(None, Some(200)).iter().any(|l| l.action == "client_fault"));
}

#[test]
fn unpaid_sub_finding_pays_no_lead_margin() {
    // subjob budget 20 @ 15/finding: the 2nd valid finding can't be paid → neither leg pays.
    let mut e = setup();
    let d = e.deadline();
    let root = e.as_("client").create_job("bot".into(), U128(100 * USDC), U128(20 * USDC), cats(&["jailbreak"]), d);
    e.as_("lead").place_bid(root, U128(20 * USDC), "".into());
    e.as_("client").accept_bid(root, acc("lead"));
    let sj = e.as_("lead").create_subjob(root, U128(20 * USDC), U128(15 * USDC), cats(&["jailbreak"]), d);
    e.as_("sub1").place_bid(sj, U128(15 * USDC), "".into());
    e.as_("lead").accept_bid(sj, acc("sub1"));
    let f1 = e.as_("sub1").submit_finding(sj, "UA==".into(), None);
    let f2 = e.as_("sub1").submit_finding(sj, "UA==".into(), None);
    e.callback(sj, f1, ok(out_json(sj, f1, true, false)));
    assert_eq!((e.usdc("sub1"), e.usdc("lead")), (15 * USDC, 5 * USDC));
    assert_eq!(e.job(root).remaining.0, 75 * USDC); // 100 - 20 carved - 5 margin
    e.callback(sj, f2, ok(out_json(sj, f2, true, false)));
    let f = e.c.get_finding(f2).unwrap();
    assert!(f.unpaid);
    assert_eq!((f.paid_attacker.0, f.paid_lead.0), (0, 0));
    assert_eq!((e.usdc("sub1"), e.usdc("lead")), (15 * USDC, 5 * USDC));
    assert_eq!(e.job(sj).status, JobStatus::Closed);
    assert_eq!(e.job(root).remaining.0, 80 * USDC); // + the 5 left in the subjob, no margin taken
    // conservation: client 900 + escrow 80 + sub 15 + lead 5 = 1000
    assert_eq!(e.usdc("client") + e.job(root).remaining.0 + e.job(sj).remaining.0 + 20 * USDC, 1000 * USDC);
}

// --------------------------------------------------- OutLayer infra failures (option A)

#[test]
fn infra_failure_refunds_fee_minus_max_charge_once() {
    let mut e = setup_tree();
    let cfg = e.as_("anyone").get_config();
    assert_eq!(cfg.infra_refund.0, INFRA_REFUND);
    assert_eq!(cfg.outlayer_max_charge.0 + INFRA_REFUND, FEE);
    for (i, r) in [PromiseResult::Failed, ok(Value::Null), ok(json!({"success": true, "result": null}))]
        .into_iter()
        .enumerate()
    {
        let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
        let liab = e.as_("anyone").get_solvency().compute_liabilities.0;
        assert_eq!(e.callback(1, f, r), FindingStatus::Failed, "case {}", i);
        assert_eq!(e.as_("anyone").get_solvency().compute_liabilities.0, liab + INFRA_REFUND);
        // retried callback / non-Pending finding: no second refund
        e.callback(1, f, PromiseResult::Failed);
        assert_eq!(e.as_("anyone").get_solvency().compute_liabilities.0, liab + INFRA_REFUND);
    }
    assert_eq!(e.compute("sub1"), NEAR - 3 * FEE + 3 * INFRA_REFUND);
    let a = e.c.get_agent(acc("sub1")).unwrap();
    assert_eq!((a.failed, a.strikes.len()), (0, 0));
    let log = e.c.get_policy_log(None, Some(200));
    let infra: Vec<_> = log.iter().filter(|l| l.action == "infra_timeout").collect();
    assert_eq!(infra.len(), 3);
    assert!(infra[0].detail.contains("finding ") && infra[0].detail.contains("(job 1)"));
    assert_eq!(infra[0].job_id, Some(1));
    // finding.error keeps OutLayer's original message
    let errs: Vec<String> = e.c.get_findings(1).into_iter().filter_map(|f| f.error).collect();
    assert!(errs.contains(&"outlayer execution failed".to_string()));
    assert!(errs.contains(&"outlayer: run failed or produced no output".to_string()));
}

#[test]
fn infra_refund_uses_fee_paid_not_current_policy() {
    let mut e = setup_tree();
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    // owner raises the fee while the evaluation is in flight
    let mut p = e.c.get_config().policy;
    p.outlayer_fee = U128(10 * FEE);
    e.as_("owner").set_policy(p);
    e.callback(1, f, PromiseResult::Failed);
    assert_eq!(e.compute("sub1"), NEAR - FEE + INFRA_REFUND);
}

#[test]
fn non_infra_failures_unchanged() {
    let mut e = setup_tree();
    // enclave error and OutLayer success:false keep the fee and count as failed
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f, ok(json!({"v": 1, "job_id": 1, "finding_id": f, "valid": false, "error": "DECRYPT_FAILED"})));
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.callback(1, f, ok(json!({"success": false, "error": "wasm trap"})));
    assert_eq!(e.compute("sub1"), NEAR - 2 * FEE);
    assert_eq!(e.c.get_agent(acc("sub1")).unwrap().failed, 2);
    // stale pending force-Failed at expiry: no refund, late callback ignored
    let f = e.as_("sub1").submit_finding(1, "UA==".into(), None);
    e.advance(1000, 2 * HOUR);
    e.as_("anyone").expire_job(0);
    e.callback(1, f, PromiseResult::Failed);
    assert_eq!(e.compute("sub1"), NEAR - 3 * FEE);
}

#[test]
fn infra_refund_shrinks_with_bigger_limits() {
    let mut e = setup();
    e.as_("owner").set_enclave(
        json!({"WasmUrl": {"url": "u", "hash": "h", "build_target": "wasm32-wasip2"}}),
        PK_ENCLAVE.into(),
        None,
        Some(json!({"max_instructions": 10_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 180})),
    );
    // worst case 0.001 + 0.000001 + 0.018 + 0.0002 = 0.019201 → kept 0.020 → refund 0
    assert_eq!(e.c.get_config().outlayer_max_charge.0, 20_000_000_000_000_000_000_000);
    assert_eq!(e.c.get_config().infra_refund.0, 0);
    // fee below the worst-case charge → no refund at all (never out of pocket)
    let mut p = e.c.get_config().policy;
    p.outlayer_fee = U128(15_000_000_000_000_000_000_000);
    e.as_("owner").set_policy(p);
    assert_eq!(e.c.get_config().infra_refund.0, 0);
}
