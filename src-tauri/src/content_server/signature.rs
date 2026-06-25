//! Manifest signature verification (grill H2; ADR-2 "signed manifest").
//!
//! A SHA-256 alone only proves integrity against accidental corruption — a
//! compromised/MITM'd download host could ship a malicious tarball plus a
//! matching hash. This verifies a detached **ed25519 signature** over the
//! manifest bytes against a public key baked into the (codesigned) app, so the
//! downloader must trust authenticity, not just integrity, before extraction.
//!
//! Key management + the actual signing pipeline are release infrastructure
//! (external); this is the in-app verification primitive the grill flagged as
//! missing.

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Verify a base64 ed25519 `signature` over `manifest_bytes` against a base64
/// 32-byte public key. Returns false on any decode/length/verify failure
/// (fail-closed).
pub fn verify_manifest_signature(
    manifest_bytes: &[u8],
    signature_b64: &str,
    public_key_b64: &str,
) -> bool {
    let engine = base64::engine::general_purpose::STANDARD;
    let Ok(pk_bytes) = engine.decode(public_key_b64.trim()) else {
        return false;
    };
    let Ok(sig_bytes) = engine.decode(signature_b64.trim()) else {
        return false;
    };
    let Ok(pk_arr): Result<[u8; 32], _> = pk_bytes.try_into() else {
        return false;
    };
    let Ok(sig_arr): Result<[u8; 64], _> = sig_bytes.try_into() else {
        return false;
    };
    let Ok(vk) = VerifyingKey::from_bytes(&pk_arr) else {
        return false;
    };
    let sig = Signature::from_bytes(&sig_arr);
    vk.verify(manifest_bytes, &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use ed25519_dalek::{Signer, SigningKey};

    fn engine() -> base64::engine::general_purpose::GeneralPurpose {
        base64::engine::general_purpose::STANDARD
    }

    /// Deterministic test keypair from a fixed seed.
    fn test_keys() -> (SigningKey, String) {
        let seed = [7u8; 32];
        let sk = SigningKey::from_bytes(&seed);
        let pk_b64 = engine().encode(sk.verifying_key().to_bytes());
        (sk, pk_b64)
    }

    #[test]
    fn accepts_a_valid_signature() {
        let (sk, pk_b64) = test_keys();
        let manifest = br#"{"kind":"slidev","version":"52.16.0","sha256":"abc"}"#;
        let sig_b64 = engine().encode(sk.sign(manifest).to_bytes());
        assert!(verify_manifest_signature(manifest, &sig_b64, &pk_b64));
    }

    #[test]
    fn rejects_a_tampered_manifest() {
        let (sk, pk_b64) = test_keys();
        let manifest = br#"{"version":"good"}"#;
        let sig_b64 = engine().encode(sk.sign(manifest).to_bytes());
        // A different manifest with the same (now-wrong) signature must fail —
        // this is exactly the malicious-tarball-with-matching-sha256 case.
        assert!(!verify_manifest_signature(br#"{"version":"evil"}"#, &sig_b64, &pk_b64));
    }

    #[test]
    fn rejects_wrong_key() {
        let (sk, _) = test_keys();
        let other = SigningKey::from_bytes(&[9u8; 32]);
        let other_pk = engine().encode(other.verifying_key().to_bytes());
        let manifest = b"data";
        let sig_b64 = engine().encode(sk.sign(manifest).to_bytes());
        assert!(!verify_manifest_signature(manifest, &sig_b64, &other_pk));
    }

    #[test]
    fn fails_closed_on_garbage() {
        assert!(!verify_manifest_signature(b"x", "not-base64!!", "also-bad"));
        assert!(!verify_manifest_signature(b"x", "", ""));
    }
}
