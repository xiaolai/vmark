// WI-AL1.2 — reserved reviewGen values and capture-driven transitions held to their ceilings
//! WI-AL0.8 (writer half) — reserved `reviewGen` values and capture-driven
//! transitions (superseded, resolvedByHumanEdit, editedSince).

use super::test_review_helpers::*;
use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::review::{
    HunkState, HunkTransition, ReviewAction, ReviewEffects, ReviewOp,
};
use crate::agent_journal::writer::LinearizeRequest;

#[test]
fn reserved_review_gen_values() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    // At MAX-2: keep accepted, conflicted refused. A revert into `reverted`
    // is a user transition into a decided state (golden `userToDecided`,
    // ≤ MAX-2), so it is admitted: `reverted` at MAX-1 can still settle.
    w.debug_set_review_gen(doc, &a, MAX - 2);
    let op = ReviewOp::HunkRevert {
        hunk_id: a.clone(),
        expected_review_gen: MAX - 2,
    };
    let p = w.prepare(prepare_req(doc, w.head(doc), "xx", op)).unwrap();
    w.abort(p.txn, "test").unwrap();
    w.debug_set_review_gen(doc, &a, MAX - 3);
    let op = ReviewOp::HunkRevert {
        hunk_id: a.clone(),
        expected_review_gen: MAX - 3,
    };
    let p = w.prepare(prepare_req(doc, w.head(doc), "xx", op)).unwrap();
    w.abort(p.txn, "test").unwrap();
    w.debug_set_review_gen(doc, &a, MAX - 2);
    assert_eq!(
        decide(&w, doc, ReviewAction::Conflicted, &[(&a, MAX - 2)])
            .unwrap_err()
            .code(),
        "REVIEW_STATE_EXHAUSTED"
    );
    decide(&w, doc, ReviewAction::Keep, &[(&a, MAX - 2)]).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Kept, MAX - 1));
    // At MAX-1: un-keep refused; Clear reviewed still settles at MAX.
    assert_eq!(
        decide(&w, doc, ReviewAction::Unkeep, &[(&a, MAX - 1)])
            .unwrap_err()
            .code(),
        "REVIEW_STATE_EXHAUSTED"
    );
    decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, MAX - 1)]).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Settled, MAX));
    // Un-keep at MAX-2 refused; "mark handled" at MAX-2 accepted.
    decide(&w, doc, ReviewAction::Conflicted, &[(&b, 0)]).unwrap();
    w.debug_set_review_gen(doc, &b, MAX - 2);
    decide(&w, doc, ReviewAction::MarkHandled, &[(&b, MAX - 2)]).unwrap();
    assert_eq!(
        state(&w, doc, &b),
        (HunkState::ResolvedByHumanEdit, MAX - 1)
    );
}

#[test]
fn keep_at_max_minus_one_is_refused_but_clear_still_settles() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    w.debug_set_review_gen(doc, &a, MAX - 1);
    assert_eq!(
        decide(&w, doc, ReviewAction::Keep, &[(&a, MAX - 1)])
            .unwrap_err()
            .code(),
        "REVIEW_STATE_EXHAUSTED"
    );
    decide(&w, doc, ReviewAction::Keep, &[(&b, 0)]).unwrap();
    w.debug_set_review_gen(doc, &b, MAX - 1);
    decide(&w, doc, ReviewAction::ClearReviewed, &[(&b, MAX - 1)]).unwrap();
    assert_eq!(state(&w, doc, &b), (HunkState::Settled, MAX));
}

#[test]
fn capture_driven_transition_at_max_minus_two_is_never_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    w.debug_set_review_gen(doc, &a, MAX - 2);
    // The human retypes the hunk's base text by hand: "xx" → "yx".
    certified_capture(
        &w,
        doc,
        "yx",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    );
    let effects = linearize_effects(&w, doc);
    let expected = HunkTransition {
        hunk_id: a.clone(),
        expected_review_gen: MAX - 2,
        to: HunkState::ResolvedByHumanEdit,
    };
    assert_eq!(effects.transitions, vec![expected]);
    w.linearize_next(
        doc,
        LinearizeRequest {
            expected_head: w.head(doc),
            effects,
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        state(&w, doc, &a),
        (HunkState::ResolvedByHumanEdit, MAX - 1)
    );
    decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, MAX - 1)]).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Settled, MAX));
}

#[test]
fn capture_effects_are_validated_against_the_op_and_review_state() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let head = w.head(doc).unwrap();
    certified_capture(
        &w,
        doc,
        "yx",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    );
    let spans = linearize_effects(&w, doc).spans;
    let lin = |to, gen, spans: Vec<_>| {
        w.linearize_next(
            doc,
            LinearizeRequest {
                expected_head: Some(head),
                effects: ReviewEffects {
                    transitions: vec![HunkTransition {
                        hunk_id: a.clone(),
                        expected_review_gen: gen,
                        to,
                    }],
                    spans,
                    ..Default::default()
                },
            },
        )
    };
    assert_eq!(
        lin(HunkState::Superseded, 0, spans.clone())
            .unwrap_err()
            .code(),
        "INVALID_REQUEST",
        "a human save never supersedes"
    );
    assert_eq!(
        lin(HunkState::ResolvedByHumanEdit, 5, spans.clone())
            .unwrap_err()
            .code(),
        "STALE_REVIEW"
    );
    assert_eq!(
        lin(HunkState::ResolvedByHumanEdit, 0, spans[1..].to_vec())
            .unwrap_err()
            .code(),
        "STALE_REVIEW",
        "every non-settled hunk needs a span"
    );
    lin(HunkState::ResolvedByHumanEdit, 0, spans).unwrap();
}

#[test]
fn a_later_review_revision_supersedes_and_edited_since_does_not_bump_gen() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "xx", ReviewOp::Review))
        .unwrap();
    let edit = Edit {
        at: 0,
        delete: 1,
        insert: 1,
    };
    let new = hunk(
        w.head(doc),
        p.revision,
        "xx",
        "zx",
        r(0, 1),
        r(0, 1),
        crate::agent_journal::review::HunkKind::Change,
    );
    let req = commit_req(&w, doc, "zx", edit, vec![new]);
    assert_eq!(
        req.effects.transitions,
        vec![HunkTransition {
            hunk_id: a.clone(),
            expected_review_gen: 0,
            to: HunkState::Superseded
        }]
    );
    w.commit(p.txn, req).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Superseded, 1));
    assert_eq!(state(&w, doc, &b), (HunkState::Pending, 0));
    let s = w.snapshot().state;
    assert!(
        s.docs[&doc].hunks[&a].span.edited_since,
        "edited-since is span metadata"
    );
    assert_eq!(s.docs[&doc].hunks.len(), 3);
}

/// Replay `records[..at]`, then apply `tampered` in place of `records[at]`:
/// a refusal must be corruption and must leave the projection untouched.
fn refused_untouched(
    records: &[crate::agent_journal::record::Envelope],
    at: usize,
    tampered: &crate::agent_journal::record::Envelope,
) {
    let mut p = crate::agent_journal::projection::Projection::default();
    for e in &records[..at] {
        p.apply(e).expect("a clean prefix replays");
    }
    let before = p.clone();
    let got = p.apply(tampered);
    assert!(
        matches!(got, Err(crate::agent_journal::errors::TxnError::Corrupt(_))),
        "{got:?}"
    );
    assert_eq!(p, before, "a refused record changes nothing");
}

#[test]
fn decision_replay_checks_the_head_every_review_gen_and_duplicates_first() {
    use crate::agent_journal::record::Record;
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0), (&b, 0)]).unwrap();
    let records = w.debug_records();
    let at = records
        .iter()
        .rposition(|e| matches!(e.record, Record::ReviewDecision { .. }))
        .expect("a decision");
    let tamper = |f: &dyn Fn(
        &mut Option<crate::agent_journal::ids::RevisionId>,
        &mut Vec<crate::agent_journal::review::ReviewItem>,
    )| {
        let mut e = records[at].clone();
        if let Record::ReviewDecision {
            expected_head,
            items,
            ..
        } = &mut e.record
        {
            f(expected_head, items);
        }
        e
    };
    refused_untouched(
        &records,
        at,
        &tamper(&|head, _| {
            *head = Some(crate::agent_journal::ids::RevisionId::new());
        }),
    );
    refused_untouched(
        &records,
        at,
        &tamper(&|_, items| items[1].expected_review_gen = 1),
    );
    refused_untouched(
        &records,
        at,
        &tamper(&|_, items| {
            let first = items[0].clone();
            items[1] = first;
        }),
    );
}
