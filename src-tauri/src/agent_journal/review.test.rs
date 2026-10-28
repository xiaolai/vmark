// WI-AL1.2 — review-only decisions with reviewGen + head CAS
//! WI-AL0.8 (writer half) — review-only decisions with `reviewGen` + head CAS,
//! atomic "Clear reviewed", reserved `reviewGen` values, hunk revert
//! toggling, Keep-vs-Revert race, crash at a `conflicted` append.

use std::sync::{Arc, Barrier};

use super::test_review_helpers::*;
use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::review::{HunkState, ReviewAction, ReviewItem, ReviewOp};
use crate::agent_journal::writer::{CommitRequest, ReviewRequest, Writer};

#[test]
fn keep_unkeep_and_review_gen_cas() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Kept, 1));
    assert_eq!(
        decide(&w, doc, ReviewAction::Unkeep, &[(&a, 0)])
            .unwrap_err()
            .code(),
        "STALE_REVIEW"
    );
    decide(&w, doc, ReviewAction::Unkeep, &[(&a, 1)]).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Pending, 2));
    assert_eq!(
        decide(&w, doc, ReviewAction::Unkeep, &[(&a, 2)])
            .unwrap_err()
            .code(),
        "STALE_REVIEW",
        "not kept"
    );
}

#[test]
fn review_decision_is_refused_while_a_transaction_holds_the_document() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "xx", ReviewOp::Review))
        .unwrap();
    assert_eq!(
        decide(&w, doc, ReviewAction::Keep, &[(&a, 0)])
            .unwrap_err()
            .code(),
        "JOURNAL_BUSY"
    );
    w.abort(p.txn, "x").unwrap();
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
}

#[test]
fn a_save_after_the_panel_snapshot_makes_the_decision_stale() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
    let panel_head = w.head(doc);
    human_save(&w, doc, "xz");
    assert_ne!(w.head(doc), panel_head);
    let err = w
        .decide(ReviewRequest {
            doc,
            expected_head: panel_head,
            action: ReviewAction::ClearReviewed,
            items: vec![ReviewItem {
                hunk_id: a.clone(),
                expected_review_gen: 1,
            }],
        })
        .unwrap_err();
    assert_eq!(err.code(), "STALE_REVIEW");
    assert_eq!(state(&w, doc, &a), (HunkState::Kept, 1), "nothing settled");
}

#[test]
fn clear_reviewed_is_one_atomic_batch() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
    decide(&w, doc, ReviewAction::Keep, &[(&b, 0)]).unwrap();
    let gen = w.snapshot().generation;
    let err = decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1), (&b, 0)]).unwrap_err();
    assert_eq!(err.code(), "STALE_REVIEW");
    assert_eq!(
        (state(&w, doc, &a), state(&w, doc, &b)),
        ((HunkState::Kept, 1), (HunkState::Kept, 1))
    );
    assert_eq!(w.snapshot().generation, gen, "nothing appended");
    decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1), (&b, 1)]).unwrap();
    assert_eq!(
        (state(&w, doc, &a), state(&w, doc, &b)),
        ((HunkState::Settled, 2), (HunkState::Settled, 2))
    );
    assert_eq!(w.snapshot().generation, gen + 1, "one record");
    assert_eq!(
        decide(&w, doc, ReviewAction::Unkeep, &[(&a, 2)])
            .unwrap_err()
            .code(),
        "STALE_REVIEW",
        "settled is terminal"
    );
}

#[test]
fn clear_reviewed_refuses_pending_hunks_and_duplicate_items() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
    assert_eq!(
        decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1), (&b, 0)])
            .unwrap_err()
            .code(),
        "STALE_REVIEW"
    );
    assert_eq!(
        decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1), (&a, 1)])
            .unwrap_err()
            .code(),
        "INVALID_REQUEST"
    );
    assert_eq!(
        decide(&w, doc, ReviewAction::Keep, &[]).unwrap_err().code(),
        "INVALID_REQUEST"
    );
}

#[test]
fn refused_revert_is_one_conflicted_record_and_mark_handled_resolves_it() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    // The worker found an overlap with another non-settled hunk: no prepare.
    let gen = w.snapshot().generation;
    decide(&w, doc, ReviewAction::Conflicted, &[(&a, 0)]).unwrap();
    assert_eq!(w.snapshot().generation, gen + 1);
    assert_eq!(state(&w, doc, &a), (HunkState::Conflicted, 1));
    assert_eq!(
        state(&w, doc, &b),
        (HunkState::Pending, 0),
        "the other hunk unchanged"
    );
    assert!(
        w.snapshot()
            .state
            .txns
            .values()
            .all(|t| t.status != TxnStatus::Prepared),
        "no prepared/aborted pair"
    );
    decide(&w, doc, ReviewAction::MarkHandled, &[(&a, 1)]).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::ResolvedByHumanEdit, 2));
}

#[test]
fn crash_at_every_byte_of_a_conflicted_append_leaves_pending_or_conflicted() {
    let dir = tmp();
    let doc = DocId::new();
    let (a, before, after) = {
        let (w, _) = open(dir.path());
        let (a, _) = two_hunks(&w, doc);
        let before = w.journal_len();
        decide(&w, doc, ReviewAction::Conflicted, &[(&a, 0)]).unwrap();
        (a, before, w.journal_len())
    };
    for cut in before..=after {
        let crash = tmp();
        for e in std::fs::read_dir(dir.path()).unwrap() {
            let e = e.unwrap();
            std::fs::copy(e.path(), crash.path().join(e.file_name())).unwrap();
        }
        std::fs::OpenOptions::new()
            .write(true)
            .open(crash.path().join(JOURNAL_FILE))
            .unwrap()
            .set_len(cut)
            .unwrap();
        let (w, report) = Writer::open(config(crash.path(), SyncPolicy::None).0).unwrap();
        let st = state(&w, doc, &a).0;
        assert!(
            matches!(st, HunkState::Pending | HunkState::Conflicted),
            "cut={cut}: {st:?}"
        );
        assert_eq!(st == HunkState::Conflicted, cut == after);
        assert!(report.uncommitted.is_empty(), "no transaction is open");
        assert!(w.reservation(doc).is_none());
    }
}

#[test]
fn revert_toggles_pending_reverted_and_attaches_only_the_latest() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let r1 = revert(&w, doc, &a, "xx", "yx").unwrap().revision;
    let s = w.snapshot().state;
    assert_eq!(
        (
            s.docs[&doc].hunks[&a].state,
            s.docs[&doc].hunks[&a].attached_revert
        ),
        (HunkState::Reverted, Some(r1))
    );
    let r2 = revert(&w, doc, &a, "yx", "xx").unwrap().revision;
    let s = w.snapshot().state;
    assert_eq!(
        (
            s.docs[&doc].hunks[&a].state,
            s.docs[&doc].hunks[&a].attached_revert
        ),
        (HunkState::Pending, Some(r2))
    );
    assert_eq!(
        s.docs[&doc].hunks.len(),
        2,
        "a revert never creates an item"
    );
}

#[test]
fn reverting_a_settled_hunk_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
    decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1)]).unwrap();
    assert_eq!(
        revert(&w, doc, &a, "xx", "yx").unwrap_err().code(),
        "STALE_REVIEW"
    );
}

#[test]
fn keep_racing_revert_exactly_one_transition_wins() {
    // Revert first: it holds the reservation, Keep is refused immediately.
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let effects = w.plan_revert(doc, &a).unwrap().effects;
    let p = w
        .prepare(prepare_req(
            doc,
            w.head(doc),
            "xx",
            ReviewOp::HunkRevert {
                hunk_id: a.clone(),
                expected_review_gen: 0,
            },
        ))
        .unwrap();
    assert_eq!(
        decide(&w, doc, ReviewAction::Keep, &[(&a, 0)])
            .unwrap_err()
            .code(),
        "JOURNAL_BUSY"
    );
    w.commit(
        p.txn,
        CommitRequest {
            provenance: None,
            postimage: "yx".into(),
            resolves: None,
            effects,
        },
    )
    .unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Reverted, 1));
    // Keep first: the revert's expectedReviewGen is stale at prepare.
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
    let head = w.head(doc);
    let err = w
        .prepare(prepare_req(
            doc,
            head,
            "xx",
            ReviewOp::HunkRevert {
                hunk_id: a.clone(),
                expected_review_gen: 0,
            },
        ))
        .unwrap_err();
    assert_eq!(err.code(), "STALE_REVIEW");
    assert_eq!(
        (w.head(doc), state(&w, doc, &a)),
        (head, (HunkState::Kept, 1)),
        "content unchanged"
    );
}

#[test]
fn keep_racing_revert_on_threads() {
    for _ in 0..20 {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let w = Arc::new(w);
        let doc = DocId::new();
        let (a, _) = two_hunks(&w, doc);
        let head = w.head(doc);
        let effects = w.plan_revert(doc, &a).unwrap().effects;
        let bar = Arc::new(Barrier::new(2));
        let keep = {
            let (w, bar, a) = (w.clone(), bar.clone(), a.clone());
            std::thread::spawn(move || {
                bar.wait();
                w.decide(ReviewRequest {
                    doc,
                    expected_head: head,
                    action: ReviewAction::Keep,
                    items: vec![ReviewItem {
                        hunk_id: a,
                        expected_review_gen: 0,
                    }],
                })
                .is_ok()
            })
        };
        let rev = {
            let (w, bar, a) = (w.clone(), bar.clone(), a.clone());
            std::thread::spawn(move || {
                bar.wait();
                let Ok(p) = w.prepare(prepare_req(
                    doc,
                    head,
                    "xx",
                    ReviewOp::HunkRevert {
                        hunk_id: a,
                        expected_review_gen: 0,
                    },
                )) else {
                    return false;
                };
                w.commit(
                    p.txn,
                    CommitRequest {
                        provenance: None,
                        postimage: "yx".into(),
                        resolves: None,
                        effects,
                    },
                )
                .is_ok()
            })
        };
        let (k, r) = (keep.join().unwrap(), rev.join().unwrap());
        assert!(k ^ r, "exactly one wins: keep={k} revert={r}");
        assert_eq!(
            w.head(doc) != head,
            r,
            "content changes only if the revert wins"
        );
    }
}

#[test]
fn review_decision_records_survive_restart() {
    let dir = tmp();
    let doc = DocId::new();
    let live = {
        let (w, _) = open(dir.path());
        let (a, b) = two_hunks(&w, doc);
        decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
        decide(&w, doc, ReviewAction::Conflicted, &[(&b, 0)]).unwrap();
        decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1)]).unwrap();
        w.close_epoch(doc, w.epoch(doc).unwrap()).unwrap();
        w.snapshot()
    };
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::Full).0).unwrap();
    assert_eq!(w.snapshot(), live);
    let kinds: Vec<_> = w.debug_records().iter().map(|e| e.record.kind()).collect();
    assert_eq!(kinds.iter().filter(|k| *k == "uncommitted").count(), 0);
}

/// A save captured but not yet linearized changes neither the head nor any
/// `reviewGen`, yet the text the panel rendered is gone: a decision is
/// refused `JOURNAL_BUSY` until the save lands, and appends nothing.
#[test]
fn a_review_decision_waits_for_a_captured_save_to_land() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let before = w.head(doc);
    observe(&w, doc, "zz", None);
    assert_eq!(w.head(doc), before, "the save is pending, not linearized");
    let len = w.lock().journal.len();
    assert_eq!(
        decide(&w, doc, ReviewAction::Keep, &[(&a, 0)])
            .unwrap_err()
            .code(),
        "JOURNAL_BUSY"
    );
    assert_eq!(
        w.lock().journal.len(),
        len,
        "a refused decision appends nothing"
    );
    linearize(&w, doc);
    assert_ne!(w.head(doc), before);
    let (st, rg) = state(&w, doc, &a);
    assert_eq!(
        decide(&w, doc, ReviewAction::Keep, &[(&a, rg)]).is_ok(),
        st == HunkState::Pending || st == HunkState::Conflicted,
        "once the save lands the panel decides against what it now reads"
    );
}
