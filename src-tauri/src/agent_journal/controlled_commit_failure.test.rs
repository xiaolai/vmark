// WI-AL1.3 — every way a controlled commit can fail after the window applied the text ends in a defined state without restart: an unrecordable commit appends `uncommitted` and releases the reservation, an append failure queues the record and drains, a poisoned writer queues the record and stops every controlled mutation until reopen
//! The window commits only after it applied the text, and it never retries
//! a refused commit. So a refused commit must not leave the transaction
//! `prepared` holding the document's reservation: that would refuse every
//! later write with `JOURNAL_BUSY` until the app restarts.

use super::controlled::{
    commit_controlled, decode_prepare, prepare_controlled, ControlledPrepared,
};
use super::degraded_drain::{drain, Backoff, DrainEnd};
use super::doc_registry::DocRegistry;
use super::test_support::*;
use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{ConnectionId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::writer::Writer;

fn mcp_actor() -> Actor {
    Actor::Mcp {
        principal: Principal::Provider {
            provider: "claude-code".into(),
        },
        connection_id: ConnectionId::new(),
        session_label: None,
        display_name: None,
    }
}

fn prepare(
    w: &Writer,
    docs: &DocRegistry,
    key: &str,
    preimage: &str,
) -> Result<ControlledPrepared, TxnError> {
    let parent = docs.resolve(key).ok().and_then(|d| w.head(d));
    let payload = serde_json::to_vec(&serde_json::json!({
        "docKey": key,
        "parent": parent,
        "preimage": preimage,
        "actor": mcp_actor(),
        "tool": "document.write",
    }))
    .unwrap();
    let req = decode_prepare(&payload)?;
    let doc = docs.resolve(&req.doc_key)?;
    prepare_controlled(w, doc, req)
}

fn commit_payload(postimage: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({ "postimage": postimage })).unwrap()
}

fn status(w: &Writer, txn: TxnId) -> TxnStatus {
    w.snapshot().state.txns[&txn].status.clone()
}

fn fast() -> Backoff {
    Backoff {
        first: std::time::Duration::from_millis(1),
        max: std::time::Duration::from_millis(4),
    }
}

/// The defined end of an unrecordable commit: `uncommitted` is durable, the
/// reservation is gone, the head did not move, and the next write on the
/// applied text goes ahead (recording that text as a baseline).
fn assert_released_as_uncommitted(
    w: &Writer,
    docs: &DocRegistry,
    key: &str,
    p: &ControlledPrepared,
    applied: &str,
) {
    assert_ended_uncommitted(w, p);
    let next = prepare(w, docs, key, applied).expect("the next write is not refused");
    assert!(
        next.baseline.is_some(),
        "the applied text is recorded as a baseline"
    );
}

fn assert_ended_uncommitted(w: &Writer, p: &ControlledPrepared) {
    assert_eq!(status(w, p.txn), TxnStatus::Uncommitted);
    assert!(
        w.reservation(p.doc).is_none(),
        "the reservation is released"
    );
    assert!(!w.is_degraded(p.doc), "the uncommitted record landed");
    assert_ne!(w.head(p.doc), Some(p.revision), "no commit is invented");
}

#[test]
fn a_lone_surrogate_in_the_postimage_is_invalid_text_and_ends_uncommitted() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    let err = commit_controlled(&w, p.txn, br#"{"postimage":"\udfff"}"#).unwrap_err();
    assert_eq!(err.code(), "INVALID_TEXT");
    assert_released_as_uncommitted(&w, &docs, "k", &p, "applied");
}

#[test]
fn a_malformed_commit_payload_is_invalid_request_and_ends_uncommitted() {
    for bad in [
        &b"not json"[..],
        br#"{"postimage":"x","extra":1}"#,
        br#"{}"#,
    ] {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let docs = DocRegistry::default();
        let p = prepare(&w, &docs, "k", "").unwrap();
        let err = commit_controlled(&w, p.txn, bad).unwrap_err();
        assert_eq!(err.code(), "INVALID_REQUEST");
        assert_released_as_uncommitted(&w, &docs, "k", &p, "applied");
    }
}

#[test]
fn a_writer_poisoned_between_prepare_and_commit_queues_uncommitted_until_reopen() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let docs = DocRegistry::default();
    let a = prepare(&w, &docs, "a", "").unwrap();
    let b = prepare(&w, &docs, "b", "").unwrap();
    // B's commit append is synced ambiguously: the shared writer is poisoned.
    faults.fail_next_fsyncs(1);
    assert!(
        !commit_controlled(&w, b.txn, &commit_payload("b"))
            .unwrap()
            .durable
    );
    assert!(w.health().is_err());
    let err = commit_controlled(&w, a.txn, &commit_payload("a")).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_DEGRADED");
    assert!(
        w.is_degraded(a.doc),
        "the uncommitted record waits in the queue"
    );
    assert!(matches!(
        drain(&w, a.doc, fast(), |_| {}),
        DrainEnd::WriterStopped(_)
    ));
    assert_eq!(
        prepare(&w, &docs, "c", "").unwrap_err().code(),
        "JOURNAL_DEGRADED"
    );
    drop(w);
    let (cfg, _) = config(
        dir.path(),
        crate::agent_journal::journal_file::SyncPolicy::Full,
    );
    let (w, report) = Writer::open(cfg).unwrap();
    assert!(
        report.uncommitted.contains(&a.txn),
        "reopen resolves it as uncommitted"
    );
    assert_eq!(status(&w, a.txn), TxnStatus::Uncommitted);
    assert!(w.reservation(a.doc).is_none());
}

#[test]
fn a_second_commit_of_a_committed_transaction_is_refused_and_changes_nothing() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    assert!(
        commit_controlled(&w, p.txn, &commit_payload("one"))
            .unwrap()
            .durable
    );
    let generation = w.generation();
    let err = commit_controlled(&w, p.txn, &commit_payload("two")).unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST");
    assert_eq!(w.generation(), generation, "nothing appended");
    assert_eq!(status(&w, p.txn), TxnStatus::Committed);
    assert_eq!(head_text(&w, p.doc), "one");
}

#[test]
fn a_second_commit_while_the_first_is_queued_does_not_queue_another_record() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    faults.fail_next_appends(1);
    assert!(
        !commit_controlled(&w, p.txn, &commit_payload("one"))
            .unwrap()
            .durable
    );
    let err = commit_controlled(&w, p.txn, &commit_payload("two")).unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST");
    assert_eq!(drain(&w, p.doc, fast(), |_| {}), DrainEnd::Drained);
    assert_eq!(status(&w, p.txn), TxnStatus::Committed);
    assert_eq!(head_text(&w, p.doc), "one");
    assert!(w.reservation(p.doc).is_none());
}
