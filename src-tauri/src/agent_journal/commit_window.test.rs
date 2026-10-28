// WI-AL2.1c — the commit-window matrix's refusals: a certificate on anything but a review write without provenance, worker provenance on a hunkRevert or a restore, and a hunkRevert whose postimage is not the hunk's revert are each INVALID_REQUEST with nothing appended and the transaction still open
//! Every refusal happens before the window is used, so the journal length
//! and the open transaction are the evidence that nothing changed.

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::provenance::Certificate;
use crate::agent_journal::review::{RestoreSource, ReviewEffects, ReviewOp};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::certificate::support::cert;
use crate::agent_journal::writer::{CommitRequest, Writer};

fn sent() -> Certificate {
    let edit = Edit {
        at: 1,
        delete: 0,
        insert: 1,
    };
    serde_json::from_value(cert("a", "ab", &[edit])).expect("certificate")
}

fn plain(post: &str) -> CommitRequest {
    CommitRequest {
        postimage: post.into(),
        resolves: None,
        provenance: None,
        effects: ReviewEffects {
            new_hunks: vec![],
            transitions: vec![],
            spans: vec![],
            algorithm: "spike-1".into(),
        },
    }
}

/// `commit_with` refuses with `why` and leaves `txn` open, nothing appended.
fn refused(w: &Writer, txn: TxnId, req: CommitRequest, cert: Option<&Certificate>, why: &str) {
    let len = w.journal_len();
    let err = w.commit_with(txn, req, cert, None).unwrap_err();
    assert!(
        matches!(&err, TxnError::InvalidRequest(m) if m.contains(why)),
        "{err:?}"
    );
    assert_eq!(w.journal_len(), len, "nothing appended");
    assert_eq!(w.snapshot().state.txns[&txn].status, TxnStatus::Prepared);
}

fn prepared(w: &Writer, doc: DocId, op: ReviewOp) -> TxnId {
    let pre = head_text(w, doc);
    w.prepare(prepare_req(doc, w.head(doc), &pre, op))
        .expect("prepare")
        .txn
}

#[test]
fn a_certificate_on_anything_but_a_review_write_without_provenance_is_refused() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let why = "a certificate is for a review write without provenance";
    let txn = prepared(&w, doc, ReviewOp::None);
    refused(&w, txn, plain("ab"), Some(&sent()), why);
    w.abort(txn, "edited").expect("abort");
    let txn = prepared(&w, doc, ReviewOp::Review);
    let edit = Edit {
        at: 1,
        delete: 0,
        insert: 1,
    };
    let req = commit_req(&w, doc, "ab", edit, vec![]);
    refused(&w, txn, req, Some(&sent()), why);
}

#[test]
fn worker_provenance_on_a_hunk_revert_or_a_restore_is_refused() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let older = human_save(&w, doc, "y");
    let post = seed_hunks(&w, doc, 1);
    let why = "a hunkRevert or restore carries no worker provenance";
    let hunk_id = hunk_ids(&w, doc).remove(0);
    let revert = ReviewOp::HunkRevert {
        hunk_id,
        expected_review_gen: 0,
    };
    let edit = Edit {
        at: 0,
        delete: 1,
        insert: 1,
    };
    let txn = prepared(&w, doc, revert.clone());
    let req = commit_req_op(&w, doc, "y", &[edit], vec![], &revert);
    refused(&w, txn, req, None, why);
    w.abort(txn, "edited").expect("abort");
    let restore = ReviewOp::Restore {
        source: RestoreSource::Revision { revision: older },
    };
    let txn = prepared(&w, doc, restore.clone());
    let req = commit_req_op(&w, doc, "y", &[edit], vec![], &restore);
    refused(&w, txn, req, None, why);
    assert_eq!(head_text(&w, doc), post);
}

#[test]
fn a_hunk_revert_whose_postimage_is_not_the_revert_is_refused() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    seed_hunks(&w, doc, 1);
    let revert = ReviewOp::HunkRevert {
        hunk_id: hunk_ids(&w, doc).remove(0),
        expected_review_gen: 0,
    };
    let txn = prepared(&w, doc, revert);
    let why = "the postimage is not the revert of the hunk";
    refused(&w, txn, plain("z"), None, why);
}
