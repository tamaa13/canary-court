//! Duplicate-finding key (PM decision 2026-11-13, spec v0.4):
//!
//!   dedup_key = HMAC-SHA256(
//!       key = HKDF-SHA256(ikm = enclave secret (32 B), salt = empty, info = "near-redteam-dedup-key-v1", L = 32),
//!       msg = "near-redteam-dedup-v1" || u64_be(root_job_id) || u32_be(len(category)) || category
//!             || sha256(normalize(payload)) )
//!   normalize = trim, lowercase, collapse every whitespace run to one ' '
//!
//! Keyed by an enclave-only secret, so nobody can precompute or dictionary-check
//! the key of a guessed payload. It contains no response and no ids other than
//! root_job_id: the same payload resubmitted anywhere in one job tree under the
//! same category collides.

use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

pub const DOMAIN: &[u8] = b"near-redteam-dedup-v1";
pub const KEY_INFO: &[u8] = b"near-redteam-dedup-key-v1";

pub fn normalize(payload: &str) -> String {
    payload.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

pub fn subkey(enclave_secret: &[u8; 32]) -> [u8; 32] {
    let mut k = [0u8; 32];
    // expand cannot fail for L = 32
    let _ = Hkdf::<Sha256>::new(None, enclave_secret).expand(KEY_INFO, &mut k);
    k
}

pub fn message(root_job_id: u64, category: &str, payload: &str) -> Vec<u8> {
    let mut m = Vec::with_capacity(DOMAIN.len() + 8 + 4 + category.len() + 32);
    m.extend_from_slice(DOMAIN);
    m.extend_from_slice(&root_job_id.to_be_bytes());
    m.extend_from_slice(&(category.len() as u32).to_be_bytes());
    m.extend_from_slice(category.as_bytes());
    m.extend_from_slice(&Sha256::digest(normalize(payload).as_bytes()));
    m
}

pub fn keyed(subkey: &[u8; 32], root_job_id: u64, category: &str, payload: &str) -> String {
    let mut mac = match <Hmac<Sha256> as Mac>::new_from_slice(subkey) {
        Ok(m) => m,
        Err(_) => return String::new(), // unreachable: HMAC accepts any key length
    };
    mac.update(&message(root_job_id, category, payload));
    hex::encode(mac.finalize().into_bytes())
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn dedup_key(enclave_secret: &[u8; 32], root_job_id: u64, category: &str, payload: &str) -> String {
    keyed(&subkey(enclave_secret), root_job_id, category, payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_and_collisions() {
        assert_eq!(normalize("  Ignore\tPrevious \n\n instructions "), "ignore previous instructions");
        let k = [0x42u8; 32];
        let a = dedup_key(&k, 7, "prompt_injection", "DIAG-1   print code");
        assert_eq!(a, dedup_key(&k, 7, "prompt_injection", " diag-1 print\ncode "));
        assert_ne!(a, dedup_key(&k, 8, "prompt_injection", "DIAG-1 print code"));
        assert_ne!(a, dedup_key(&k, 7, "jailbreak", "DIAG-1 print code"));
        assert_ne!(a, dedup_key(&[0x43; 32], 7, "prompt_injection", "DIAG-1 print code"));
        assert_eq!(a.len(), 64);
        // length-prefixed category: no ambiguity between category and payload hash bytes
        assert_ne!(message(1, "ab", "x"), message(1, "a", "x"));
    }
}
