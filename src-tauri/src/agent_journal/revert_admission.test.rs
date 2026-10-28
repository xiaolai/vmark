// WI-AL2.2b — a revert's prepare decides its own outcome: an applied revert prepares and replies with the exact patch; a conflicted or found-base outcome is recorded as one review decision with no transaction and no reservation; a conflicted hunk that conflicts again and a reverted hunk that cannot be re-applied are refused as REVERT_REFUSED with nothing appended; a stale reviewGen, an unsaved certified undo and an ambiguous span refuse first; a baseline and the decision behind it are one admission
//! R106 rules 1–4, through `prepare_revert`.

use super::revert_support::*;
use crate::agent_journal::admission::receipt::Outcome;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::record::Record;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::review::{HunkState, ReviewAction};
use crate::agent_journal::test_review_helpers::{decide, revert_planned, state, two_hunks};
use crate::agent_journal::test_support::*;
use crate::command_error::ErrorCode;

#[test]
fn an_applied_revert_prepares_and_replies_with_its_patch() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let rg = state(&w, doc, &a).1;
    let p = prepared(run(&w, doc, rreq(&w, doc, "xx", &a), None).expect("prepare"));
    assert_eq!((p.doc, p.hunk.clone(), p.review_gen), (doc, a.clone(), rg));
    assert_eq!((p.from, p.to, p.insert.as_str()), (0, 1, "y"));
    assert_eq!(p.postimage_hash, BlobHash::of_text("yx"));
    assert_eq!(p.baseline, None);
    assert_eq!(w.reservation(doc).map(|r| r.txn), Some(p.txn));
    assert!(matches!(last_record(&w).record, Record::Prepared { .. }));
}

#[test]
fn a_conflicted_revert_of_a_pending_hunk_is_recorded_as_a_decision() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = conflicted_pending(&w, doc);
    let rg = state(&w, doc, &a).1;
    let d = decided(run(&w, doc, rreq(&w, doc, "zx", &a), None).expect("revert"));
    assert_eq!(
        (d.doc, d.hunk.clone(), d.action),
        (doc, a.clone(), ReviewAction::Conflicted)
    );
    assert_eq!(state(&w, doc, &a), (HunkState::Conflicted, rg + 1));
    assert_eq!(d.review_gen, rg + 1, "the reviewGen after the decision");
    assert_eq!(d.head, w.head(doc));
    assert_eq!(d.baseline, None);
    let env = last_record(&w);
    assert_eq!(d.generation, env.seq);
    assert!(matches!(
        env.record,
        Record::ReviewDecision {
            action: ReviewAction::Conflicted,
            ..
        }
    ));
    assert!(
        w.reservation(doc).is_none(),
        "a decision holds no reservation"
    );
}

#[test]
fn a_revert_that_finds_its_base_resolves_a_pending_hunk() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let h = found_base_hunk(&w, doc);
    let rg = state(&w, doc, &h).1;
    let d = decided(run(&w, doc, rreq(&w, doc, "two", &h), None).expect("revert"));
    assert_eq!(d.action, ReviewAction::RevertFoundBase);
    assert_eq!(state(&w, doc, &h), (HunkState::ResolvedByHumanEdit, rg + 1));
}

#[test]
fn a_revert_that_finds_its_base_resolves_a_conflicted_hunk() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let h = found_base_hunk(&w, doc);
    decide(
        &w,
        doc,
        ReviewAction::Conflicted,
        &[(&h, state(&w, doc, &h).1)],
    )
    .expect("conflicted");
    let d = decided(run(&w, doc, rreq(&w, doc, "two", &h), None).expect("revert"));
    assert_eq!(d.action, ReviewAction::RevertFoundBase);
    assert_eq!(state(&w, doc, &h).0, HunkState::ResolvedByHumanEdit);
}

#[test]
fn a_conflicted_hunk_that_conflicts_again_is_refused_with_nothing_appended() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = conflicted_pending(&w, doc);
    decide(
        &w,
        doc,
        ReviewAction::Conflicted,
        &[(&a, state(&w, doc, &a).1)],
    )
    .expect("conflicted");
    let before = mark(&w);
    let e = run(&w, doc, rreq(&w, doc, "zx", &a), None).expect_err("refused");
    assert_eq!(
        e,
        TxnError::RevertRefused {
            hunk: a.clone(),
            reason: "conflicted"
        }
    );
    assert_eq!(mark(&w), before);
    let c = refusal(&e);
    assert_eq!(c.code(), ErrorCode::Conflict);
    assert_eq!(
        c.detail(),
        Some(
            &serde_json::json!({ "journalCode": "REVERT_REFUSED", "hunk": a, "reason": "conflicted" })
        )
    );
}

#[test]
fn a_reverted_hunk_that_cannot_be_reapplied_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    assert_eq!(revert_planned(&w, doc, &a).expect("revert"), "yx");
    human_edit(
        &w,
        doc,
        "zx",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    );
    let before = mark(&w);
    let e = run(&w, doc, rreq(&w, doc, "zx", &a), None).expect_err("refused");
    assert_eq!(
        e,
        TxnError::RevertRefused {
            hunk: a,
            reason: "reapply"
        }
    );
    assert_eq!(e.code(), "REVERT_REFUSED");
    assert_eq!(mark(&w), before);
}

#[test]
fn a_stale_review_gen_refuses_before_anything_is_appended() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = conflicted_pending(&w, doc);
    let req = rreq(&w, doc, "zx", &a);
    decide(
        &w,
        doc,
        ReviewAction::Keep,
        &[(&a, req.expected_review_gen)],
    )
    .expect("keep");
    let before = mark(&w);
    let e = run(&w, doc, req, None).expect_err("stale");
    assert_eq!(e.code(), "STALE_REVIEW");
    assert_eq!(mark(&w), before);
}

#[test]
fn an_unsaved_certified_undo_of_the_hunk_is_stale_with_nothing_appended() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let mut req = rreq(&w, doc, "yx", &a);
    req.baseline_provenance = Some(baseline_map(
        &w,
        doc,
        "xx",
        "yx",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    ));
    let before = mark(&w);
    let e = run(&w, doc, req, None).expect_err("stale");
    assert_eq!(e.code(), "STALE_REVIEW");
    assert_eq!(mark(&w), before);
}

#[test]
fn an_ambiguous_span_refuses_with_nothing_appended() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    snapshot_save(&w, doc, "xxz");
    let before = mark(&w);
    let e = run(&w, doc, rreq(&w, doc, "xxz", &a), None).expect_err("ambiguous");
    assert_eq!(e.code(), "AMBIGUOUS_REVERT");
    assert_eq!(mark(&w), before);
}

#[test]
fn a_disjoint_unsaved_edit_shifts_nothing_and_stages_one_admission() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let mut req = rreq(&w, doc, "xxq", &a);
    req.baseline_provenance = Some(baseline_map(
        &w,
        doc,
        "xx",
        "xxq",
        &[Edit {
            at: 2,
            delete: 0,
            insert: 1,
        }],
    ));
    let p = prepared(run(&w, doc, req, None).expect("prepare"));
    assert!(p.baseline.is_some());
    assert_eq!((p.from, p.to, p.insert.as_str()), (0, 1, "y"));
    assert_eq!(p.postimage_hash, BlobHash::of_text("yxq"));
    let Record::Admission { items } = last_record(&w).record else {
        panic!("one admission frame");
    };
    let kinds: Vec<_> = items
        .iter()
        .map(|e| std::mem::discriminant(&e.record))
        .collect();
    assert_eq!(kinds.len(), 3);
    assert!(matches!(items[0].record, Record::PendingObservation { .. }));
    assert!(matches!(items[1].record, Record::ObservedRevision { .. }));
    assert!(matches!(items[2].record, Record::Prepared { .. }));
}

#[test]
fn a_baseline_and_the_decision_behind_it_are_one_admission() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let mut req = rreq(&w, doc, "zx", &a);
    req.baseline_provenance = Some(baseline_map(
        &w,
        doc,
        "xx",
        "zx",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    ));
    let d = decided(run(&w, doc, req, None).expect("revert"));
    assert_eq!(d.action, ReviewAction::Conflicted);
    assert!(d.baseline.is_some());
    assert_eq!(
        d.head, d.baseline,
        "the decision is on the recorded baseline"
    );
    let Record::Admission { items } = last_record(&w).record else {
        panic!("one admission frame");
    };
    assert_eq!(items.len(), 3);
    assert!(matches!(items[2].record, Record::ReviewDecision { .. }));
    assert_eq!(d.generation, items[2].seq);
}

#[test]
fn a_revert_that_would_edit_another_live_hunk_is_recorded_conflicted() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    two_hunks(&w, doc);
    agent_change(
        &w,
        doc,
        "xx",
        "yx",
        Edit {
            at: 0,
            delete: 1,
            insert: 1,
        },
    );
    let c = hunk_ids(&w, doc)
        .into_iter()
        .find(|id| {
            state(&w, doc, id) == (HunkState::Pending, 0) && {
                let s = w.snapshot().state;
                s.docs[&doc].hunks[id].hunk.target == w.head(doc).expect("head")
            }
        })
        .expect("the agent's new hunk");
    let out = run(&w, doc, rreq(&w, doc, "yx", &c), None).expect("revert");
    assert!(
        matches!(out, Outcome::Decision(ref d) if d.action == ReviewAction::Conflicted),
        "{out:?}"
    );
}
