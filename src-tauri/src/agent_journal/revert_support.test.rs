// WI-AL2.2b — shared helpers for the revert-admission and revert-receipt suites: a revert request built from the live hunk, a request id with its digest, the conflicted, found-base and overlap setups, and readers for the appended records
//! Helpers only; the cases live in `revert_admission.test.rs` and
//! `revert_receipts.test.rs`.

use crate::agent_journal::admission::receipt::{Outcome, PayloadDigest, RequestId};
use crate::agent_journal::controlled::commit_controlled;
use crate::agent_journal::controlled_restore::{prepare_restore, RestorePrepareRequest};
use crate::agent_journal::controlled_revert::{
    prepare_revert_with, RevertDecided, RevertPrepareRequest, RevertPrepared,
};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, HunkId, RevisionId};
use crate::agent_journal::provenance_field::ProvenanceField;
use crate::agent_journal::record::Envelope;
use crate::agent_journal::review::{HunkKind, RestoreSource};
use crate::agent_journal::writer::Writer;

use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::*;

pub const KEY: &str = "path:/notes/revert.md";

/// A revert of `hunk` over `buffer`, on the live head and `reviewGen`.
pub fn rreq(w: &Writer, doc: DocId, buffer: &str, hunk: &HunkId) -> RevertPrepareRequest {
    RevertPrepareRequest {
        doc_key: KEY.into(),
        parent: w.head(doc),
        preimage: buffer.into(),
        baseline_provenance: None,
        baseline_touched: false,
        observed_parent: Some(observed_on(w.head(doc))),
        request_id: None,
        capture: None,
        hunk_id: hunk.clone(),
        expected_review_gen: state(w, doc, hunk).1,
    }
}

/// `req` under a fresh request id, with the digest of a payload that
/// stands for its raw bytes.
pub fn receipted(mut req: RevertPrepareRequest) -> (RevertPrepareRequest, PayloadDigest) {
    let id: RequestId = uuid::Uuid::new_v4().to_string().parse().expect("v4 id");
    req.request_id = Some(id);
    let digest = PayloadDigest::of(&format!("revert {id}"));
    (req, digest)
}

/// Prepare `req` with `digest` (or none).
pub fn run(
    w: &Writer,
    doc: DocId,
    req: RevertPrepareRequest,
    digest: Option<PayloadDigest>,
) -> Result<Outcome, TxnError> {
    prepare_revert_with(w, doc, req, digest)
}

/// The prepared reply of an applied revert.
#[track_caller]
pub fn prepared(out: Outcome) -> RevertPrepared {
    match out {
        Outcome::Prepared(crate::agent_journal::admission::receipt::PreparedResponse::Revert(
            p,
        )) => p,
        other => panic!("expected a prepared revert, got {other:?}"),
    }
}

/// The decision reply of a revert that did not apply.
#[track_caller]
pub fn decided(out: Outcome) -> RevertDecided {
    match out {
        Outcome::Decision(d) => d,
        other => panic!("expected a revert decision, got {other:?}"),
    }
}

/// Two hunks "yy" → "xx", then a certified human edit of the first one's
/// text ("zx"): the first stays pending and no longer reverts cleanly.
pub fn conflicted_pending(w: &Writer, doc: DocId) -> (HunkId, HunkId) {
    let (a, b) = two_hunks(w, doc);
    human_edit(
        w,
        doc,
        "zx",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    );
    (a, b)
}

/// A restore of the head's own text, committed: its `restore` hunk finds
/// its base text already in place.
pub fn found_base_hunk(w: &Writer, doc: DocId) -> HunkId {
    human_save(w, doc, "one");
    let two = human_save(w, doc, "two");
    let req = RestorePrepareRequest {
        doc_key: KEY.into(),
        parent: w.head(doc),
        preimage: "two".into(),
        source: RestoreSource::Revision { revision: two },
        baseline_provenance: None,
        baseline_touched: false,
        observed_parent: None,
        request_id: None,
        capture: None,
    };
    let p = prepare_restore(w, doc, req).expect("prepare restore");
    let post = serde_json::json!({ "postimage": p.text }).to_string();
    commit_controlled(w, p.txn, post.as_bytes()).expect("commit restore");
    restore_hunk(w, doc, p.revision)
}

fn restore_hunk(w: &Writer, doc: DocId, revision: RevisionId) -> HunkId {
    let s = w.snapshot().state;
    let hunks: Vec<_> = s.docs[&doc]
        .hunks
        .iter()
        .filter(|(_, h)| h.hunk.target == revision && h.hunk.kind == HunkKind::Restore)
        .map(|(id, _)| id.clone())
        .collect();
    assert_eq!(hunks.len(), 1, "exactly one restore hunk");
    hunks[0].clone()
}

/// The certified baseline map `pre → post` through `edits`, on the head,
/// as the window sends it.
pub fn baseline_map(
    w: &Writer,
    doc: DocId,
    pre: &str,
    post: &str,
    edits: &[Edit],
) -> ProvenanceField {
    let p = payload(w, doc, &basis(w.head(doc)), pre, post, edits);
    serde_json::from_value(serde_json::to_value(p).expect("payload")).expect("field")
}

/// The last record the journal holds.
pub fn last_record(w: &Writer) -> Envelope {
    w.debug_records().pop().expect("a record")
}

/// The journal's raw record count and generation, to show nothing appended.
pub fn mark(w: &Writer) -> (usize, u64) {
    (w.debug_records().len(), w.generation())
}
