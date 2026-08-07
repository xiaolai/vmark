// WI-3.1 — the coherence command boundary's error vocabulary.
//
// These pin the CODES, not the messages. Rule 50's whole point is that the
// frontend branches on `code`; a test that asserted message text would bless
// exactly the string-matching this module exists to kill.

use super::*;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Envelope, WriterId, FORMAT_VERSION};
use crate::command_error::ErrorCode;
use serde_json::json;

fn writer(n: u128) -> WriterId {
    WriterId(uuid::Uuid::from_u128(n))
}

/// Each classifier maps to exactly one code, and the choice is a claim about
/// what the CALLER should do next — not about how the message reads.
#[test]
fn each_classifier_maps_to_its_documented_code() {
    assert_eq!(
        workspace_unavailable("x".into()).code(),
        ErrorCode::Internal,
        "an unopenable workspace is environment state, not a bad argument"
    );
    assert_eq!(kernel_poisoned().code(), ErrorCode::Internal);
    assert_eq!(ledger_unavailable("x".into()).code(), ErrorCode::Internal);
    assert_eq!(
        rejected_argument("x".into()).code(),
        ErrorCode::InvalidInput,
        "retrying unchanged cannot succeed"
    );
    assert_eq!(
        state_conflict("x".into()).code(),
        ErrorCode::Conflict,
        "the same call may succeed once the state changes"
    );
    assert!(
        !ErrorCode::Conflict.is_retryable(),
        "Conflict is deliberately not retryable — the caller must refresh first"
    );
}

/// The one failure mode that is provably distinguishable without reading the
/// message: a write refused because this build could not read the whole ledger.
///
/// This must NOT come back as `invalid-input`. The two codes ask opposite
/// things of the user — "fix your request" versus "upgrade VMark" — and no
/// amount of rewording the request can clear a short read.
#[test]
fn a_write_refused_for_a_short_read_is_unsupported_not_invalid_input() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    kernel.ensure_initialized().unwrap();

    // An entry from a newer build: skipped on read, so the projection is short.
    let mut newer = Envelope::create(
        "diagnostic",
        writer(1),
        json!({"code":"t","message":"future"}),
    );
    newer.format = FORMAT_VERSION + 1;
    kernel.ledger().append(&newer).unwrap();

    // Drive the real refusal rather than setting the flag by hand: the cached
    // count is populated by the reconcile INSIDE with_write_lock, so this also
    // pins that ordering (classify would read a stale 0 if it did not).
    let refusal = kernel
        .with_write_lock(|_| Ok(()))
        .expect_err("a short read must refuse the write");

    assert_eq!(
        classify_write(&kernel, rejected_argument, refusal).code(),
        ErrorCode::Unsupported,
        "the remedy is upgrading VMark, so the code must not blame the input"
    );
}

/// With a fully-read ledger the classifier defers to whatever the call site
/// chose, so a genuine bad argument still reports as one.
#[test]
fn classify_write_defers_to_the_call_sites_fallback_on_a_complete_read() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    kernel.ensure_initialized().unwrap();
    kernel
        .with_write_lock(|_| Ok(()))
        .expect("a clean ledger writes");

    assert_eq!(
        kernel.short_read_entries(),
        0,
        "precondition: nothing skipped"
    );
    assert_eq!(
        classify_write(&kernel, rejected_argument, "bad edge id".into()).code(),
        ErrorCode::InvalidInput
    );
    assert_eq!(
        classify_write(&kernel, ledger_unavailable, "io".into()).code(),
        ErrorCode::Internal,
        "a read-shaped call site keeps its own fallback"
    );
}

/// Every classifier must carry an i18n key, not just a code.
///
/// The Phase-3 migration typed the CODES and left the MESSAGES as raw English
/// `format!` output, which `lint:i18n` cannot see — it does not read Rust
/// strings — so the gap stayed green indefinitely. This is the assertion that
/// makes a regression loud: a classifier that goes back to
/// `CommandError::internal(detail)` loses its `i18nKey` and fails here.
#[test]
fn every_classifier_carries_an_i18n_key() {
    let cases: Vec<(&str, CommandError)> = vec![
        ("workspace_unavailable", workspace_unavailable("x".into())),
        ("kernel_poisoned", kernel_poisoned()),
        ("ledger_unavailable", ledger_unavailable("x".into())),
        ("rejected_argument", rejected_argument("x".into())),
        ("state_conflict", state_conflict("x".into())),
    ];
    for (name, err) in &cases {
        let key = err
            .i18n_key()
            .unwrap_or_else(|| panic!("{name} has no i18nKey — its message is raw English"));
        assert!(
            key.starts_with("errors.coherence."),
            "{name} should use an errors.coherence.* key; got {key}"
        );
    }
}

/// The technical reason must survive localization.
///
/// Localizing the frame is only an improvement if it does not throw away the
/// specific cause — "the request was rejected" alone is less useful than what
/// it replaced. The `%{detail}` interpolation keeps the edge id / path / parser
/// message visible inside the translated sentence.
#[test]
fn the_specific_reason_survives_into_the_localized_message() {
    let err = rejected_argument("no such edge: abc#0".into());
    assert!(
        err.message().contains("no such edge: abc#0"),
        "the localized message must still carry the technical reason; got: {}",
        err.message()
    );
}
