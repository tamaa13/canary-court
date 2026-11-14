#![allow(dead_code)]
//! Shared sandbox setup. Wasm is prebuilt by `contracts/scripts/test-sandbox.sh`
//! (cargo near build for redteam, tusdc, mock-outlayer).

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;
pub const PK: &str = "1111111111111111111111111111111111111111111111111111111111111111";
pub const PK_ENCLAVE: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

pub fn wasm(name: &str) -> Vec<u8> {
    let n = name.replace('-', "_");
    let p = format!("{}/../target/near/{n}/{n}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}: run contracts/scripts/test-sandbox.sh"))
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub root: Account,
    pub rt: Contract,
    pub tusdc: Contract,
    pub outlayer: Contract,
    pub client: Account,
    pub lead: Account,
    pub sub1: Account,
    pub sub2: Account,
    pub mallory: Account,
}

pub async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

pub async fn deploy(root: &Account, name: &str, code: &[u8]) -> anyhow::Result<Contract> {
    let acc = sub(root, name, 30).await?;
    Ok(acc.deploy(code).await?.into_result()?)
}

/// redteam + tusdc + mock outlayer deployed and initialized; client/lead/sub1/sub2 registered,
/// funded (client: 1000 tUSDC internal, providers: 1 NEAR compute + tUSDC storage) and aged past
/// min_age_blocks. mallory exists but is NOT registered.
pub async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let tusdc = deploy(&root, "tusdc", &wasm("tusdc")).await?;
    let outlayer = deploy(&root, "outlayer", &wasm("mock-outlayer")).await?;
    let rt = deploy(&root, "redteam", &wasm("redteam")).await?;
    tusdc
        .call("new")
        .args_json(json!({ "owner_id": root.id() }))
        .transact()
        .await?
        .into_result()?;
    rt.call("new")
        .args_json(json!({
            "owner_id": root.id(), "token_id": tusdc.id(), "outlayer_id": outlayer.id(),
            "enclave_code": {"WasmUrl": {"url": "https://example/e.wasm", "hash": "ab", "build_target": "wasm32-wasip2"}},
            "enclave_pubkey": PK_ENCLAVE,
            "secrets_ref": {"profile": "enclave", "account_id": root.id()},
        }))
        .transact()
        .await?
        .into_result()?;
    // redteam must be registered on the token to receive ft_transfer_call.
    root.call(tusdc.id(), "storage_deposit")
        .args_json(json!({ "account_id": rt.id(), "registration_only": true }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;

    let client = sub(&root, "client", 20).await?;
    let lead = sub(&root, "lead", 20).await?;
    let sub1 = sub(&root, "sub1", 20).await?;
    let sub2 = sub(&root, "sub2", 20).await?;
    let mallory = sub(&root, "mallory", 20).await?;

    let env = Env {
        worker,
        root,
        rt,
        tusdc,
        outlayer,
        client,
        lead,
        sub1,
        sub2,
        mallory,
    };
    env.register(&env.client, "client").await?;
    for a in [&env.lead, &env.sub1, &env.sub2] {
        env.register(a, "provider").await?;
        ok(env.call_dep(a, "deposit_compute", json!({}), NearToken::from_near(1)).await?);
        ok(env.tusdc_call(a, "mint", json!({"amount": "1"})).await?); // registers tUSDC storage
    }
    env.fund_usdc(&env.client, 1000 * USDC).await?;
    ok(env
        .call(
            &env.client,
            "register_target",
            json!({"target_id": "bot", "enc_target": "RU5DVEFSR0VU",
                   "categories": ["prompt_injection", "tool_misuse", "data_exfiltration", "jailbreak"]}),
        )
        .await?);
    env.worker.fast_forward(70).await?;
    Ok(env)
}

impl Env {
    pub async fn call(&self, who: &Account, method: &str, args: Value) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.rt.id(), method)
            .args_json(args)
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    pub async fn call_dep(
        &self,
        who: &Account,
        method: &str,
        args: Value,
        dep: NearToken,
    ) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.rt.id(), method)
            .args_json(args)
            .deposit(dep)
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    pub async fn tusdc_call(&self, who: &Account, method: &str, args: Value) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.tusdc.id(), method)
            .args_json(args)
            .gas(Gas::from_tgas(100))
            .transact()
            .await?)
    }

    pub async fn view(&self, method: &str, args: Value) -> anyhow::Result<Value> {
        Ok(self.rt.view(method).args_json(args).await?.json::<Value>()?)
    }

    pub async fn register(&self, who: &Account, role: &str) -> anyhow::Result<()> {
        ok(self
            .call(who, "register_agent", json!({"role": role, "x25519_pubkey": PK, "meta": role}))
            .await?);
        Ok(())
    }

    /// mint + ft_transfer_call(msg "") → internal USDC balance.
    pub async fn fund_usdc(&self, who: &Account, amount: u128) -> anyhow::Result<()> {
        let mut left = amount;
        while left > 0 {
            let m = left.min(1000 * USDC);
            ok(self.tusdc_call(who, "mint", json!({"amount": m.to_string()})).await?);
            left -= m;
        }
        ok(who
            .call(self.tusdc.id(), "ft_transfer_call")
            .args_json(json!({"receiver_id": self.rt.id(), "amount": amount.to_string(), "msg": ""}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?);
        Ok(())
    }

    pub async fn usdc(&self, who: &Account) -> anyhow::Result<u128> {
        let b = self.view("balance_of", json!({"account_id": who.id()})).await?;
        Ok(b["usdc"].as_str().unwrap().parse()?)
    }

    pub async fn compute(&self, who: &Account) -> anyhow::Result<u128> {
        let b = self.view("balance_of", json!({"account_id": who.id()})).await?;
        Ok(b["compute"].as_str().unwrap().parse()?)
    }

    pub async fn token_balance(&self, who: &AccountId) -> anyhow::Result<u128> {
        let v: Value = self
            .tusdc
            .view("ft_balance_of")
            .args_json(json!({"account_id": who}))
            .await?
            .json()?;
        Ok(v.as_str().unwrap().parse()?)
    }

    pub async fn job(&self, id: u64) -> anyhow::Result<Value> {
        self.view("get_job", json!({"job_id": id})).await
    }

    pub async fn now_ms(&self) -> anyhow::Result<u64> {
        Ok(self.worker.view_block().await?.timestamp() / 1_000_000)
    }

    /// Root job owned by client on target "bot", accepted by `provider` at `reward`.
    pub async fn assigned_job(
        &self,
        provider: &Account,
        budget: u128,
        reward: u128,
        cats: &[&str],
    ) -> anyhow::Result<u64> {
        let deadline = self.now_ms().await? + 3_600_000;
        let r = self
            .call(
                &self.client,
                "create_job",
                json!({"target_id": "bot", "budget": budget.to_string(),
                       "reward_per_finding": reward.to_string(), "categories": cats, "deadline_ms": deadline}),
            )
            .await?;
        let id: u64 = ok(r).json()?;
        ok(self
            .call(provider, "place_bid", json!({"job_id": id, "price_per_finding": reward.to_string(), "note": ""}))
            .await?);
        ok(self
            .call(&self.client, "accept_bid", json!({"job_id": id, "bidder": provider.id()}))
            .await?);
        Ok(id)
    }

    pub async fn submit(&self, who: &Account, job_id: u64, marker: &str) -> anyhow::Result<(u64, Value)> {
        let r = self
            .call(who, "submit_finding", json!({"job_id": job_id, "enc_payload": marker}))
            .await?;
        let fid: u64 = ok(r).json()?;
        let f = self.view("get_finding", json!({"finding_id": fid})).await?;
        Ok((fid, f))
    }

    pub async fn policy_actions(&self) -> anyhow::Result<Vec<Value>> {
        Ok(self
            .view("get_policy_log", json!({"from": 0, "limit": 200}))
            .await?
            .as_array()
            .unwrap()
            .clone())
    }
}

#[track_caller]
pub fn ok(r: ExecutionFinalResult) -> ExecutionFinalResult {
    assert!(r.is_success(), "expected success, got {:#?}", r.failures());
    r
}

/// The tx (or one of its receipts) failed with a message containing `code`.
#[track_caller]
pub fn fails_with(r: ExecutionFinalResult, code: &str) {
    assert!(r.is_failure(), "expected failure {code}, got success");
    let msg = format!("{:?}", r.failures());
    assert!(msg.contains(code), "expected {code}, got {msg}");
}
