//! Solvency invariant + duplicate-finding registry.
//!
//! Both live under raw storage keys instead of struct fields so the upgrade needs no state migration.
//!
//! Invariant: the contract's NEAR balance minus the storage it stakes must cover every agent's compute
//! deposit plus `SOLVENCY_RESERVE`. State-growing agent calls check it (ERR_STORAGE) so that contract-paid
//! storage can never eat into agent deposits.
use crate::*;

/// Σ compute balances (u128 LE).
const KEY_LIABILITIES: &[u8] = b"rt:cl";
/// Prefix for `root_job_id (u64 BE) ++ "k:"dedup_key | "h:"result_hash` → seen.
const KEY_DUP_PREFIX: &[u8] = b"rt:d:";
/// Prefix for `finding_id (u64 BE)` → dedup_key reported by the enclave.
const KEY_FINDING_DEDUP: &[u8] = b"rt:fk:";
/// Headroom kept above liabilities for the writes of the call being checked and later callbacks.
pub const SOLVENCY_RESERVE: u128 = 500_000_000_000_000_000_000_000; // 0.5 NEAR

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SolvencyView {
    /// Liquid NEAR balance of the contract account.
    pub balance: U128,
    pub storage_usage: u64,
    /// NEAR staked for storage (storage_usage × byte cost).
    pub storage_cost: U128,
    /// Σ agents' compute balances (NEAR owed to agents).
    pub compute_liabilities: U128,
    pub reserve: U128,
    /// balance − storage_cost − compute_liabilities (signed, decimal string).
    pub headroom: String,
    /// headroom ≥ reserve
    pub solvent: bool,
}

impl Contract {
    fn liabilities_stored() -> Option<u128> {
        env::storage_read(KEY_LIABILITIES).and_then(|b| b.try_into().ok().map(u128::from_le_bytes))
    }

    /// Σ compute over registered agents. Used once to seed the counter after the upgrade.
    fn liabilities_scan(&self) -> u128 {
        let mut total = 0u128;
        for id in self.agent_ids.iter() {
            total += self.balances.get(id).map(|b| b.compute.0).unwrap_or(0);
        }
        total
    }

    pub(crate) fn liabilities(&self) -> u128 {
        Self::liabilities_stored().unwrap_or_else(|| self.liabilities_scan())
    }

    /// Call BEFORE mutating a compute balance: seeds the counter on first use after the upgrade.
    pub(crate) fn liabilities_seeded(&mut self) -> u128 {
        match Self::liabilities_stored() {
            Some(v) => v,
            None => {
                let v = self.liabilities_scan();
                env::storage_write(KEY_LIABILITIES, &v.to_le_bytes());
                v
            }
        }
    }

    pub(crate) fn set_liabilities(&mut self, v: u128) {
        env::storage_write(KEY_LIABILITIES, &v.to_le_bytes());
    }

    fn headroom(&self) -> i128 {
        let balance = env::account_balance().as_yoctonear() as i128;
        let storage = env::storage_usage() as i128 * env::storage_byte_cost().as_yoctonear() as i128;
        balance - storage - self.liabilities() as i128
    }

    /// ERR_STORAGE if contract-paid storage would start eating agent deposits.
    pub(crate) fn assert_solvent(&self) {
        let h = self.headroom();
        check(
            h >= SOLVENCY_RESERVE as i128,
            "ERR_STORAGE",
            &format!(
                "contract storage would eat agent deposits (headroom {} < reserve {}); owner must top up",
                h, SOLVENCY_RESERVE
            ),
        );
    }

    fn dup_key(root_job_id: JobId, result_hash: &str) -> Vec<u8> {
        let mut k = KEY_DUP_PREFIX.to_vec();
        k.extend_from_slice(&root_job_id.to_be_bytes());
        k.extend_from_slice(result_hash.as_bytes());
        k
    }

    pub(crate) fn set_finding_dedup_key(&mut self, finding_id: FindingId, key: &str) {
        let mut k = KEY_FINDING_DEDUP.to_vec();
        k.extend_from_slice(&finding_id.to_be_bytes());
        env::storage_write(&k, key.as_bytes());
    }

    pub(crate) fn finding_dedup_key(&self, finding_id: FindingId) -> Option<String> {
        let mut k = KEY_FINDING_DEDUP.to_vec();
        k.extend_from_slice(&finding_id.to_be_bytes());
        env::storage_read(&k).and_then(|b| String::from_utf8(b).ok())
    }

    /// Records `marker` ("k:<dedup_key>" or "h:<result_hash>") for this root job; true if already recorded.
    pub(crate) fn seen_result(&mut self, root_job_id: JobId, result_hash: &str) -> bool {
        let k = Self::dup_key(root_job_id, result_hash);
        if env::storage_has_key(&k) {
            return true;
        }
        env::storage_write(&k, &[1]);
        false
    }
}

#[near]
impl Contract {
    /// Conservation/solvency check for dashboards and e2e.
    pub fn get_solvency(&self) -> SolvencyView {
        let balance = env::account_balance().as_yoctonear();
        let storage_cost = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        let liab = self.liabilities();
        let h = balance as i128 - storage_cost as i128 - liab as i128;
        SolvencyView {
            balance: U128(balance),
            storage_usage: env::storage_usage(),
            storage_cost: U128(storage_cost),
            compute_liabilities: U128(liab),
            reserve: U128(SOLVENCY_RESERVE),
            headroom: h.to_string(),
            solvent: h >= SOLVENCY_RESERVE as i128,
        }
    }

    /// Owner only: recompute Σ compute over registered agents + `extra_accounts` (non-agent depositors).
    pub fn resync_compute_liabilities(&mut self, extra_accounts: Vec<AccountId>) -> U128 {
        self.assert_owner();
        let mut total = self.liabilities_scan();
        let mut seen: Vec<AccountId> = vec![];
        for a in extra_accounts {
            if self.agents.get(&a).is_none() && !seen.contains(&a) {
                total += self.balances.get(&a).map(|b| b.compute.0).unwrap_or(0);
                seen.push(a);
            }
        }
        self.set_liabilities(total);
        U128(total)
    }
}

// ------------------------------------------------------------- locks (C1, C2)

/// `target_id` → u64 ms: the target is immutable until then (max deadline of jobs on it).
const KEY_TARGET_LOCK: &[u8] = b"rt:tl:";
/// `account_id` → u64 ms: the agent's x25519 pubkey is frozen until then (client/lead of active jobs).
const KEY_PUBKEY_LOCK: &[u8] = b"rt:kl:";

/// X25519 small-order points (libsodium blocklist), compared with the top bit of byte 31 cleared.
const SMALL_ORDER_POINTS: [&str; 7] = [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0100000000000000000000000000000000000000000000000000000000000000",
    "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
    "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
];

pub(crate) fn is_small_order_x25519(hex_key: &str) -> bool {
    let k = hex_key.to_ascii_lowercase();
    if k.len() != 64 {
        return true;
    }
    // clear the top bit of the last byte (non-canonical encodings of the same points)
    let last = u8::from_str_radix(&k[62..64], 16).unwrap_or(0) & 0x7f;
    let norm = format!("{}{:02x}", &k[..62], last);
    SMALL_ORDER_POINTS.contains(&norm.as_str())
}

fn read_u64(key: &[u8]) -> Option<u64> {
    env::storage_read(key).and_then(|b| b.try_into().ok().map(u64::from_le_bytes))
}

fn raise_u64(key: &[u8], until: u64) {
    if read_u64(key).map(|cur| cur < until).unwrap_or(true) {
        env::storage_write(key, &until.to_le_bytes());
    }
}

impl Contract {
    fn target_lock_key(target_id: &str) -> Vec<u8> {
        [KEY_TARGET_LOCK, target_id.as_bytes()].concat()
    }

    fn pubkey_lock_key(account: &AccountId) -> Vec<u8> {
        [KEY_PUBKEY_LOCK, account.as_bytes()].concat()
    }

    /// Called at create_job / create_subjob.
    pub(crate) fn lock_target_until(&mut self, target_id: &str, until_ms: u64) {
        raise_u64(&Self::target_lock_key(target_id), until_ms);
    }

    pub(crate) fn lock_pubkey_until(&mut self, account: &AccountId, until_ms: u64) {
        raise_u64(&Self::pubkey_lock_key(account), until_ms);
    }

    /// ms until which `target_id` is immutable. For targets without a recorded lock
    /// (jobs created before this upgrade) falls back to scanning active jobs.
    pub(crate) fn target_locked_until(&self, target_id: &str) -> u64 {
        if let Some(v) = read_u64(&Self::target_lock_key(target_id)) {
            return v;
        }
        self.jobs
            .iter()
            .filter(|j| j.is_active() && j.target_id == target_id)
            .map(|j| j.deadline_ms)
            .max()
            .unwrap_or(0)
    }

    pub(crate) fn pubkey_locked_until(&self, account: &AccountId) -> u64 {
        read_u64(&Self::pubkey_lock_key(account)).unwrap_or(0)
    }
}

// ------------------------------------------------------- OutLayer infra refunds

/// `finding_id` → u128 LE: the OutLayer fee actually paid at submission.
const KEY_FINDING_FEE: &[u8] = b"rt:ff:";

/// outlayer.testnet pricing (`get_pricing`, 2026-11-13): base fee, per 1M instructions, per ms of
/// execution, per ms of compilation. Hard caps from `get_max_limits` are used when a limit is unset.
pub const OUTLAYER_BASE_FEE: u128 = 1_000_000_000_000_000_000_000; // 0.001 NEAR
pub const OUTLAYER_PER_MILLION_INSTR: u128 = 100_000_000_000_000;
pub const OUTLAYER_PER_MS: u128 = 100_000_000_000_000_000;
pub const OUTLAYER_PER_COMPILE_MS: u128 = 100_000_000_000_000_000;
/// Compile allowance for a fresh (pre-built WasmUrl) module (~1 s observed; 2 s budgeted).
pub const OUTLAYER_COMPILE_ALLOWANCE_MS: u128 = 2_000;
pub const OUTLAYER_MAX_INSTRUCTIONS: u128 = 500_000_000_000;
pub const OUTLAYER_MAX_SECONDS: u128 = 180;

impl Contract {
    /// Worst-case OutLayer charge for one run under the configured resource limits, rounded UP to
    /// the next 0.001 NEAR as a margin for pricing drift. With the default limits (1e10 instr, 90 s):
    /// 0.010201 → 0.011 NEAR kept, so the refund of a 0.02 fee is exactly 0.009 NEAR.
    pub(crate) fn outlayer_max_charge(&self) -> u128 {
        let raw = self.outlayer_worst_case_charge();
        raw.div_ceil(OUTLAYER_BASE_FEE) * OUTLAYER_BASE_FEE
    }

    fn outlayer_worst_case_charge(&self) -> u128 {
        let rl: Value = serde_json::from_str(&self.resource_limits).unwrap_or(Value::Null);
        let instr = rl["max_instructions"].as_u64().map(|v| v as u128).unwrap_or(OUTLAYER_MAX_INSTRUCTIONS);
        let secs = rl["max_execution_seconds"].as_u64().map(|v| v as u128).unwrap_or(OUTLAYER_MAX_SECONDS);
        OUTLAYER_BASE_FEE
            + instr.div_ceil(1_000_000) * OUTLAYER_PER_MILLION_INSTR
            + secs * 1_000 * OUTLAYER_PER_MS
            + OUTLAYER_COMPILE_ALLOWANCE_MS * OUTLAYER_PER_COMPILE_MS
    }

    pub(crate) fn set_finding_fee(&mut self, finding_id: FindingId, fee: u128) {
        let k = [KEY_FINDING_FEE, &finding_id.to_be_bytes()[..]].concat();
        env::storage_write(&k, &fee.to_le_bytes());
    }

    /// Fee paid for this finding (falls back to the current policy fee for pre-upgrade findings).
    pub(crate) fn finding_fee(&self, finding_id: FindingId) -> u128 {
        let k = [KEY_FINDING_FEE, &finding_id.to_be_bytes()[..]].concat();
        env::storage_read(&k)
            .and_then(|b| b.try_into().ok().map(u128::from_le_bytes))
            .unwrap_or(self.policy.outlayer_fee.0)
    }

    /// Part of the fee returned when OutLayer produced nothing (queue/yield timeout, worker failure):
    /// paid fee − worst-case OutLayer charge, so the contract is never out of pocket.
    pub(crate) fn infra_refund(&self, finding_id: FindingId) -> u128 {
        self.finding_fee(finding_id).saturating_sub(self.outlayer_max_charge())
    }
}
