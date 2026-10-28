// WI-AL2.2 (WI-AL2.2d) — R34 commit dispatch for a hunkRevert: a revert prepared through `prepare_revert` commits through `commit_controlled` with the writer deriving its effects from the revert plan (no worker effects), survives a restart, and its revert-of-revert lands exactly; a postimage that is not the planned revert, or a certificate sent with one, is refused and ends the transaction with nothing committed
//! R34, Rust side.

use serde_json::json;

use super::revert_support::*;
use crate::agent_journal::controlled::commit_controlled;
use crate::agent_journal::controlled_revert::RevertPrepared;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::review::HunkState;
use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

/// Prepare a revert of `hunk` over `buffer` (the head text, ASCII).
fn prepare(w: &Writer, doc: DocId, buffer: &str, hunk: &HunkId) -> RevertPrepared {
    prepared(run(w, doc, rreq(w, doc, buffer, hunk), None).expect("prepare"))
}

/// `buffer` with the prepared patch applied, as the window applies it.
fn patched(buffer: &str, p: &RevertPrepared) -> String {
    let (from, to) = (p.from as usize, p.to as usize);
    format!("{}{}{}", &buffer[..from], p.insert, &buffer[to..])
}

fn body(postimage: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({ "postimage": postimage })).unwrap()
}

#[test]
fn a_controlled_revert_commits_survives_a_restart_and_reverts_back_exactly() {
    let dir = tmp();
    let doc = DocId::new();
    let a = {
        let (w, _) = open(dir.path());
        let (a, _) = two_hunks(&w, doc);
        let p = prepare(&w, doc, "xx", &a);
        let post = patched("xx", &p);
        assert_eq!(post, "yx");
        let c = commit_controlled(&w, p.txn, &body(&post)).expect("commit the revert");
        assert!(c.applied && c.durable);
        assert_eq!((c.doc, c.revision), (doc, p.revision));
        assert_eq!(w.head(doc), Some(p.revision));
        assert_eq!(head_text(&w, doc), "yx");
        assert_eq!(state(&w, doc, &a).0, HunkState::Reverted);
        assert!(w.reservation(doc).is_none(), "the reservation is released");
        // A clean shutdown closes the window's epoch; an open one would
        // block every span it certified at the restart.
        if let Some(epoch) = w.epoch(doc) {
            w.close_epoch(doc, epoch).expect("close epoch");
        }
        a
    };
    let (w, _) = open(dir.path());
    assert_eq!(head_text(&w, doc), "yx", "the revert survives a restart");
    assert_eq!(state(&w, doc, &a).0, HunkState::Reverted);
    let p = prepare(&w, doc, "yx", &a);
    let post = patched("yx", &p);
    assert_eq!(post, "xx");
    let c = commit_controlled(&w, p.txn, &body(&post)).expect("commit the revert-of-revert");
    assert!(c.applied && c.durable);
    assert_eq!(head_text(&w, doc), "xx");
    assert_ne!(state(&w, doc, &a).0, HunkState::Reverted);
}

#[test]
fn a_postimage_that_is_not_the_planned_revert_is_refused_and_commits_nothing() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let head = w.head(doc);
    let p = prepare(&w, doc, "xx", &a);
    let e = commit_controlled(&w, p.txn, &body("yy")).expect_err("refused");
    assert_eq!(e.code(), "INVALID_REQUEST", "{e}");
    assert_eq!(w.head(doc), head);
    assert_eq!(head_text(&w, doc), "xx");
    assert_eq!(state(&w, doc, &a).0, HunkState::Pending);
    assert!(
        w.reservation(doc).is_none(),
        "the transaction ended uncommitted"
    );
}

#[test]
fn a_certificate_sent_with_a_revert_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let p = prepare(&w, doc, "xx", &a);
    let sent = json!({ "postimage": "yx", "certificate": { "bogus": true } });
    let e = commit_controlled(&w, p.txn, &serde_json::to_vec(&sent).unwrap()).unwrap_err();
    assert!(matches!(e, TxnError::InvalidRequest(_)), "{e:?}");
    assert_eq!(head_text(&w, doc), "xx");
}
