#![allow(unused_must_use)]
//! The 4 attack scenarios (§6) at contract level, on a real sandbox chain.
mod common;
use common::*;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::Account;
use serde_json::json;

const AGENT_METHODS: [&str; 10] = [
    "register_agent", "register_target", "create_job", "place_bid", "counter_bid",
    "accept_bid", "create_subjob", "submit_finding", "expire_job", "withdraw",
];

/// Gives `owner` a function-call key scoped to redteam (the only key an agent holds) and
/// returns an Account handle that signs with it.
async fn agent_key(e: &Env, owner: &Account) -> anyhow::Result<Account> {
    let sk = SecretKey::from_random(KeyType::ED25519);
    ok(owner
        .batch(owner.id())
        .add_key(
            sk.public_key(),
            AccessKey::function_call_access(e.rt.id(), &AGENT_METHODS, Some(NearToken::from_near(1))),
        )
        .transact()
        .await?);
    Ok(Account::from_secret_key(owner.id().clone(), sk, &e.worker))
}

/// Rejected either at tx validation (Err) or at execution (failure).
fn rejected<T>(r: anyhow::Result<near_workspaces::result::ExecutionFinalResult, T>) -> bool {
    match r {
        Err(_) => true,
        Ok(x) => x.is_failure(),
    }
}

/// Scenario 1: a prompt-injected agent tries to move funds to the attacker.
#[tokio::test]
async fn attack1_injected_agent_cannot_move_funds() -> anyhow::Result<()> {
    let e = setup().await?;
    // sub1 earns 6 tUSDC internally.
    let job = e.assigned_job(&e.sub1, 100 * USDC, 6 * USDC, &["prompt_injection"]).await?;
    let (_, f) = e.submit(&e.sub1, job, "VALID").await?;
    assert_eq!(f["status"], "Valid");
    e.fund_usdc(&e.sub1, 10 * USDC).await?; // plus some tokens on tusdc via setup path
    let k = agent_key(&e, &e.sub1).await?; // what the (compromised) agent actually holds

    // (a) direct token transfer to mallory: the key is scoped to redteam, so it can't touch tusdc.
    let r = k
        .call(e.tusdc.id(), "ft_transfer")
        .args_json(json!({"receiver_id": e.mallory.id(), "amount": "1"}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await;
    assert!(rejected(r.map_err(anyhow::Error::from)), "FC key must not reach tusdc");
    // (b) even the redteam methods can't carry a deposit through a FC key.
    let r = k
        .call(e.rt.id(), "withdraw")
        .args_json(json!({"amount": "1"}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await;
    assert!(rejected(r.map_err(anyhow::Error::from)), "FC key cannot attach deposit");
    // (c) privileged/internal methods are not callable: not in the key, and private on the contract.
    let r = k
        .call(e.rt.id(), "on_withdraw")
        .args_json(json!({"account_id": e.mallory.id(), "amount": "6000000"}))
        .transact()
        .await;
    assert!(rejected(r.map_err(anyhow::Error::from)));
    fails_with(
        e.call(&e.sub1, "on_withdraw", json!({"account_id": e.mallory.id(), "amount": "6000000"})).await?,
        "is private",
    );
    fails_with(
        e.call(&e.sub1, "on_finding_evaluated", json!({"job_id": job, "finding_id": 0})).await?,
        "is private",
    );
    // (d) forging a deposit by calling ft_on_transfer directly.
    fails_with(
        e.call(&e.sub1, "ft_on_transfer", json!({"sender_id": e.mallory.id(), "amount": "1000000000", "msg": ""})).await?,
        "ERR_TOKEN",
    );
    // (e) withdraw only ever pays the caller: mallory gets nothing, sub1 gets its own funds.
    let m_before = e.token_balance(e.mallory.id()).await?;
    let s_before = e.token_balance(e.sub1.id()).await?;
    let r = k
        .call(e.rt.id(), "withdraw")
        .args_json(json!({"amount": (6 * USDC).to_string()}))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    ok(r);
    assert_eq!(e.token_balance(e.mallory.id()).await?, m_before);
    assert_eq!(e.token_balance(e.sub1.id()).await?, s_before + 6 * USDC);
    // (f) withdrawing someone else's balance is impossible: there is no account argument; overdraw fails.
    fails_with(e.call(&e.sub1, "withdraw", json!({"amount": (1_000 * USDC).to_string()})).await?, "ERR_BALANCE");
    // (g) the FC key can't spend the client's escrow either: only the client can accept/counter.
    fails_with(
        e.call(&e.sub1, "accept_bid", json!({"job_id": job, "bidder": e.sub1.id()})).await?,
        "ERR_NOT_CLIENT",
    );
    Ok(())
}

/// Scenario 2: payloads that target the evaluator → manipulation → strikes with evidence → blocked.
#[tokio::test]
async fn attack2_evaluator_manipulation_gets_blocklisted() -> anyhow::Result<()> {
    let e = setup().await?;
    e.register(&e.mallory, "provider").await?;
    ok(e.call_dep(&e.mallory, "deposit_compute", json!({}), NearToken::from_near(1)).await?);
    e.worker.fast_forward(70).await?; // aged → Allow, so it is not restricted
    let job = e.assigned_job(&e.mallory, 100 * USDC, 10 * USDC, &["prompt_injection"]).await?;
    assert_eq!(e.job(job).await?["restricted"], false);

    let (f1, f) = e.submit(&e.mallory, job, "MANIP").await?;
    assert_eq!(f["status"], "Invalid");
    assert_eq!(f["manipulation"], true);
    let v = e.view("check_counterparty", json!({"account_id": e.mallory.id()})).await?;
    assert_eq!(v["level"], "Warn");
    let (f2, _) = e.submit(&e.mallory, job, "MANIP").await?;

    let a = e.view("get_agent", json!({"account_id": e.mallory.id()})).await?;
    assert_eq!(a["blocked"], true);
    let strikes = a["strikes"].as_array().unwrap();
    assert_eq!(strikes.len(), 2);
    assert_eq!(strikes[0]["finding_id"], f1);
    assert_eq!(strikes[0]["evidence_hash"], format!("0{:063x}", f1));
    assert_eq!(strikes[1]["evidence_hash"], format!("0{:063x}", f2));
    assert_eq!(e.usdc(&e.mallory).await?, 0);
    let v = e.view("check_counterparty", json!({"account_id": e.mallory.id()})).await?;
    assert_eq!(v["level"], "Block");

    let log = e.policy_actions().await?;
    let strikes_logged = log.iter().filter(|l| l["action"] == "strike").count();
    assert_eq!(strikes_logged, 2);
    assert!(log.iter().any(|l| l["action"] == "blocklist" && l["verdict"]["level"] == "Block"));

    // blocked: can't submit again, can't bid elsewhere.
    fails_with(
        e.call(&e.mallory, "submit_finding", json!({"job_id": job, "enc_payload": "VALID"})).await?,
        "ERR_COUNTERPARTY_BLOCK",
    );
    let deadline = e.now_ms().await? + 3_600_000;
    let j2: u64 = ok(e.call(&e.client, "create_job", json!({"target_id": "bot", "budget": (10 * USDC).to_string(),
        "reward_per_finding": (1 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": deadline})).await?).json()?;
    fails_with(
        e.call(&e.mallory, "place_bid", json!({"job_id": j2, "price_per_finding": "1000000", "note": ""})).await?,
        "ERR_COUNTERPARTY_BLOCK",
    );
    Ok(())
}

/// Scenario 3: new agent → Warn → automatic escalation; blocklisted/unregistered → Block.
#[tokio::test]
async fn attack3_counterparty_warn_escalation_and_block() -> anyhow::Result<()> {
    let e = setup().await?;
    // Fresh registration (no fast_forward) → Warn.
    e.register(&e.mallory, "provider").await?;
    ok(e.call_dep(&e.mallory, "deposit_compute", json!({}), NearToken::from_near(1)).await?);
    let v = e.view("check_counterparty", json!({"account_id": e.mallory.id()})).await?;
    assert_eq!(v["level"], "Warn");
    assert!(v["reasons"][0].as_str().unwrap().starts_with("new agent"));

    let job = e.assigned_job(&e.mallory, 100 * USDC, 10 * USDC, &["jailbreak"]).await?;
    let j = e.job(job).await?;
    assert_eq!(j["restricted"], true);
    assert_eq!(j["can_subcontract"], false);
    assert_eq!(j["payout_per_finding"], (5 * USDC).to_string());
    let log = e.policy_actions().await?;
    let last = log.iter().rev().find(|l| l["action"] == "accept_bid").unwrap();
    assert_eq!(last["verdict"]["level"], "Warn");
    assert!(last["detail"].as_str().unwrap().contains("RESTRICTED"));

    // no subcontracting
    fails_with(
        e.call(&e.mallory, "create_subjob", json!({"parent_id": job, "budget": (10 * USDC).to_string(),
            "reward_per_finding": (1 * USDC).to_string(), "categories": ["jailbreak"],
            "deadline_ms": e.now_ms().await? + 600_000})).await?,
        "ERR_NO_SUBCONTRACT",
    );
    // dual evaluation requested from the enclave (mock echoes it in result_hash), reward capped at 50%.
    let (fid, f) = e.submit(&e.mallory, job, "VALID").await?;
    assert_eq!(f["status"], "Valid");
    assert_eq!(f["result_hash"], format!("d{:063x}", fid));
    assert_eq!(f["paid_attacker"], (5 * USDC).to_string());

    // unregistered agent → Block / can't bid.
    let ghost = sub(&e.root, "ghost", 5).await?;
    let v = e.view("check_counterparty", json!({"account_id": ghost.id()})).await?;
    assert_eq!(v["level"], "Block");
    let deadline = e.now_ms().await? + 3_600_000;
    let j2: u64 = ok(e.call(&e.client, "create_job", json!({"target_id": "bot", "budget": (10 * USDC).to_string(),
        "reward_per_finding": (1 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": deadline})).await?).json()?;
    fails_with(
        e.call(&ghost, "place_bid", json!({"job_id": j2, "price_per_finding": "1000000", "note": ""})).await?,
        "ERR_NOT_REGISTERED",
    );
    // bid placed while clean, agent blocked afterwards → accept panics with Block.
    e.worker.fast_forward(70).await?;
    let j3: u64 = ok(e.call(&e.client, "create_job", json!({"target_id": "bot", "budget": (10 * USDC).to_string(),
        "reward_per_finding": (1 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": deadline})).await?).json()?;
    ok(e.call(&e.mallory, "place_bid", json!({"job_id": j3, "price_per_finding": "1000000", "note": ""})).await?);
    for _ in 0..2 {
        e.submit(&e.mallory, job, "MANIP").await?;
    }
    fails_with(
        e.call(&e.client, "accept_bid", json!({"job_id": j3, "bidder": e.mallory.id()})).await?,
        "ERR_COUNTERPARTY_BLOCK",
    );
    Ok(())
}

/// Scenario 4: runaway lead tries to exceed subjob / budget / depth / rate caps.
#[tokio::test]
async fn attack4_runaway_lead_hits_policy_caps() -> anyhow::Result<()> {
    let e = setup().await?;
    let job = e.assigned_job(&e.lead, 100 * USDC, 10 * USDC, &["prompt_injection", "tool_misuse"]).await?;
    let dl = e.now_ms().await? + 1_800_000;
    let mk = |budget: u128, reward: u128, cats: serde_json::Value, parent: u64| {
        json!({"parent_id": parent, "budget": budget.to_string(), "reward_per_finding": reward.to_string(),
               "categories": cats, "deadline_ms": dl})
    };
    // budget beyond what the parent has left
    fails_with(e.call(&e.lead, "create_subjob", mk(101 * USDC, 5 * USDC, json!(["prompt_injection"]), job)).await?, "ERR_BUDGET_CAP");
    // sub reward above the parent's (negative lead margin / overpaying from escrow)
    fails_with(e.call(&e.lead, "create_subjob", mk(50 * USDC, 11 * USDC, json!(["prompt_injection"]), job)).await?, "ERR_REWARD");
    // category the client never paid for
    fails_with(e.call(&e.lead, "create_subjob", mk(50 * USDC, 5 * USDC, json!(["jailbreak"]), job)).await?, "ERR_CATEGORY");
    // two legit children
    let s1: u64 = ok(e.call(&e.lead, "create_subjob", mk(40 * USDC, 5 * USDC, json!(["prompt_injection"]), job)).await?).json()?;
    ok(e.call(&e.lead, "create_subjob", mk(40 * USDC, 5 * USDC, json!(["tool_misuse"]), job)).await?);
    // a third child
    fails_with(e.call(&e.lead, "create_subjob", mk(10 * USDC, 5 * USDC, json!(["tool_misuse"]), job)).await?, "ERR_MAX_CHILDREN");
    // depth: the sub that wins a subjob can't subcontract further
    ok(e.call(&e.sub1, "place_bid", json!({"job_id": s1, "price_per_finding": (5 * USDC).to_string(), "note": ""})).await?);
    ok(e.call(&e.lead, "accept_bid", json!({"job_id": s1, "bidder": e.sub1.id()})).await?);
    fails_with(e.call(&e.sub1, "create_subjob", mk(5 * USDC, 1 * USDC, json!(["prompt_injection"]), s1)).await?, "ERR_DEPTH");
    // escrow untouched by the failures: 100 - 40 - 40
    assert_eq!(e.job(job).await?["remaining"], (20 * USDC).to_string());

    // root budget above policy cap, and rate limit
    fails_with(
        e.call(&e.client, "create_job", json!({"target_id": "bot", "budget": (1001 * USDC).to_string(),
            "reward_per_finding": (1 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": dl})).await?,
        "ERR_BUDGET_CAP",
    );
    let mut p = e.view("get_config", json!({})).await?["policy"].clone();
    p["rate_limit_per_hour"] = json!(3);
    ok(e.root.call(e.rt.id(), "set_policy").args_json(json!({"policy": p})).transact().await?);
    // client already used 2 of 3 this hour (register_target + 1 create_job)
    for _ in 0..1 {
        ok(e.call(&e.client, "create_job", json!({"target_id": "bot", "budget": (1 * USDC).to_string(),
            "reward_per_finding": (1 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": dl})).await?);
    }
    fails_with(
        e.call(&e.client, "create_job", json!({"target_id": "bot", "budget": (1 * USDC).to_string(),
            "reward_per_finding": (1 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": dl})).await?,
        "ERR_RATE_LIMIT",
    );
    // non-owner can't loosen policy
    fails_with(
        e.lead.call(e.rt.id(), "set_policy").args_json(json!({"policy": p})).transact().await?,
        "ERR_NOT_OWNER",
    );
    Ok(())
}
