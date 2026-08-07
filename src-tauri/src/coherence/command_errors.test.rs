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
