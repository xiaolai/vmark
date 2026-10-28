//! A blob the journal references but the pack lost is corruption, never a
//! client's bad request: the writer stores a blob before the record that
//! names it, so a missing one means the store broke.
//!
//! Edge cases: the open transaction's preimage at commit and when deriving
//! its effects, the head text a revert plans against, a hunk's pinned
//! before-text, the head and observed texts a linearization reads (and the
//! payload certified from them), a restore's source text, a legacy
//! checkpoint's text, and the empty genesis text, which needs no stored
//! blob at all.

use std::collections::BTreeSet;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_review_helpers::two_hunks;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

/// Drop every blob from the pack but `keep`.
fn lose_blobs_but(w: &Writer, keep: &[BlobHash]) {
    let keep: BTreeSet<BlobHash> = keep.iter().cloned().collect();
    w.lock().blobs.compact(&keep).expect("compact");
}

fn corrupt<T: std::fmt::Debug>(got: Result<T, TxnError>) {
    assert!(matches!(got, Err(TxnError::Corrupt(_))), "{got:?}");
}

#[test]
fn a_missing_preimage_at_commit_is_corruption() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "alpha");
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "alpha", ReviewOp::None))
        .expect("prepare");
    let req = barrier_commit_req(&w, doc, "beta", vec![], &ReviewOp::None);
    lose_blobs_but(&w, &[]);
    corrupt(w.commit(p.txn, req));
}

#[test]
fn a_missing_head_text_when_planning_a_revert_is_corruption() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    lose_blobs_but(&w, &[]);
    corrupt(w.plan_revert(doc, &a));
}

#[test]
fn a_missing_hunk_text_when_planning_a_revert_is_corruption() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let s = w.snapshot().state;
    let head = s.revisions[&w.head(doc).expect("head")].postimage.clone();
    lose_blobs_but(&w, &[head]);
    corrupt(w.plan_revert(doc, &a));
}

#[test]
fn the_genesis_text_needs_no_stored_blob() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::None))
        .expect("prepare");
    let req = barrier_commit_req(&w, doc, "first", vec![], &ReviewOp::None);
    lose_blobs_but(&w, &[]);
    w.commit(p.txn, req).expect("genesis is the empty text");
}

/// `doc` at head `alpha` with a pending observation `beta`.
fn pending_on_head(w: &Writer, doc: DocId) -> (BlobHash, BlobHash) {
    human_save(w, doc, "alpha");
    observe(w, doc, "beta", None);
    (BlobHash::of_text("alpha"), BlobHash::of_text("beta"))
}

fn linearize_next(w: &Writer, doc: DocId) -> Result<(), TxnError> {
    let req = crate::agent_journal::writer::LinearizeRequest {
        expected_head: w.head(doc),
        effects: Default::default(),
    };
    w.linearize_next(doc, req).map(|_| ())
}

#[test]
fn a_missing_head_text_when_linearizing_is_corruption() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let (_, beta) = pending_on_head(&w, doc);
    lose_blobs_but(&w, &[beta]);
    corrupt(linearize_next(&w, doc));
    corrupt(w.debug_capture_payload(doc));
}

#[test]
fn a_missing_observed_text_when_linearizing_is_corruption() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let (alpha, _) = pending_on_head(&w, doc);
    lose_blobs_but(&w, &[alpha]);
    corrupt(linearize_next(&w, doc));
    corrupt(w.debug_capture_payload(doc));
}

#[test]
fn a_missing_preimage_when_deriving_commit_effects_is_corruption() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "alpha");
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "alpha", ReviewOp::None))
        .expect("prepare");
    let req = barrier_commit_req(&w, doc, "beta", vec![], &ReviewOp::None);
    lose_blobs_but(&w, &[]);
    corrupt(w.derive_commit_effects(p.txn, &req));
}

#[test]
fn a_missing_restore_source_text_is_corruption() {
    use crate::agent_journal::controlled_restore::{prepare_restore, RestorePrepareRequest};
    use crate::agent_journal::review::RestoreSource;
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let one = human_save(&w, doc, "one");
    human_save(&w, doc, "two");
    let req = RestorePrepareRequest {
        doc_key: "path:/a.md".into(),
        parent: w.head(doc),
        preimage: "two".into(),
        source: RestoreSource::Revision { revision: one },
        baseline_provenance: None,
        baseline_touched: false,
        observed_parent: None,
        request_id: None,
        capture: None,
    };
    lose_blobs_but(&w, &[BlobHash::of_text("two")]);
    corrupt(prepare_restore(&w, doc, req));
}

#[test]
fn a_missing_legacy_checkpoint_text_is_corruption() {
    use crate::agent_journal::controller::Controller;
    use std::sync::Arc;
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let w = Arc::new(w);
    let c = Controller::new(w.clone(), Arc::default(), Arc::default());
    let cp = serde_json::json!({
        "id": "cp-1", "tabId": "tab-7", "filePath": "/a.md", "timestamp": 1_700_000_000_123u64,
        "tool": "document.write", "description": "d", "contentBefore": "原文",
        "revisionBefore": "r1", "revisionAfter": "r2", "byteSize": 6,
    });
    assert!(c.checkpoint_append(&cp.to_string()).expect("append"));
    lose_blobs_but(&w, &[]);
    let err = c.checkpoints().expect_err("refused");
    assert_eq!(
        err.detail().expect("detail")["journalCode"],
        "JOURNAL_CORRUPT",
        "{err:?}"
    );
}
