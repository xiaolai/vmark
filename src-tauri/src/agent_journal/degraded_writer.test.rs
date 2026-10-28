// WI-AL1.2 — crash and failure injection: a failed fsync or truncate-back poisons the shared writer (JOURNAL_DEGRADED) until reopen drops the torn tail
//! R5 — an ambiguous write failure (a failed fsync, or a failed truncate
//! back after a partial write) poisons the SHARED writer, not a document:
//! every controlled mutation on every document is then refused with
//! `JOURNAL_DEGRADED` until recovery (reopen). A failure while appending
//! the startup `uncommitted` records fails `open` as a whole.
//!
//! Edge cases: a document that never saw the failure is refused too; a
//! commit of an already prepared transaction is refused (no content
//! change), not silently queued; a capture is still kept in memory
//! (`journaled: no`), never lost; reopen recovers and replays exactly the
//! records that became durable.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{ReviewAction, ReviewItem, ReviewOp};
use crate::agent_journal::writer::{
    CommitRequest, Journaled, ObserveRequest, ReviewRequest, Writer, WriterConfig,
};

fn refused_everywhere(w: &Writer, docs: &[DocId]) {
    for &doc in docs {
        let err = w
            .prepare(prepare_req(
                doc,
                w.head(doc),
                &head_text(w, doc),
                ReviewOp::Review,
            ))
            .unwrap_err();
        assert_eq!(err.code(), "JOURNAL_DEGRADED", "prepare on {doc}");
        let review = ReviewRequest {
            doc,
            expected_head: w.head(doc),
            action: ReviewAction::Keep,
            items: vec![ReviewItem {
                hunk_id: crate::agent_journal::ids::HunkId("x".into()),
                expected_review_gen: 0,
            }],
        };
        assert_eq!(
            w.decide(review).unwrap_err().code(),
            "JOURNAL_DEGRADED",
            "decide on {doc}"
        );
    }
}

#[test]
fn a_failed_fsync_poisons_the_shared_writer_until_reopen() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let (a, b, c) = (DocId::new(), DocId::new(), DocId::new());
    human_save(&w, a, "a");
    human_save(&w, c, "c");
    let open_txn = w
        .prepare(prepare_req(c, w.head(c), "c", ReviewOp::Review))
        .unwrap();
    let before = w.journal_len();
    faults.fail_next_fsyncs(1);
    let err = w
        .prepare(prepare_req(b, None, "", ReviewOp::Review))
        .unwrap_err();
    assert_eq!(
        err.code(),
        "JOURNAL_IO",
        "the failing call itself sees the I/O error"
    );
    assert_eq!(
        w.journal_len(),
        before,
        "the unsynced bytes were truncated back"
    );
    refused_everywhere(&w, &[a, b, c]);
    let commit = CommitRequest {
        provenance: None,
        postimage: "c2".into(),
        resolves: None,
        effects: Default::default(),
    };
    assert_eq!(
        w.commit(open_txn.txn, commit).unwrap_err().code(),
        "JOURNAL_DEGRADED",
        "no content change while poisoned"
    );
    assert!(w.head(c).is_some() && head_text(&w, c) == "c");
    // A capture is not refused: the human's text is kept in memory.
    let obs = w
        .observe(ObserveRequest {
            doc: a,
            actor: human(),
            initiator: human(),
            postimage: "a2".into(),
            observed_parent: ObservedRef::Revision {
                revision: w.head(a).unwrap(),
            },
            provenance: None,
        })
        .unwrap();
    assert_eq!(obs.journaled, Journaled::No);
    assert!(
        !w.retry_degraded(a).unwrap(),
        "retry cannot drain a poisoned writer"
    );
    drop(w);
    // Recovery: reopen. The open transaction becomes uncommitted; new work is accepted.
    let (w, report) = Writer::open(
        config(
            dir.path(),
            crate::agent_journal::journal_file::SyncPolicy::Full,
        )
        .0,
    )
    .unwrap();
    assert_eq!(report.uncommitted, vec![open_txn.txn]);
    assert_eq!(
        w.snapshot().state.txns[&open_txn.txn].status,
        TxnStatus::Uncommitted
    );
    let p = w
        .prepare(prepare_req(b, None, "", ReviewOp::Review))
        .unwrap();
    w.abort(p.txn, "test").unwrap();
}

#[test]
fn a_failed_truncate_back_poisons_the_shared_writer_and_reopen_drops_the_torn_tail() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let (a, b) = (DocId::new(), DocId::new());
    human_save(&w, a, "a");
    // Close the epoch so reopen appends no `epochUnclosed` record (R24).
    w.close_epoch(a, w.epoch(a).unwrap()).unwrap();
    let before = w.journal_len();
    faults.tear_next_append_after(7);
    faults.fail_next_truncates(1);
    assert_eq!(
        w.prepare(prepare_req(b, None, "", ReviewOp::Review))
            .unwrap_err()
            .code(),
        "JOURNAL_IO"
    );
    refused_everywhere(&w, &[a, b]);
    drop(w);
    let (w, report) = Writer::open(
        config(
            dir.path(),
            crate::agent_journal::journal_file::SyncPolicy::Full,
        )
        .0,
    )
    .unwrap();
    assert_eq!(
        report.truncated_tail_bytes, 7,
        "the torn frame is truncated at reopen"
    );
    assert_eq!(w.journal_len(), before);
    assert!(w
        .snapshot()
        .state
        .txns
        .values()
        .all(|t| t.status != TxnStatus::Prepared));
    let p = w
        .prepare(prepare_req(b, None, "", ReviewOp::Review))
        .unwrap();
    w.abort(p.txn, "test").unwrap();
}

#[test]
fn a_clean_append_failure_does_not_poison() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    faults.fail_next_appends(1);
    assert_eq!(
        w.prepare(prepare_req(doc, None, "", ReviewOp::Review))
            .unwrap_err()
            .code(),
        "JOURNAL_IO"
    );
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap();
    w.abort(p.txn, "test").unwrap();
}

#[test]
fn a_startup_uncommitted_failure_fails_open_for_every_document() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let docs = [DocId::new(), DocId::new()];
    let txns: Vec<_> = docs
        .iter()
        .map(|&d| {
            w.prepare(prepare_req(d, None, "", ReviewOp::Review))
                .unwrap()
                .txn
        })
        .collect();
    drop(w); // crash with both open
    let (cfg, faults): (WriterConfig, _) = config(
        dir.path(),
        crate::agent_journal::journal_file::SyncPolicy::Full,
    );
    // Fail the SECOND startup append: the first document is already fine.
    let seen = Arc::new(AtomicU32::new(0));
    let (s, f) = (seen.clone(), faults.clone());
    faults.set_append_hook(Some(Arc::new(move |_| {
        if s.fetch_add(1, Ordering::SeqCst) == 1 {
            f.fail_next_appends(1);
        }
    })));
    let err = Writer::open(cfg)
        .err()
        .expect("open refuses rather than disabling one document");
    assert_eq!(err.code(), "JOURNAL_IO");
    assert_eq!(seen.load(Ordering::SeqCst), 2);
    let (w, report) = Writer::open(
        config(
            dir.path(),
            crate::agent_journal::journal_file::SyncPolicy::Full,
        )
        .0,
    )
    .unwrap();
    assert_eq!(
        report.uncommitted.len(),
        1,
        "the second open finishes the job; the one that landed is not repeated"
    );
    assert!(txns.contains(&report.uncommitted[0]));
    for t in txns {
        assert_eq!(w.snapshot().state.txns[&t].status, TxnStatus::Uncommitted);
    }
}
