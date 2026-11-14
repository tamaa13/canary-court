//! ECIES as fixed in ARCHITECTURE §5 (byte-compatible with agents/ TS):
//!
//! blob = 0x01 || eph_pub(32) || nonce(12) || ciphertext || tag(16)
//! key  = HKDF-SHA256(ikm = X25519(eph_sk, recipient_pk), salt = empty,
//!                    info = "near-redteam-v1", L = 32)
//! AEAD = ChaCha20-Poly1305 (IETF, 12-byte nonce), AAD = empty
//! Wire: standard base64 with padding; public keys as 64 lowercase hex chars.

use chacha20poly1305::aead::Aead;
use chacha20poly1305::{ChaCha20Poly1305, Key, KeyInit, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

pub const VERSION: u8 = 0x01;
pub const INFO: &[u8] = b"near-redteam-v1";
const HEADER: usize = 1 + 32 + 12;
const TAG: usize = 16;

#[derive(Debug, PartialEq, Eq)]
pub enum EciesError {
    TooShort,
    BadVersion,
    WeakKey,
    Aead,
}

fn derive_key(shared: &[u8; 32]) -> Result<[u8; 32], EciesError> {
    // Reject the all-zero shared secret (low-order / identity public keys).
    if shared.iter().all(|b| *b == 0) {
        return Err(EciesError::WeakKey);
    }
    let hk = Hkdf::<Sha256>::new(None, shared); // salt = empty (= 32 zero bytes, RFC 5869)
    let mut okm = [0u8; 32];
    hk.expand(INFO, &mut okm).map_err(|_| EciesError::WeakKey)?;
    Ok(okm)
}

pub fn public_from_secret(sk: &[u8; 32]) -> [u8; 32] {
    let s = StaticSecret::from(*sk);
    PublicKey::from(&s).to_bytes()
}

/// Deterministic encrypt (explicit ephemeral secret + nonce): used by tests and
/// by `encrypt` after drawing randomness.
pub fn encrypt_with(
    recipient_pk: &[u8; 32],
    eph_sk: &[u8; 32],
    nonce: &[u8; 12],
    plaintext: &[u8],
) -> Result<Vec<u8>, EciesError> {
    let eph = StaticSecret::from(*eph_sk);
    let eph_pub = PublicKey::from(&eph);
    let mut shared = eph.diffie_hellman(&PublicKey::from(*recipient_pk)).to_bytes();
    let mut key = derive_key(&shared)?;
    shared.zeroize();
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key));
    key.zeroize();
    let ct = cipher
        .encrypt(Nonce::from_slice(nonce), plaintext)
        .map_err(|_| EciesError::Aead)?;
    let mut out = Vec::with_capacity(HEADER + ct.len());
    out.push(VERSION);
    out.extend_from_slice(eph_pub.as_bytes());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

#[cfg(target_arch = "wasm32")]
fn fill_random(buf: &mut [u8]) -> Result<(), EciesError> {
    // wasi:random/random (CSPRNG provided by the host, inside the TEE)
    let v = wasi::random::random::get_random_bytes(buf.len() as u64);
    if v.len() != buf.len() {
        return Err(EciesError::Aead);
    }
    buf.copy_from_slice(&v);
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
fn fill_random(buf: &mut [u8]) -> Result<(), EciesError> {
    getrandom::fill(buf).map_err(|_| EciesError::Aead)
}

pub fn encrypt(recipient_pk: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, EciesError> {
    let mut rnd = [0u8; 44];
    fill_random(&mut rnd)?;
    let mut eph_sk = [0u8; 32];
    eph_sk.copy_from_slice(&rnd[..32]);
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&rnd[32..]);
    let r = encrypt_with(recipient_pk, &eph_sk, &nonce, plaintext);
    eph_sk.zeroize();
    rnd.zeroize();
    r
}

pub fn decrypt(recipient_sk: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, EciesError> {
    if blob.len() < HEADER + TAG {
        return Err(EciesError::TooShort);
    }
    if blob[0] != VERSION {
        return Err(EciesError::BadVersion);
    }
    let mut eph_pub = [0u8; 32];
    eph_pub.copy_from_slice(&blob[1..33]);
    let nonce = &blob[33..45];
    let sk = StaticSecret::from(*recipient_sk);
    let mut shared = sk.diffie_hellman(&PublicKey::from(eph_pub)).to_bytes();
    let mut key = derive_key(&shared)?;
    shared.zeroize();
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key));
    key.zeroize();
    cipher
        .decrypt(Nonce::from_slice(nonce), &blob[HEADER..])
        .map_err(|_| EciesError::Aead)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h32(s: &str) -> [u8; 32] {
        hex::decode(s).unwrap().try_into().unwrap()
    }

    #[test]
    fn agents_short_vector() {
        // agents/test/vectors/ecies.json "short" (verified by rt-agents against node:crypto)
        let rsk = [0x11u8; 32];
        let esk = [0x22u8; 32];
        let nonce = [0x33u8; 12];
        let pt = br#"{"payload":"hello","category":"prompt_injection"}"#;
        assert_eq!(
            hex::encode(public_from_secret(&rsk)),
            "7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13"
        );
        let blob = encrypt_with(&public_from_secret(&rsk), &esk, &nonce, pt).unwrap();
        assert_eq!(hex::encode(&blob), "010faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f203333333333333333333333338716e280a01a8a50e88e0c7c01f8cad4d4e70f9fe953ec5ed2678372cf180d83e4408de086adc4dacfdbbacc33f87fdcfd3c7f4efc38ed4beb9870749c3496cb51");
        assert_eq!(decrypt(&rsk, &blob).unwrap(), pt);
    }

    #[test]
    fn roundtrip_random_and_tamper() {
        let rsk = h32("0101010101010101010101010101010101010101010101010101010101010101");
        let pk = public_from_secret(&rsk);
        let blob = encrypt(&pk, b"secret").unwrap();
        assert_eq!(decrypt(&rsk, &blob).unwrap(), b"secret");
        let mut bad = blob.clone();
        let n = bad.len();
        bad[n - 1] ^= 1;
        assert_eq!(decrypt(&rsk, &bad), Err(EciesError::Aead));
        assert_eq!(decrypt(&rsk, &blob[..20]), Err(EciesError::TooShort));
        let mut v2 = blob.clone();
        v2[0] = 2;
        assert_eq!(decrypt(&rsk, &v2), Err(EciesError::BadVersion));
    }

    #[test]
    fn rejects_low_order_point() {
        // eph_pub = 0 → shared secret all-zero
        let rsk = [0x11u8; 32];
        let mut blob = vec![1u8];
        blob.extend_from_slice(&[0u8; 32]);
        blob.extend_from_slice(&[0u8; 12]);
        blob.extend_from_slice(&[0u8; 32]);
        assert_eq!(decrypt(&rsk, &blob), Err(EciesError::WeakKey));
    }
}
