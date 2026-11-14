//! Sandbox-only mock of `outlayer.testnet::request_execution`.
//!
//! Mirrors the live ABI and returns what the real OutLayer hands to the caller's callback: the guest's
//! JSON (or `null`). The verdict is scripted by the plaintext marker in `enc_payload`:
//!   "VALID" → valid leak, "INVALID" → no leak, "MANIP" → manipulation (valid=false),
//!   "ERROR" → enclave error, "NULL" → null (run failed), "PANIC" → promise failure,
//!   "MISMATCH" → wrong finding_id, "DUP" → valid leak with a fixed dedup_key (dedup tests), "TFAIL"/"TBIND" → client-fault errors,
//!   "PBIND" → PAYLOAD_BINDING_MISMATCH with an attested error_record (strike).
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId};

#[near(contract_state)]
#[derive(Default)]
pub struct Contract {}

#[near]
impl Contract {
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) -> Value {
        let _ = (source, resource_limits, secrets_ref, response_format, payer_account_id, params);
        assert!(
            env::attached_deposit().as_yoctonear() >= 10_000_000_000_000_000_000_000,
            "mock outlayer: deposit below estimate"
        );
        let input: Value = near_sdk::serde_json::from_str(&input_data.unwrap_or_default())
            .unwrap_or(Value::Null);
        let job_id = input["job_id"].as_u64().unwrap_or(0);
        let finding_id = input["finding_id"].as_u64().unwrap_or(0);
        let dual = input["dual"].as_bool().unwrap_or(false);
        let marker = input["enc_payload"].as_str().unwrap_or("");
        let base = |valid: bool, manipulation: bool, error: Value, fid: u64| {
            json!({
                "v": 1, "job_id": job_id, "finding_id": fid, "valid": valid,
                "manipulation": manipulation,
                "severity": if valid { "high" } else { "none" },
                "report_for_client": if valid { json!("UkVQT1JUX0ZPUl9DTElFTlQ=") } else { Value::Null },
                "report_for_lead": if valid && !input["lead_pubkey"].is_null() { json!("UkVQT1JUX0ZPUl9MRUFE") } else { Value::Null },
                // 64 lowercase hex like the real enclave; the first nibble echoes the dual flag (d/0)
                "result_hash": format!("{}{:063x}", if dual { "d" } else { "0" }, finding_id),
                "dedup_key": if error.is_null() { json!(format!("{:064x}", 0xabc0_0000_0000u64 + finding_id)) } else { Value::Null },
                "warnings": [],
                "error": error, "llm": "mock",
            })
        };
        match marker {
            "VALID" => base(true, false, Value::Null, finding_id),
            "INVALID" => base(false, false, Value::Null, finding_id),
            "MANIP" => base(false, true, Value::Null, finding_id),
            "ERROR" => base(false, false, json!("DECRYPT_FAILED"), finding_id),
            "TFAIL" => base(false, false, json!("TARGET_DECRYPT_FAILED"), finding_id),
            "TBIND" => base(false, false, json!("TARGET_BINDING_MISMATCH"), finding_id),
            "PBIND" => {
                // enclave v0.1.2: attested evidence = sha256(verbatim error_record)
                let rec = format!(
                    r#"{{"v":1,"job_id":{},"root_job_id":{},"finding_id":{},"code":"PAYLOAD_BINDING_MISMATCH","claimed_job_id":null}}"#,
                    job_id, input["root_job_id"], finding_id
                );
                let hash: String = env::sha256(rec.as_bytes()).iter().map(|b| format!("{:02x}", b)).collect();
                let mut v = base(false, false, json!("PAYLOAD_BINDING_MISMATCH"), finding_id);
                v["error_record"] = json!(rec);
                v["result_hash"] = json!(hash);
                v
            }
            "MISMATCH" => base(true, false, Value::Null, finding_id + 1000),
            "DUP" => {
                let mut v = base(true, false, Value::Null, finding_id);
                // same attack → same dedup_key; result_hash stays per-finding (as in the real enclave)
                v["dedup_key"] = json!("dd".repeat(32));
                v
            }
            "PANIC" => env::panic_str("mock outlayer: execution failed"),
            _ => Value::Null,
        }
    }
}
