// WI-AL1.2 — one review transition matrix shared with TypeScript
//! R9 — one transition matrix shared with TypeScript, with no
//! `reverted → conflicted`; a refused re-apply (revert of a revert that the
//! worker found conflicting) changes no content, no state, no `reviewGen`
//! and no journal generation.
//!
//! Edge cases: the refusal must come before any append (generation and
//! journal length equal), must not take a reservation, and must leave the
//! hunk's attached revert in place so a later, clean re-apply still works.

use super::test_review_helpers::*;
use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::review::{HunkState, ReviewAction};
use crate::agent_journal::review_rules::decision_target;

#[test]
fn the_rust_matrix_has_no_reverted_to_conflicted() {
    assert_eq!(
        decision_target(ReviewAction::Conflicted, HunkState::Reverted),
        None
    );
    assert_eq!(
        decision_target(ReviewAction::Conflicted, HunkState::Pending),
        Some(HunkState::Conflicted)
    );
}

#[test]
fn a_refused_re_apply_changes_nothing() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let reverted = revert(&w, doc, &a, "xx", "yx").unwrap().revision;
    let before = w.snapshot();
    let (len, head) = (w.journal_len(), w.head(doc));
    assert_eq!(state(&w, doc, &a), (HunkState::Reverted, 1));
    // The worker found the re-apply conflicting: it may not record that.
    let err = decide(&w, doc, ReviewAction::Conflicted, &[(&a, 1)]).unwrap_err();
    assert_eq!(err.code(), "STALE_REVIEW");
    assert_eq!(
        w.snapshot(),
        before,
        "state, reviewGen and generation unchanged"
    );
    assert_eq!(
        (w.journal_len(), w.head(doc)),
        (len, head),
        "nothing appended, content unchanged"
    );
    assert!(w.reservation(doc).is_none());
    let s = w.snapshot().state;
    assert_eq!(s.docs[&doc].hunks[&a].attached_revert, Some(reverted));
    // A clean re-apply later still works from the untouched state.
    revert(&w, doc, &a, "yx", "xx").unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::Pending, 2));
}

#[test]
fn revert_found_base_resolves_with_no_content_change() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    let head = w.head(doc);
    decide(&w, doc, ReviewAction::Conflicted, &[(&b, 0)]).unwrap();
    decide(&w, doc, ReviewAction::RevertFoundBase, &[(&a, 0), (&b, 1)]).unwrap();
    assert_eq!(state(&w, doc, &a), (HunkState::ResolvedByHumanEdit, 1));
    assert_eq!(state(&w, doc, &b), (HunkState::ResolvedByHumanEdit, 2));
    assert_eq!(w.head(doc), head, "a review-only decision: no revision");
    // Not from a decided state, and held to the userToDecided bound.
    assert_eq!(
        decide(&w, doc, ReviewAction::RevertFoundBase, &[(&a, 1)])
            .unwrap_err()
            .code(),
        "STALE_REVIEW"
    );
    let dir = tmp();
    let (w, _) = open(dir.path());
    let (a, _) = two_hunks(&w, doc);
    w.debug_set_review_gen(doc, &a, MAX - 1);
    assert_eq!(
        decide(&w, doc, ReviewAction::RevertFoundBase, &[(&a, MAX - 1)])
            .unwrap_err()
            .code(),
        "REVIEW_STATE_EXHAUSTED"
    );
    w.debug_set_review_gen(doc, &a, MAX - 2);
    decide(&w, doc, ReviewAction::RevertFoundBase, &[(&a, MAX - 2)]).unwrap();
}

#[test]
fn a_capture_past_its_bound_is_an_invariant_failure_not_a_user_refusal() {
    use crate::agent_journal::record::ObservedRef;
    use crate::agent_journal::review::{HunkTransition, ReviewEffects};
    use crate::agent_journal::writer::{LinearizeRequest, ObserveRequest};
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    // Unreachable through the writer (entering pending needs ≤ MAX-3);
    // only the test seam can put an active hunk at MAX-1.
    w.debug_set_review_gen(doc, &a, MAX - 1);
    let head = w.head(doc);
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: "yx".into(),
        observed_parent: ObservedRef::Revision {
            revision: head.unwrap(),
        },
        provenance: None,
    })
    .unwrap();
    let before = w.journal_len();
    let effects = ReviewEffects {
        transitions: vec![HunkTransition {
            hunk_id: a.clone(),
            expected_review_gen: MAX - 1,
            to: HunkState::ResolvedByHumanEdit,
        }],
        spans: spans_for(
            &w,
            doc,
            "yx",
            Edit {
                at: 0,
                delete: 1,
                insert: 1,
            },
        ),
        ..Default::default()
    };
    let err = w
        .linearize_next(
            doc,
            LinearizeRequest {
                expected_head: head,
                effects,
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "INVARIANT_BROKEN");
    assert_eq!(w.journal_len(), before);
    assert_eq!(state(&w, doc, &a), (HunkState::Pending, MAX - 1));
}

/// A pure insertion's base text is `""`. Deleting the inserted text is a
/// human edit back to the base (an empty span); deleting it and typing
/// something else in its place leaves the span inverted, whose text is
/// unknown, so it is never taken for the empty base.
#[test]
fn a_deleted_and_retyped_insertion_is_not_resolved_by_human_edit() {
    let del = Edit {
        at: 1,
        delete: 2,
        insert: 0,
    };
    let retype = Edit {
        at: 1,
        delete: 0,
        insert: 1,
    };
    for (edits, text, want) in [
        (vec![del], "ab", HunkState::ResolvedByHumanEdit),
        (vec![del, retype], "aZb", HunkState::Pending),
    ] {
        let dir = tmp();
        let (w, _) = open(dir.path());
        let doc = DocId::new();
        human_save(&w, doc, "ab");
        let insert = Edit {
            at: 1,
            delete: 0,
            insert: 2,
        };
        agent_change(&w, doc, "ab", "aXYb", insert);
        let id = hunk_ids(&w, doc).pop().expect("the insertion hunk");
        human_edit(&w, doc, text, &edits);
        assert_eq!(state(&w, doc, &id).0, want, "{text}");
    }
}

/// The shared slot predicate answers as live preparation does: with the
/// agent slots full, a Review is refused even when it would add no hunk
/// (`check_prepare` refuses it at the same count).
#[test]
fn a_review_with_the_agent_slots_full_does_not_fit_even_without_new_hunks() {
    use crate::agent_journal::review::ReviewOp;
    use crate::agent_journal::review_rules::{new_hunks_fit, AGENT_SLOT_LIMIT};
    assert!(new_hunks_fit(&ReviewOp::Review, AGENT_SLOT_LIMIT - 1, &[]));
    assert!(!new_hunks_fit(&ReviewOp::Review, AGENT_SLOT_LIMIT, &[]));
    assert!(!new_hunks_fit(&ReviewOp::Review, AGENT_SLOT_LIMIT + 1, &[]));
}
