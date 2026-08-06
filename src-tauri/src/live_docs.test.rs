//! Tests for the cross-window live-reference aggregation (WI-9).
//!
//! The window/emit half needs an AppHandle; these cover the state machinery —
//! which is where fail-closed either holds or does not. Answers are counted by
//! DISTINCT EXPECTED LABEL because `window.emit` broadcasts in Tauri v2: the
//! requester's own responder echoes every request, and without labels that
//! echo completed the count while the window that mattered stayed silent.

use super::*;
use std::collections::HashSet;

fn labels(names: &[&str]) -> HashSet<String> {
    names.iter().map(|s| s.to_string()).collect()
}

#[tokio::test]
async fn zero_targets_is_complete_and_empty() {
    let rx = register_request("req-zero", labels(&[]));
    rx.await.expect("completed");
    let (complete, refs) = take_result("req-zero");
    assert!(complete);
    assert!(refs.is_empty());
}

#[tokio::test]
async fn all_labels_answering_completes_with_the_union() {
    let rx = register_request("req-two", labels(&["main", "doc-1"]));
    assert!(!apply_response("req-two", "main", vec!["a.png".into()]));
    assert!(apply_response(
        "req-two",
        "doc-1",
        vec!["b.png".into(), "c.png".into()]
    ));
    rx.await.expect("completed");
    let (complete, refs) = take_result("req-two");
    assert!(complete);
    assert_eq!(refs, vec!["a.png", "b.png", "c.png"]);
}

#[tokio::test]
async fn a_missing_label_reports_incomplete() {
    let _rx = register_request("req-partial", labels(&["main", "doc-1"]));
    apply_response("req-partial", "main", vec!["a.png".into()]);
    let (complete, refs) = take_result("req-partial");
    assert!(!complete, "one unanswered window must mean incomplete");
    // Partial refs still travel — they can only PROTECT more.
    assert_eq!(refs, vec!["a.png"]);
}

#[tokio::test]
async fn the_requesters_own_echo_does_not_count() {
    // THE broadcast bug: window.emit reaches every window, so the requester
    // answers its own request. That echo must not complete the collection.
    let _rx = register_request("req-echo", labels(&["doc-1"]));
    assert!(!apply_response(
        "req-echo",
        "main", // the REQUESTER — not in the expected set
        vec!["own.png".into()]
    ));
    let (complete, refs) = take_result("req-echo");
    assert!(!complete, "an unexpected label must not stand in for doc-1");
    assert!(refs.is_empty(), "unexpected answers contribute nothing");
}

#[tokio::test]
async fn a_duplicate_answer_from_one_window_counts_once() {
    // React Strict Mode can register two listeners in one window.
    let _rx = register_request("req-dup", labels(&["doc-1", "doc-2"]));
    assert!(!apply_response("req-dup", "doc-1", vec!["a.png".into()]));
    assert!(!apply_response("req-dup", "doc-1", vec!["a.png".into()]));
    let (complete, _) = take_result("req-dup");
    assert!(!complete, "doc-1 twice must not stand in for doc-2");
}

#[tokio::test]
async fn a_late_answer_after_take_is_ignored() {
    let _rx = register_request("req-late", labels(&["doc-1"]));
    let (complete, _) = take_result("req-late");
    assert!(!complete);
    assert!(!apply_response(
        "req-late",
        "doc-1",
        vec!["late.png".into()]
    ));
}

#[tokio::test]
async fn unknown_request_is_ignored() {
    assert!(!apply_response(
        "never-registered",
        "doc-1",
        vec!["x.png".into()]
    ));
    let (complete, refs) = take_result("never-registered");
    assert!(!complete);
    assert!(refs.is_empty());
}
