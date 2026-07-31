//! Tests for the cross-window live-reference aggregation (WI-9).
//!
//! The window/emit half needs an AppHandle; these cover the state machinery —
//! which is where fail-closed either holds or does not.

use super::*;

#[tokio::test]
async fn zero_targets_is_complete_and_empty() {
    let rx = register_request("req-zero", 0);
    // Completed immediately — the receiver already holds the signal.
    rx.await.expect("completed");
    let (complete, refs) = take_result("req-zero");
    assert!(complete);
    assert!(refs.is_empty());
}

#[tokio::test]
async fn all_answers_completes_with_the_union() {
    let rx = register_request("req-two", 2);
    assert!(!apply_response("req-two", vec!["a.png".into()]));
    assert!(apply_response(
        "req-two",
        vec!["b.png".into(), "c.png".into()]
    ));
    rx.await.expect("completed");
    let (complete, refs) = take_result("req-two");
    assert!(complete);
    assert_eq!(refs, vec!["a.png", "b.png", "c.png"]);
}

#[tokio::test]
async fn a_missing_answer_reports_incomplete() {
    let _rx = register_request("req-partial", 2);
    apply_response("req-partial", vec!["a.png".into()]);
    // The second window never answers; the requester times out and takes.
    let (complete, refs) = take_result("req-partial");
    assert!(!complete, "one unanswered window must mean incomplete");
    // Partial refs still travel — they can only PROTECT more.
    assert_eq!(refs, vec!["a.png"]);
}

#[tokio::test]
async fn a_late_answer_after_take_is_ignored() {
    let _rx = register_request("req-late", 1);
    let (complete, _) = take_result("req-late");
    assert!(!complete);
    // The window finally answers after the deadline — nothing to poison.
    assert!(!apply_response("req-late", vec!["late.png".into()]));
}

#[tokio::test]
async fn unknown_request_is_ignored() {
    assert!(!apply_response("never-registered", vec!["x.png".into()]));
    let (complete, refs) = take_result("never-registered");
    assert!(!complete);
    assert!(refs.is_empty());
}

#[tokio::test]
async fn extra_answers_do_not_underflow() {
    let _rx = register_request("req-extra", 1);
    assert!(apply_response("req-extra", vec!["a.png".into()]));
    // A duplicate answer (double listener) must not panic or corrupt.
    assert!(apply_response("req-extra", vec!["a.png".into()]));
    let (complete, _) = take_result("req-extra");
    assert!(complete);
}
