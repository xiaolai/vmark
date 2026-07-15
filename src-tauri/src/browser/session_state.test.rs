//! WI-P6.2/P6.6 — storage-state persistence + secret-hygiene tests.
//!
//! Exercised against the keyring crate's in-memory `mock` store so tests never
//! touch the real OS keychain. Like `secure_store`, the round-trip tests drive the
//! `*_on(&Entry)` core against a SINGLE mock entry (each `Entry::new` under the mock
//! owns its own credential, so a fresh entry per call would never observe a prior
//! write); the public `persist`/`load`/`forget` are tested for handle validation.

use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Once;

static INIT: Once = Once::new();
fn init_mock() {
    INIT.call_once(|| {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
    });
}
fn mock_entry(suffix: &str) -> Entry {
    init_mock();
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    Entry::new(SERVICE, &format!("test.{suffix}.{n}")).unwrap()
}

fn sample() -> StorageState {
    StorageState {
        cookies: vec![StoredCookie {
            name: "session".into(),
            value: "SUPER-SECRET-TOKEN".into(),
            domain: "example.com".into(),
            path: "/".into(),
            secure: true,
            http_only: true,
            expires: Some(1_800_000_000.0),
        }],
        origins: vec![OriginStorage {
            origin: "https://example.com".into(),
            items: vec![("auth".into(), "ANOTHER-SECRET".into())],
        }],
    }
}

#[test]
fn persist_then_load_roundtrips_every_field() {
    let e = mock_entry("roundtrip");
    let state = sample();
    persist_on(&e, &state).unwrap();
    // The replay path needs the EXACT values back — nothing is lost or redacted at rest.
    assert_eq!(load_on(&e).unwrap(), Some(state));
}

#[test]
fn load_unknown_handle_is_none_not_error() {
    let e = mock_entry("missing");
    assert_eq!(load_on(&e).unwrap(), None);
}

#[test]
fn persist_overwrites_a_prior_blob() {
    let e = mock_entry("overwrite");
    persist_on(&e, &sample()).unwrap();
    persist_on(&e, &StorageState::default()).unwrap();
    assert_eq!(load_on(&e).unwrap(), Some(StorageState::default()));
}

#[test]
fn forget_removes_the_blob_and_is_idempotent() {
    let e = mock_entry("forget");
    persist_on(&e, &sample()).unwrap();
    forget_on(&e).unwrap();
    assert_eq!(load_on(&e).unwrap(), None);
    // Forgetting a missing blob succeeds (idempotent).
    forget_on(&e).unwrap();
}

#[test]
fn redacted_summary_leaks_no_value_or_name() {
    // The ONLY view of a blob allowed past this layer must carry counts, not secrets.
    let summary = sample().redacted_summary();
    assert!(
        !summary.contains("SUPER-SECRET-TOKEN"),
        "cookie value leaked: {summary}"
    );
    assert!(
        !summary.contains("ANOTHER-SECRET"),
        "localStorage value leaked: {summary}"
    );
    assert!(
        !summary.contains("session"),
        "cookie name leaked: {summary}"
    );
    assert!(
        !summary.contains("auth"),
        "localStorage key leaked: {summary}"
    );
    assert!(!summary.contains("example.com"), "origin leaked: {summary}");
    // It still says something useful — the counts.
    assert!(
        summary.contains('1'),
        "summary should report the counts: {summary}"
    );
}

#[test]
fn empty_or_oversized_or_bad_charset_handles_are_rejected_before_keychain() {
    // Validation happens before any keychain touch, so these fail on the PUBLIC api.
    assert!(persist("", &StorageState::default()).is_err());
    assert!(load("").is_err());
    assert!(forget("").is_err());
    assert!(load(&"a".repeat(129)).is_err());
    for bad in ["../etc", "has space", "sql'inject", "new\nline", "emoji🔑"] {
        assert!(load(bad).is_err(), "handle {bad:?} must be rejected");
    }
    // A well-formed handle passes validation (load returns None under the real store
    // path only if nothing is stored; here we only assert it is NOT a validation error).
    for ok in ["profile-1", "work_login", "a.b.c", "AZ09"] {
        assert!(validate_handle(ok).is_ok(), "handle {ok:?} should be valid");
    }
}
