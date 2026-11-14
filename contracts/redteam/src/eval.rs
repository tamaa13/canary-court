use crate::*;

/// Enclave error codes that are the client's fault (bad target / key / model). The attacker's fee is
/// refunded to their compute balance and the event is logged as `client_fault`.
pub const CLIENT_FAULT_CODES: [&str; 4] = [
    "TARGET_DECRYPT_FAILED",
    "BAD_TARGET",
    "MODEL_NOT_ALLOWED",
    "TARGET_BINDING_MISMATCH",
];
/// Attacker-fault enclave errors that strike, but ONLY when the error output carries an attested
/// `result_hash` (64 hex, over the canonical error record) for this job/finding. No hash → no strike.
/// Every other error never strikes.
pub const STRIKE_ON_ERROR_CODES: [&str; 1] = ["PAYLOAD_BINDING_MISMATCH"];

/// Why an evaluation is Failed, plus the attested hash of an enclave error record (if any).
#[derive(Debug, Clone)]
pub(crate) struct EvalFailure {
    pub msg: String,
    pub result_hash: Option<String>,
    /// OutLayer produced nothing (null output / promise failure): not the attacker's doing.
    pub infra: bool,
}

impl EvalFailure {
    fn infra(msg: &str) -> Self {
        Self { msg: msg.to_string(), result_hash: None, infra: true }
    }
}

impl From<String> for EvalFailure {
    fn from(msg: String) -> Self {
        Self { msg, result_hash: None, infra: false }
    }
}

impl From<&str> for EvalFailure {
    fn from(msg: &str) -> Self {
        msg.to_string().into()
    }
}
pub const SEVERITIES: [&str; 4] = ["high", "medium", "low", "none"];

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// "enclave: CODE[: detail]" → "CODE"
pub(crate) fn enclave_error_code(e: &str) -> Option<&str> {
    let rest = e.strip_prefix("enclave: ")?;
    let end = rest
        .find(|c: char| !(c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'))
        .unwrap_or(rest.len());
    (end > 0).then(|| &rest[..end])
}

/// Max bytes of OutLayer output we are willing to read in the callback.
pub const MAX_RESULT_LEN: usize = 16_384;
pub const MAX_REPORT_LEN: usize = 8192;

#[near]
impl Contract {
    /// Provider submits an encrypted attack payload. Deducts the OutLayer fee from the caller's
    /// compute balance and asks OutLayer to evaluate it in the enclave. The result arrives in
    /// `on_finding_evaluated`. Attach 300 TGas.
    pub fn submit_finding(
        &mut self,
        job_id: JobId,
        enc_payload: String,
        category: Option<String>,
    ) -> FindingId {
        let caller = env::predecessor_account_id();
        let job = self.job(job_id).clone();
        check(job.status == JobStatus::Assigned, "ERR_STATUS", "job is not Assigned");
        check(
            job.provider.as_ref() == Some(&caller),
            "ERR_NOT_PROVIDER",
            "only the job's provider",
        );
        let now = env::block_timestamp_ms();
        check(now < job.deadline_ms, "ERR_DEADLINE", "job deadline passed");
        self.assert_not_blocked(&caller);
        check(
            !enc_payload.is_empty() && enc_payload.len() <= MAX_BLOB_LEN,
            "ERR_INPUT",
            "enc_payload must be 1..8192 bytes",
        );
        let category = match category {
            Some(c) => {
                check(
                    job.categories.contains(&c),
                    "ERR_CATEGORY",
                    &format!("category '{}' not in job categories", c),
                );
                c
            }
            None => job.categories.join(","),
        };
        check(
            (job.findings.len() as u32) < self.policy.max_findings_per_job,
            "ERR_FINDINGS_CAP",
            &format!("max {} findings per job", self.policy.max_findings_per_job),
        );
        check(
            !self.enclave_pubkey.is_empty(),
            "ERR_STATUS",
            "enclave not configured",
        );

        self.assert_solvent();
        // OutLayer fee from the caller's compute balance.
        let fee = self.policy.outlayer_fee.0;
        let total = self.liabilities_seeded();
        let mut b = self.balance(&caller);
        check(
            b.compute.0 >= fee,
            "ERR_COMPUTE",
            &format!("compute balance below OutLayer fee {}", fee),
        );
        b.compute = U128(b.compute.0 - fee);
        self.balances.insert(caller.clone(), b);
        self.set_liabilities(total.saturating_sub(fee));

        // Gas: everything except our own reserve + callback goes to OutLayer.
        let used = env::used_gas();
        let prepaid = env::prepaid_gas();
        let outlayer_gas = prepaid
            .saturating_sub(used)
            .saturating_sub(GAS_EVAL_CALLBACK)
            .saturating_sub(GAS_SUBMIT_RESERVE);
        check(
            outlayer_gas >= GAS_OUTLAYER_MIN,
            "ERR_GAS",
            "attach more gas (300 TGas recommended)",
        );

        let finding_id = self.findings.len() as FindingId;
        self.findings.push(Finding {
            id: finding_id,
            job_id,
            attacker: caller.clone(),
            category: category.clone(),
            status: FindingStatus::Pending,
            severity: None,
            manipulation: false,
            unpaid: false,
            paid_attacker: U128(0),
            paid_lead: U128(0),
            report_for_client: None,
            report_for_lead: None,
            result_hash: None,
            error: None,
            created_ms: now,
            evaluated_ms: None,
        });
        self.set_finding_fee(finding_id, fee);
        {
            let j = self.job_mut(job_id);
            j.findings.push(finding_id);
            j.pending += 1;
        }

        let input_data = self.build_eval_input(&job, finding_id, &category, &enc_payload);
        emit(
            "finding_submitted",
            json!({
                "job_id": job_id, "finding_id": finding_id, "attacker": caller,
                "category": category, "dual": job.restricted, "fee": U128(fee),
            }),
        );

        let code_source: Value =
            serde_json::from_str(&self.enclave_code).unwrap_or(Value::Null);
        let resource_limits: Value =
            serde_json::from_str(&self.resource_limits).unwrap_or(Value::Null);
        let secrets_ref: Option<Value> = self
            .secrets_ref
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok());

        // Detached promise: the tx returns the finding id; the callback lands later.
        let _ = ext_outlayer::ext(self.outlayer_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(fee))
            .with_static_gas(outlayer_gas)
            .with_unused_gas_weight(0)
            .request_execution(
                code_source,
                Some(resource_limits),
                Some(input_data),
                secrets_ref,
                Some("Json".to_string()),
                Some(env::current_account_id()),
                None,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_EVAL_CALLBACK)
                    .with_unused_gas_weight(0)
                    .on_finding_evaluated(job_id, finding_id),
            );
        finding_id
    }

    /// OutLayer callback. Never panics on bad output: anything unexpected → Failed.
    #[private]
    pub fn on_finding_evaluated(&mut self, job_id: JobId, finding_id: FindingId) -> FindingStatus {
        let outcome = read_eval_result(job_id, finding_id);
        self.apply_evaluation(job_id, finding_id, outcome)
    }
}

impl Contract {
    pub(crate) fn build_eval_input(
        &self,
        job: &Job,
        finding_id: FindingId,
        category: &str,
        enc_payload: &str,
    ) -> String {
        let target = self
            .targets
            .get(&job.target_id)
            .unwrap_or_else(|| fail("ERR_NOT_FOUND", "target not found"));
        let client_pubkey = self
            .agents
            .get(&job.root_client)
            .map(|a| a.x25519_pubkey.clone())
            .unwrap_or_default();
        // Subjob: the lead (= subjob client) also gets a report.
        let lead_pubkey: Option<String> = if job.parent_id.is_some() {
            self.agents.get(&job.client).map(|a| a.x25519_pubkey.clone())
        } else {
            None
        };
        json!({
            "op": "evaluate",
            "job_id": job.id,
            "root_job_id": job.parent_id.unwrap_or(job.id),
            "finding_id": finding_id,
            "category": category,
            "enc_target": target.enc_target,
            "enc_payload": enc_payload,
            "client_pubkey": client_pubkey,
            "lead_pubkey": lead_pubkey,
            "dual": job.restricted,
        })
        .to_string()
    }

    /// Applies a parsed evaluation. Idempotent: non-Pending findings are left untouched.
    pub(crate) fn apply_evaluation(
        &mut self,
        job_id: JobId,
        finding_id: FindingId,
        outcome: Result<EvalOutput, EvalFailure>,
    ) -> FindingStatus {
        if finding_id > u32::MAX as u64 || self.findings.get(finding_id as u32).is_none() {
            env::log_str("on_finding_evaluated: unknown finding");
            return FindingStatus::Failed;
        }
        let finding = self.findings[finding_id as u32].clone();
        if finding.status != FindingStatus::Pending || finding.job_id != job_id {
            env::log_str("on_finding_evaluated: finding not pending; ignored");
            return finding.status;
        }
        {
            let j = self.job_mut(job_id);
            j.pending = j.pending.saturating_sub(1);
        }
        let now = env::block_timestamp_ms();
        let attacker = finding.attacker.clone();

        let out = match outcome {
            Err(failure) => {
                let e: String = failure.msg.chars().take(256).collect();
                {
                    let f = self.finding_mut(finding_id);
                    f.status = FindingStatus::Failed;
                    f.error = Some(e.clone());
                    f.evaluated_ms = Some(now);
                }
                if failure.infra {
                    // OutLayer queue/yield timeout or worker failure: refund fee − worst-case OutLayer
                    // charge; not counted against the attacker.
                    let refund = self.infra_refund(finding_id);
                    if refund > 0 {
                        let total = self.liabilities_seeded();
                        let mut b = self.balance(&attacker);
                        b.compute = U128(b.compute.0 + refund);
                        self.balances.insert(attacker.clone(), b);
                        self.set_liabilities(total + refund);
                    }
                    self.log_policy(
                        attacker.clone(),
                        "infra_timeout",
                        Some(job_id),
                        None,
                        format!(
                            "finding {} (job {}): OutLayer produced no output ({}); {} of the fee refunded",
                            finding_id, job_id, e, refund
                        ),
                    );
                } else if let Some(a) = self.agents.get_mut(&attacker) {
                    a.failed += 1;
                }
                if let (Some(code), Some(hash)) = (
                    enclave_error_code(&e).filter(|c| STRIKE_ON_ERROR_CODES.contains(c)),
                    failure.result_hash.as_ref().filter(|h| is_hex64(h)),
                ) {
                    self.finding_mut(finding_id).result_hash = Some(hash.clone());
                    let reason = format!("attacker-fault enclave error {}", code);
                    self.add_strike(&attacker, job_id, finding_id, hash.clone(), &reason);
                }
                if let Some(code) = enclave_error_code(&e).filter(|c| CLIENT_FAULT_CODES.contains(c)) {
                    // Client's fault (bad target/model): the attacker gets the OutLayer fee back.
                    let fee = self.policy.outlayer_fee.0;
                    let total = self.liabilities_seeded();
                    let mut b = self.balance(&attacker);
                    b.compute = U128(b.compute.0 + fee);
                    self.balances.insert(attacker.clone(), b);
                    self.set_liabilities(total + fee);
                    let client = self.job(job_id).root_client.clone();
                    self.log_policy(
                        client,
                        "client_fault",
                        Some(job_id),
                        None,
                        format!(
                            "finding {} failed with {} (client fault); fee {} refunded to {}",
                            finding_id, code, fee, attacker
                        ),
                    );
                }
                emit(
                    "finding_evaluated",
                    json!({ "job_id": job_id, "finding_id": finding_id, "status": FindingStatus::Failed, "error": e }),
                );
                return FindingStatus::Failed;
            }
            Ok(out) => out,
        };

        let result_hash = out.result_hash.clone().unwrap_or_default();
        for w in out.warnings.iter().filter(|w| w.as_str() == "BAD_CLIENT_KEY" || w.as_str() == "BAD_LEAD_KEY") {
            let who = if w == "BAD_CLIENT_KEY" {
                self.job(job_id).root_client.clone()
            } else {
                self.job(job_id).client.clone()
            };
            self.log_policy(
                who,
                "client_fault",
                Some(job_id),
                None,
                format!("finding {}: {} (report could not be sealed; verdict stands)", finding_id, w),
            );
        }
        let dedup_key = out.dedup_key.clone().filter(|k| !k.is_empty());
        if let Some(k) = dedup_key.as_ref() {
            self.set_finding_dedup_key(finding_id, k);
        }
        {
            let f = self.finding_mut(finding_id);
            f.evaluated_ms = Some(now);
            f.severity = out.severity.clone();
            f.manipulation = out.manipulation;
            f.result_hash = out.result_hash.clone();
            f.report_for_client = out.report_for_client.clone();
            f.report_for_lead = out.report_for_lead.clone();
        }

        // A payload that targets the evaluator is never paid, even if it also leaked.
        if out.valid && !out.manipulation {
            self.finding_mut(finding_id).status = FindingStatus::Valid;
            // Same attack already recorded under this root job → valid but not paid again.
            // Key: the enclave's dedup_key when present, else the result_hash.
            let root = self.job(job_id).parent_id.unwrap_or(job_id);
            let marker = match (&dedup_key, result_hash.is_empty()) {
                (Some(k), _) => Some(format!("k:{}", k)),
                (None, false) => Some(format!("h:{}", result_hash)),
                (None, true) => None,
            };
            if marker.as_ref().map(|m| self.seen_result(root, m)).unwrap_or(false) {
                self.finding_mut(finding_id).unpaid = true;
                self.log_policy(
                    attacker.clone(),
                    "duplicate",
                    Some(job_id),
                    None,
                    format!(
                        "finding {} repeats {} already recorded under root job {}; not paid",
                        finding_id,
                        marker.unwrap_or_default(),
                        root
                    ),
                );
            } else {
                if let Some(a) = self.agents.get_mut(&attacker) {
                    a.completed += 1;
                }
                self.pay_valid_finding(job_id, finding_id, &attacker);
            }
        } else {
            self.finding_mut(finding_id).status = FindingStatus::Invalid;
            if let Some(a) = self.agents.get_mut(&attacker) {
                a.invalid += 1;
            }
            if out.manipulation {
                self.add_strike(&attacker, job_id, finding_id, result_hash, "manipulation attempt");
            }
        }

        let f = self.findings[finding_id as u32].clone();
        emit(
            "finding_evaluated",
            json!({
                "job_id": job_id, "finding_id": finding_id, "attacker": attacker,
                "status": f.status, "severity": f.severity, "manipulation": f.manipulation,
                "unpaid": f.unpaid, "paid_attacker": f.paid_attacker, "paid_lead": f.paid_lead,
                "result_hash": f.result_hash,
            }),
        );
        f.status
    }

    fn pay_valid_finding(&mut self, job_id: JobId, finding_id: FindingId, attacker: &AccountId) {
        let job = self.job(job_id).clone();
        let amount = job.payout_per_finding.0;
        if job.is_active() && job.remaining.0 >= amount {
            self.job_mut(job_id).remaining = U128(job.remaining.0 - amount);
            self.credit_usdc(attacker, amount);
            self.finding_mut(finding_id).paid_attacker = U128(amount);
        } else {
            self.finding_mut(finding_id).unpaid = true;
            self.log_policy(
                attacker.clone(),
                "unpaid",
                Some(job_id),
                None,
                format!(
                    "finding {} valid but job remaining {} < payout {}",
                    finding_id, job.remaining.0, amount
                ),
            );
            self.close_job(job_id, "insufficient remaining for a valid finding");
            // Both legs or neither: no lead margin on a finding its sub wasn't paid for.
            return;
        }

        // Lead margin for subjob findings (only when the sub's leg was paid).
        if let Some(pid) = job.parent_id {
            let parent = self.job(pid).clone();
            let margin = parent
                .reward_per_finding
                .0
                .saturating_sub(job.reward_per_finding.0);
            if margin == 0 {
                return;
            }
            let Some(lead) = parent.provider.clone() else {
                return;
            };
            if parent.is_active() && parent.remaining.0 >= margin {
                self.job_mut(pid).remaining = U128(parent.remaining.0 - margin);
                self.credit_usdc(&lead, margin);
                self.finding_mut(finding_id).paid_lead = U128(margin);
            } else {
                self.log_policy(
                    lead,
                    "lead_margin_unpaid",
                    Some(pid),
                    None,
                    format!(
                        "finding {}: parent remaining {} < margin {}",
                        finding_id, parent.remaining.0, margin
                    ),
                );
            }
        }
    }

    fn add_strike(
        &mut self,
        attacker: &AccountId,
        job_id: JobId,
        finding_id: FindingId,
        evidence: String,
        reason: &str,
    ) {
        let strikes_to_block = self.policy.strikes_to_block as usize;
        let now = env::block_timestamp_ms();
        let (count, newly_blocked) = match self.agents.get_mut(attacker) {
            Some(a) => {
                a.strikes.push(Strike {
                    finding_id,
                    evidence_hash: evidence.clone(),
                    ts_ms: now,
                });
                let nb = !a.blocked && a.strikes.len() >= strikes_to_block;
                if nb {
                    a.blocked = true;
                }
                (a.strikes.len(), nb)
            }
            None => return,
        };
        let verdict = self.verdict_for(attacker);
        self.log_policy(
            attacker.clone(),
            "strike",
            Some(job_id),
            Some(verdict.clone()),
            format!(
                "{} in finding {} (evidence {}), strike {}/{}",
                reason, finding_id, evidence, count, strikes_to_block
            ),
        );
        if newly_blocked {
            self.log_policy(
                attacker.clone(),
                "blocklist",
                Some(job_id),
                Some(verdict),
                format!("{} blocked after {} strikes", attacker, count),
            );
        }
    }
}

/// Reads promise result 0 and parses it. Any problem → Err (finding becomes Failed).
fn read_eval_result(job_id: JobId, finding_id: FindingId) -> Result<EvalOutput, EvalFailure> {
    if env::promise_results_count() != 1 {
        return Err("unexpected promise results".into());
    }
    match env::promise_result_checked(0, MAX_RESULT_LEN) {
        Ok(bytes) => parse_eval_output(&bytes, job_id, finding_id),
        Err(near_sdk::PromiseError::Failed) => Err(EvalFailure::infra("outlayer execution failed")),
        Err(_) => Err("outlayer output too long".into()),
    }
}

/// Accepts the enclave output directly, or wrapped by OutLayer as
/// `{"success":bool,"result"|"output":...,"error":...}`, or `{"Json"|"Text": ...}`, or as a JSON string.
pub(crate) fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Attested evidence for a strikeable enclave error (enclave v0.1.2). Returns `result_hash` only if:
/// `error_record` is present (verbatim compact JSON string), sha256(error_record) == result_hash
/// (64 lowercase hex), and the record says v=1, code == the error code, job_id/finding_id == this
/// request. Anything else → None (no strike: fail closed in the attacker's favour).
pub(crate) fn error_record_hash(
    m: &serde_json::Map<String, Value>,
    job_id: JobId,
    finding_id: FindingId,
) -> Option<String> {
    let code = m.get("error")?.as_str()?;
    let record = m.get("error_record")?.as_str()?;
    let hash = m.get("result_hash")?.as_str()?;
    if !is_hex64(hash) || hex_lower(&env::sha256(record.as_bytes())) != hash {
        return None;
    }
    let rec: Value = serde_json::from_str(record).ok()?;
    let ok = rec.get("v").and_then(|v| v.as_u64()) == Some(1)
        && rec.get("job_id").and_then(|v| v.as_u64()) == Some(job_id)
        && rec.get("finding_id").and_then(|v| v.as_u64()) == Some(finding_id)
        && rec.get("code").and_then(|v| v.as_str()) == Some(code);
    ok.then(|| hash.to_string())
}

pub(crate) fn parse_eval_output(
    bytes: &[u8],
    job_id: JobId,
    finding_id: FindingId,
) -> Result<EvalOutput, EvalFailure> {
    let mut v: Value = serde_json::from_slice(bytes).map_err(|_| EvalFailure::from("output is not JSON"))?;
    for _ in 0..6 {
        match v {
            Value::String(s) => {
                v = serde_json::from_str(&s).map_err(|_| EvalFailure::from("output string is not JSON"))?;
            }
            Value::Null => return Err(EvalFailure::infra("outlayer: run failed or produced no output")),
            Value::Object(ref m) if m.contains_key("valid") => break,
            Value::Object(ref m) if m.contains_key("success") => {
                if m.get("success") != Some(&Value::Bool(true)) {
                    let err = m
                        .get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("execution unsuccessful");
                    return Err(format!("outlayer: {}", err).into());
                }
                v = m
                    .get("result")
                    .or_else(|| m.get("output"))
                    .cloned()
                    .unwrap_or(Value::Null);
            }
            Value::Object(ref m) if m.len() == 1 && (m.contains_key("Json") || m.contains_key("Text")) => {
                v = m.values().next().cloned().unwrap_or(Value::Null);
            }
            Value::Object(ref m) if m.get("error").map(|e| !e.is_null()).unwrap_or(false) => {
                return Err(EvalFailure {
                    msg: format!(
                        "enclave: {}",
                        m.get("error").and_then(|e| e.as_str()).unwrap_or("error")
                    ),
                    result_hash: error_record_hash(m, job_id, finding_id),
                    infra: false,
                });
            }
            _ => return Err("unrecognized output shape".into()),
        }
    }
    if let Value::Object(ref m) = v {
        if let Some(e) = m.get("error").filter(|e| !e.is_null()) {
            return Err(EvalFailure {
                msg: format!("enclave: {}", e.as_str().unwrap_or("error")),
                result_hash: error_record_hash(m, job_id, finding_id),
                infra: false,
            });
        }
    }
    let out: EvalOutput =
        serde_json::from_value(v).map_err(|e| EvalFailure::from(format!("bad eval output: {}", e)))?;
    if out.v != 1 {
        return Err(format!("unsupported output version {}", out.v).into());
    }
    if out.job_id != job_id || out.finding_id != finding_id {
        return Err("output job_id/finding_id mismatch".into());
    }
    match out.result_hash.as_deref() {
        Some(h) if is_hex64(h) => {}
        _ => return Err("bad output: result_hash must be 64 lowercase hex".into()),
    }
    if out.dedup_key.as_deref().map(|k| !is_hex64(k)).unwrap_or(false) {
        return Err("bad output: dedup_key must be 64 lowercase hex".into());
    }
    if out.severity.as_deref().map(|s| !SEVERITIES.contains(&s)).unwrap_or(false) {
        return Err("bad output: severity must be high|medium|low|none".into());
    }
    for r in [&out.report_for_client, &out.report_for_lead].into_iter().flatten() {
        if r.len() > MAX_REPORT_LEN {
            return Err("report too long".into());
        }
    }
    Ok(out)
}
