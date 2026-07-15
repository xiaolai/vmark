//! WI-P6.3 / Sec review P6 — the cross-origin credential-release guard.
//!
//! `ensure_same_origin` is the fix for the Critical/High finding: a saved session
//! must be replayed ONLY into a page whose committed origin canonically equals the
//! origin it was saved from — never written cross-origin.

use super::*;
use crate::browser::session_state::{OriginStorage, StorageState};

fn state_for(origin: &str) -> StorageState {
    StorageState {
        cookies: Vec::new(),
        origins: vec![OriginStorage {
            origin: origin.into(),
            items: vec![("authToken".into(), "SECRET".into())],
        }],
    }
}

#[test]
fn same_origin_is_allowed_including_path_and_port_differences() {
    // The stored origin was recorded from a full committed URL; a later visit to a
    // different PATH on the same origin still matches (origin = scheme+host+port).
    let saved = state_for("https://work.example/login");
    assert!(ensure_same_origin("https://work.example/dashboard", &saved).is_ok());
    // Explicit default port vs implicit is still the same origin.
    assert!(ensure_same_origin("https://work.example:443/", &saved).is_ok());
}

#[test]
fn a_different_origin_is_refused_no_cross_origin_write() {
    let saved = state_for("https://work.example/");
    // Different host — the attacker-page case.
    let err = ensure_same_origin("https://attacker.example/", &saved).unwrap_err();
    assert!(err.contains("ORIGIN_MISMATCH"), "{err}");
    // Different scheme (http vs https) is a different origin.
    assert!(ensure_same_origin("http://work.example/", &saved).is_err());
    // Different port is a different origin.
    assert!(ensure_same_origin("https://work.example:8443/", &saved).is_err());
}

#[test]
fn an_empty_blob_writes_nothing_and_is_trivially_allowed() {
    // No saved origins → nothing to write → no cross-origin risk.
    assert!(ensure_same_origin("https://anywhere.example/", &StorageState::default()).is_ok());
}

#[test]
fn a_non_canonical_committed_or_saved_origin_fails_closed() {
    // A committed URL that has no canonical origin is refused, not best-effort applied.
    assert!(ensure_same_origin("about:blank", &state_for("https://work.example/")).is_err());
    // A saved origin that will not canonicalize is refused.
    assert!(ensure_same_origin("https://work.example/", &state_for("not a url")).is_err());
}
