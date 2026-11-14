#![allow(unused_must_use)]
//! Main flow on a real sandbox chain: real promise chain to a mock OutLayer, real NEP-141 transfers.
mod common;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::test]
async fn full_job_tree_payouts_withdraw_and_expiry() -> anyhow::Result<()> {
    let e = setup().await?;
    assert_eq!(e.usdc(&e.client).await?, 1000 * USDC);

    // client posts, lead bids high, client counters, lead accepts counter by re-bidding, client accepts.
    let now = e.now_ms().await?;
    let deadline = now + 3_600_000;
    let job: u64 = ok(e
        .call(&e.client, "create_job", json!({"target_id": "bot", "budget": (100 * USDC).to_string(),
            "reward_per_finding": (10 * USDC).to_string(), "categories": ["prompt_injection", "tool_misuse"],
            "deadline_ms": deadline}))
        .await?)
    .json()?;
    ok(e.call(&e.lead, "place_bid", json!({"job_id": job, "price_per_finding": (12 * USDC).to_string(), "note": "2 specialists"})).await?);
    ok(e.call(&e.client, "counter_bid", json!({"job_id": job, "bidder": e.lead.id(), "price_per_finding": (10 * USDC).to_string()})).await?);
    ok(e.call(&e.lead, "place_bid", json!({"job_id": job, "price_per_finding": (10 * USDC).to_string(), "note": "ok"})).await?);
    ok(e.call(&e.client, "accept_bid", json!({"job_id": job, "bidder": e.lead.id()})).await?);
    let j = e.job(job).await?;
    assert_eq!(j["status"], "Assigned");
    assert_eq!(j["restricted"], false);
    assert_eq!(j["can_subcontract"], true);

    // lead subcontracts twice, carving from the parent escrow.
    let s1: u64 = ok(e.call(&e.lead, "create_subjob", json!({"parent_id": job, "budget": (30 * USDC).to_string(),
        "reward_per_finding": (6 * USDC).to_string(), "categories": ["prompt_injection"], "deadline_ms": deadline})).await?).json()?;
    let s2: u64 = ok(e.call(&e.lead, "create_subjob", json!({"parent_id": job, "budget": (20 * USDC).to_string(),
        "reward_per_finding": (4 * USDC).to_string(), "categories": ["tool_misuse"], "deadline_ms": deadline})).await?).json()?;
    assert_eq!(e.job(job).await?["remaining"], (50 * USDC).to_string());
    for (s, a, p) in [(s1, &e.sub1, 6), (s2, &e.sub2, 4)] {
        ok(e.call(a, "place_bid", json!({"job_id": s, "price_per_finding": (p * USDC).to_string(), "note": ""})).await?);
        ok(e.call(&e.lead, "accept_bid", json!({"job_id": s, "bidder": a.id()})).await?);
    }

    // sub1: valid finding through the real promise chain → sub 6, lead margin 4.
    let compute_before = e.compute(&e.sub1).await?;
    let (f0, f) = e.submit(&e.sub1, s1, "VALID").await?;
    assert_eq!(f["status"], "Valid", "{f}");
    assert_eq!(f["paid_attacker"], (6 * USDC).to_string());
    assert_eq!(f["paid_lead"], (4 * USDC).to_string());
    assert_eq!(f["report_for_lead"], "UkVQT1JUX0ZPUl9MRUFE"); // lead pubkey was sent for a subjob
    assert_eq!(f["result_hash"], format!("0{:063x}", f0));
    assert_eq!(e.compute(&e.sub1).await?, compute_before - 20_000_000_000_000_000_000_000);
    assert_eq!(e.usdc(&e.sub1).await?, 6 * USDC);
    assert_eq!(e.usdc(&e.lead).await?, 4 * USDC);

    // lead attacks the root job itself.
    let (_, f) = e.submit(&e.lead, job, "VALID").await?;
    assert_eq!(f["status"], "Valid");
    assert_eq!(f["report_for_lead"], serde_json::Value::Null);
    assert_eq!(e.usdc(&e.lead).await?, 14 * USDC);

    // sub2: plain invalid → no pay, no strike.
    let (_, f) = e.submit(&e.sub2, s2, "INVALID").await?;
    assert_eq!(f["status"], "Invalid");
    let a = e.view("get_agent", json!({"account_id": e.sub2.id()})).await?;
    assert_eq!((a["invalid"].as_u64(), a["strikes"].as_array().unwrap().len()), (Some(1), 0));

    // withdraw: 0-deposit call, the contract attaches 1 yocto and ft_transfers to the caller.
    let before = e.token_balance(e.sub1.id()).await?;
    let r = ok(e.call(&e.sub1, "withdraw", json!({"amount": (6 * USDC).to_string()})).await?);
    assert!(r.json::<bool>()?);
    assert_eq!(e.token_balance(e.sub1.id()).await?, before + 6 * USDC);
    assert_eq!(e.usdc(&e.sub1).await?, 0);

    // withdraw to an account that is not registered on the token → ft_transfer fails → re-credited.
    let unreg = sub(&e.root, "unreg", 5).await?;
    e.fund_usdc(&unreg, 3 * USDC).await?; // mint auto-registers on tusdc; then unregister below
    let bal = e.usdc(&unreg).await?;
    assert_eq!(bal, 3 * USDC);
    ok(unreg
        .call(e.tusdc.id(), "storage_unregister")
        .args_json(json!({"force": true}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?);
    let r = ok(e.call(&unreg, "withdraw", json!({"amount": (3 * USDC).to_string()})).await?);
    assert!(!r.json::<bool>()?, "ft_transfer should fail for an unregistered receiver");
    assert_eq!(e.usdc(&unreg).await?, 3 * USDC);

    // expiry: shorten via a new short tree, then roll refunds up children-first.
    let mut p = e.view("get_config", json!({})).await?["policy"].clone();
    p["min_deadline_ms"] = json!(0);
    ok(e.root.call(e.rt.id(), "set_policy").args_json(json!({"policy": p})).transact().await?);
    let client_before = e.usdc(&e.client).await?;
    let short = e.now_ms().await? + 3_000;
    let j2: u64 = ok(e.call(&e.client, "create_job", json!({"target_id": "bot", "budget": (40 * USDC).to_string(),
        "reward_per_finding": (4 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": short})).await?).json()?;
    ok(e.call(&e.lead, "place_bid", json!({"job_id": j2, "price_per_finding": (4 * USDC).to_string(), "note": ""})).await?);
    ok(e.call(&e.client, "accept_bid", json!({"job_id": j2, "bidder": e.lead.id()})).await?);
    let c: u64 = ok(e.call(&e.lead, "create_subjob", json!({"parent_id": j2, "budget": (10 * USDC).to_string(),
        "reward_per_finding": (2 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": short})).await?).json()?;
    fails_with(e.call(&e.sub1, "expire_job", json!({"job_id": j2})).await?, "ERR_DEADLINE");
    while e.now_ms().await? < short {
        e.worker.fast_forward(5).await?;
    }
    ok(e.call(&e.sub1, "expire_job", json!({"job_id": j2})).await?);
    assert_eq!(e.job(c).await?["status"], "Expired");
    assert_eq!(e.job(j2).await?["status"], "Expired");
    assert_eq!(e.usdc(&e.client).await?, client_before);
    let log = e.policy_actions().await?;
    let tail: Vec<(String, u64)> = log
        .iter()
        .rev()
        .take(4)
        .rev()
        .map(|l| (l["action"].as_str().unwrap().to_string(), l["job_id"].as_u64().unwrap()))
        .collect();
    assert_eq!(
        tail,
        vec![("expire".into(), c), ("refund".into(), c), ("expire".into(), j2), ("refund".into(), j2)]
    );
    Ok(())
}

#[tokio::test]
async fn outlayer_failures_mark_failed_infra_refunded() -> anyhow::Result<()> {
    let e = setup().await?;
    let job = e.assigned_job(&e.sub1, 100 * USDC, 5 * USDC, &["jailbreak"]).await?;
    let c0 = e.compute(&e.sub1).await?;
    for marker in ["PANIC", "NULL", "ERROR", "MISMATCH"] {
        let (_, f) = e.submit(&e.sub1, job, marker).await?;
        assert_eq!(f["status"], "Failed", "{marker}: {f}");
        assert!(f["error"].is_string(), "{marker}");
    }
    // PANIC (promise failure) and NULL are OutLayer infra failures: fee − worst-case charge refunded,
    // logged infra_timeout, not counted as failed. ERROR / MISMATCH keep the fee.
    let cfg = e.view("get_config", json!({})).await?;
    let refund: u128 = cfg["infra_refund"].as_str().unwrap().parse()?;
    assert_eq!(refund, 9_000_000_000_000_000_000_000); // exactly 0.009 NEAR
    assert_eq!(e.compute(&e.sub1).await?, c0 - 4 * 20_000_000_000_000_000_000_000 + 2 * refund);
    let log = e.policy_actions().await?;
    assert_eq!(log.iter().filter(|l| l["action"] == "infra_timeout").count(), 2);
    let s = e.view("get_solvency", json!({})).await?;
    assert_eq!(s["solvent"], true);
    let a = e.view("get_agent", json!({"account_id": e.sub1.id()})).await?;
    assert_eq!(a["failed"], 2);
    assert_eq!(a["invalid"], 0);
    assert_eq!(a["strikes"].as_array().unwrap().len(), 0);
    assert_eq!(e.job(job).await?["pending"], 0);
    assert_eq!(e.usdc(&e.sub1).await?, 0);
    Ok(())
}

#[tokio::test]
async fn submit_with_too_little_gas_is_rejected() -> anyhow::Result<()> {
    let e = setup().await?;
    let job = e.assigned_job(&e.sub1, 100 * USDC, 5 * USDC, &["jailbreak"]).await?;
    let r = e
        .sub1
        .call(e.rt.id(), "submit_finding")
        .args_json(json!({"job_id": job, "enc_payload": "VALID"}))
        .gas(near_workspaces::types::Gas::from_tgas(150))
        .transact()
        .await?;
    fails_with(r, "ERR_GAS");
    Ok(())
}

#[tokio::test]
async fn withdraw_compute_returns_near_to_caller() -> anyhow::Result<()> {
    let e = setup().await?;
    let before = e.sub1.view_account().await?.balance;
    let r = ok(e.call(&e.sub1, "withdraw_compute", json!({"amount": "500000000000000000000000"})).await?);
    assert!(r.json::<bool>()?);
    let after = e.sub1.view_account().await?.balance;
    // +0.5 NEAR minus gas (~0.011 NEAR at sandbox gas price)
    let delta = after.as_yoctonear() as i128 - before.as_yoctonear() as i128;
    assert!(delta > 450_000_000_000_000_000_000_000, "delta {delta}");
    assert_eq!(e.compute(&e.sub1).await?, 500_000_000_000_000_000_000_000);
    fails_with(e.call(&e.sub1, "withdraw_compute", json!({"amount": "600000000000000000000000"})).await?, "ERR_COMPUTE");
    let log = e.policy_actions().await?;
    assert_eq!(log.last().unwrap()["action"], "withdraw_compute");
    Ok(())
}

#[tokio::test]
async fn duplicate_results_paid_once_and_solvency_view() -> anyhow::Result<()> {
    let e = setup().await?;
    let job = e.assigned_job(&e.sub1, 100 * USDC, 5 * USDC, &["jailbreak"]).await?;
    let (_, f) = e.submit(&e.sub1, job, "DUP").await?;
    assert_eq!((f["status"].as_str(), f["unpaid"].as_bool()), (Some("Valid"), Some(false)));
    let (_, f) = e.submit(&e.sub1, job, "DUP").await?;
    assert_eq!((f["status"].as_str(), f["unpaid"].as_bool()), (Some("Valid"), Some(true)));
    assert_eq!(e.usdc(&e.sub1).await?, 5 * USDC);
    assert_eq!(e.job(job).await?["remaining"], (95 * USDC).to_string());
    let log = e.policy_actions().await?;
    assert!(log.iter().any(|l| l["action"] == "duplicate"));

    let s = e.view("get_solvency", json!({})).await?;
    assert_eq!(s["solvent"], true);
    let liab: u128 = s["compute_liabilities"].as_str().unwrap().parse()?;
    // lead, sub1, sub2 deposited 1 NEAR each; sub1 paid two 0.02 fees
    assert_eq!(liab, 3 * 1_000_000_000_000_000_000_000_000 - 2 * 20_000_000_000_000_000_000_000);
    let bal: u128 = s["balance"].as_str().unwrap().parse()?;
    let storage: u128 = s["storage_cost"].as_str().unwrap().parse()?;
    assert_eq!(s["headroom"].as_str().unwrap().parse::<i128>()?, bal as i128 - storage as i128 - liab as i128);
    Ok(())
}

#[tokio::test]
async fn client_fault_refunds_fee_and_locks_hold() -> anyhow::Result<()> {
    let e = setup().await?;
    let job = e.assigned_job(&e.sub1, 100 * USDC, 5 * USDC, &["jailbreak"]).await?;
    let c0 = e.compute(&e.sub1).await?;
    let (_, f) = e.submit(&e.sub1, job, "TFAIL").await?;
    assert_eq!(f["status"], "Failed");
    assert_eq!(e.compute(&e.sub1).await?, c0, "fee refunded on client fault");
    assert!(e.policy_actions().await?.iter().any(|l| l["action"] == "client_fault"));
    // target is locked and the client's key is frozen while the job is active
    fails_with(
        e.call(&e.client, "register_target", json!({"target_id": "bot", "enc_target": "TkVX", "categories": ["jailbreak"]})).await?,
        "ERR_TARGET_LOCKED",
    );
    fails_with(
        e.call(&e.client, "register_agent", json!({"role": "client", "x25519_pubkey": "2".repeat(64), "meta": ""})).await?,
        "ERR_KEY_LOCKED",
    );
    fails_with(
        e.call(&e.mallory, "register_agent", json!({"role": "provider", "x25519_pubkey": "00".repeat(32), "meta": ""})).await?,
        "ERR_BAD_KEY",
    );
    let (_, f) = e.submit(&e.sub1, job, "VALID").await?;
    assert_eq!(f["dedup_key"].as_str().map(|s| s.len()), Some(64));
    Ok(())
}

#[tokio::test]
async fn binding_mismatch_errors_v012() -> anyhow::Result<()> {
    let e = setup().await?;
    let job = e.assigned_job(&e.sub1, 100 * USDC, 5 * USDC, &["jailbreak"]).await?;
    let c0 = e.compute(&e.sub1).await?;
    // client-fault: target bound to another client → refund, no strike
    let (_, f) = e.submit(&e.sub1, job, "TBIND").await?;
    assert_eq!(f["status"], "Failed");
    assert_eq!(e.compute(&e.sub1).await?, c0);
    // attacker-fault with attested error_record → strike, fee kept
    let (fid, f) = e.submit(&e.sub1, job, "PBIND").await?;
    assert_eq!(f["status"], "Failed");
    let a = e.view("get_agent", json!({"account_id": e.sub1.id()})).await?;
    let strikes = a["strikes"].as_array().unwrap();
    assert_eq!(strikes.len(), 1);
    assert_eq!(strikes[0]["finding_id"], fid);
    assert_eq!(strikes[0]["evidence_hash"], f["result_hash"]);
    assert_eq!(e.compute(&e.sub1).await?, c0 - 20_000_000_000_000_000_000_000);
    Ok(())
}

#[tokio::test]
async fn lead_margin_only_when_sub_is_paid() -> anyhow::Result<()> {
    let e = setup().await?;
    let root = e.assigned_job(&e.lead, 100 * USDC, 20 * USDC, &["jailbreak", "tool_misuse"]).await?;
    let dl = e.now_ms().await? + 1_800_000;
    // underfunded subjob: room for exactly one 15-tUSDC finding
    let sj: u64 = ok(e.call(&e.lead, "create_subjob", json!({"parent_id": root, "budget": (20 * USDC).to_string(),
        "reward_per_finding": (15 * USDC).to_string(), "categories": ["jailbreak"], "deadline_ms": dl})).await?).json()?;
    ok(e.call(&e.sub1, "place_bid", json!({"job_id": sj, "price_per_finding": (15 * USDC).to_string(), "note": ""})).await?);
    ok(e.call(&e.lead, "accept_bid", json!({"job_id": sj, "bidder": e.sub1.id()})).await?);
    let (_, f) = e.submit(&e.sub1, sj, "VALID").await?;
    assert_eq!((f["paid_attacker"].as_str(), f["paid_lead"].as_str()), (Some("15000000"), Some("5000000")));
    let (_, f) = e.submit(&e.sub1, sj, "VALID").await?;
    assert_eq!(f["unpaid"], true);
    assert_eq!((f["paid_attacker"].as_str(), f["paid_lead"].as_str()), (Some("0"), Some("0")));
    assert_eq!(e.usdc(&e.lead).await?, 5 * USDC);
    // margin stayed in the parent: 100 - 20 carved - 5 margin + 5 rolled back from the closed subjob
    assert_eq!(e.job(root).await?["remaining"], (80 * USDC).to_string());

    // duplicate in a (funded) subjob: neither leg
    let sj2: u64 = ok(e.call(&e.lead, "create_subjob", json!({"parent_id": root, "budget": (40 * USDC).to_string(),
        "reward_per_finding": (10 * USDC).to_string(), "categories": ["tool_misuse"], "deadline_ms": dl})).await?).json()?;
    ok(e.call(&e.sub2, "place_bid", json!({"job_id": sj2, "price_per_finding": (10 * USDC).to_string(), "note": ""})).await?);
    ok(e.call(&e.lead, "accept_bid", json!({"job_id": sj2, "bidder": e.sub2.id()})).await?);
    let (_, f) = e.submit(&e.sub2, sj2, "DUP").await?;
    assert_eq!(f["paid_lead"], (10 * USDC).to_string());
    let (_, f) = e.submit(&e.sub2, sj2, "DUP").await?;
    assert_eq!((f["unpaid"].as_bool(), f["paid_attacker"].as_str(), f["paid_lead"].as_str()), (Some(true), Some("0"), Some("0")));
    assert_eq!(e.usdc(&e.lead).await?, 15 * USDC);
    Ok(())
}
