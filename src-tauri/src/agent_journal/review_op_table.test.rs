// WI-AL2.3 — every hunk state × every reviewOp, through the writer: a `review` revision over a pending or conflicted hunk supersedes it and adds its own item; a `none` save leaves it "edited since" — even one deleting all of it — and resolves it (resolvedByHumanEdit) only when it types the base text back; a `restore` is a barrier that never moves it and adds exactly one item; a `hunkRevert` touches only its own hunk — a revert that would edit another non-settled hunk is conflicted — and adds none; decided and settled hunks never move
//! The ADR-AL8 effects table, end to end: one subject hunk A in each
//! state, one revision of each op over A's span, A's state and the item
//! count after it.

use crate::agent_journal::controlled::commit_controlled;
use crate::agent_journal::controlled_restore::{prepare_restore, RestorePrepareRequest};
use crate::agent_journal::ids::{DocId, HunkId, RevisionId};
use crate::agent_journal::revert_gate::RevertDecision;
use crate::agent_journal::review::{HunkState, RestoreSource, ReviewAction};
use crate::agent_journal::test_review_helpers::{decide, revert, state};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

#[derive(Debug, Clone, Copy)]
enum Op {
    Review,
    /// A human save editing part of A.
    NoneEdit,
    /// A human save deleting all of A (a change hunk: its base is not empty).
    NoneRemove,
    /// A human save typing A's base text `bc` back over it.
    NoneToBase,
    Restore,
    HunkRevert,
}

const STATES: [HunkState; 7] = [
    HunkState::Pending,
    HunkState::Kept,
    HunkState::Reverted,
    HunkState::Conflicted,
    HunkState::Superseded,
    HunkState::ResolvedByHumanEdit,
    HunkState::Settled,
];

const OPS: [Op; 6] = [
    Op::Review,
    Op::NoneEdit,
    Op::NoneRemove,
    Op::NoneToBase,
    Op::Restore,
    Op::HunkRevert,
];

/// "0000" (the restore source), then "abcd", then the agent hunk A:
/// `bc` → `XY` at [1, 3). Returns A and the restore source.
fn subject(w: &Writer, doc: DocId) -> (HunkId, RevisionId) {
    let source = human_save(w, doc, "0000");
    human_save(w, doc, "abcd");
    agent_change(
        w,
        doc,
        "abcd",
        "aXYd",
        Edit {
            at: 1,
            delete: 2,
            insert: 2,
        },
    );
    let a = hunk_ids(w, doc).pop().expect("A");
    (a, source)
}

/// Drive A into `s` by its real path.
fn into(w: &Writer, doc: DocId, a: &HunkId, s: HunkState) {
    match s {
        HunkState::Pending => {}
        HunkState::Kept => {
            decide(w, doc, ReviewAction::Keep, &[(a, 0)]).unwrap();
        }
        HunkState::Reverted => {
            revert(w, doc, a, "aXYd", "abcd").unwrap();
        }
        HunkState::Conflicted => {
            decide(w, doc, ReviewAction::Conflicted, &[(a, 0)]).unwrap();
        }
        HunkState::Superseded => {
            agent_change(
                w,
                doc,
                "aXYd",
                "aQYd",
                Edit {
                    at: 1,
                    delete: 1,
                    insert: 1,
                },
            );
        }
        HunkState::ResolvedByHumanEdit => {
            decide(w, doc, ReviewAction::RevertFoundBase, &[(a, 0)]).unwrap();
        }
        HunkState::Settled => {
            decide(w, doc, ReviewAction::Keep, &[(a, 0)]).unwrap();
            decide(w, doc, ReviewAction::ClearReviewed, &[(a, 1)]).unwrap();
        }
    }
    assert_eq!(state(w, doc, a).0, s, "setup");
}

/// Restore `source` over the head; returns the restore's revision.
fn restore(w: &Writer, doc: DocId, source: RevisionId) -> RevisionId {
    let p = prepare_restore(
        w,
        doc,
        RestorePrepareRequest {
            doc_key: "path:/notes.md".into(),
            parent: w.head(doc),
            preimage: head_text(w, doc),
            source: RestoreSource::Revision { revision: source },
            baseline_provenance: None,
            baseline_touched: false,
            observed_parent: None,
            request_id: None,
            capture: None,
        },
    )
    .expect("prepare restore");
    let body = serde_json::json!({ "postimage": p.text }).to_string();
    commit_controlled(w, p.txn, body.as_bytes()).expect("commit restore");
    p.revision
}

/// Replace the head's character at 1 with `c`.
fn at_one(w: &Writer, doc: DocId, c: char) -> String {
    let mut t: Vec<char> = head_text(w, doc).chars().collect();
    t[1] = c;
    t.into_iter().collect()
}

/// Apply `op` over A's span; `true` when a revert it ran was conflicted.
fn apply(w: &Writer, doc: DocId, a: &HunkId, op: Op, source: RevisionId) -> bool {
    let one = Edit {
        at: 1,
        delete: 1,
        insert: 1,
    };
    match op {
        Op::Review => {
            agent_change(w, doc, &head_text(w, doc), &at_one(w, doc, 'R'), one);
        }
        Op::NoneEdit => {
            human_edit(w, doc, &at_one(w, doc, 'H'), &[one]);
        }
        Op::NoneRemove => {
            let t = head_text(w, doc);
            human_edit(
                w,
                doc,
                &format!("{}{}", &t[..1], &t[3..]),
                &[Edit {
                    at: 1,
                    delete: 2,
                    insert: 0,
                }],
            );
        }
        Op::NoneToBase => {
            let t = head_text(w, doc);
            // A reverted A already shows its base: retype it in another case.
            let base = if &t[1..3] == "bc" { "BC" } else { "bc" };
            human_edit(
                w,
                doc,
                &format!("{}{base}{}", &t[..1], &t[3..]),
                &[Edit {
                    at: 1,
                    delete: 2,
                    insert: 2,
                }],
            );
        }
        Op::Restore => {
            restore(w, doc, source);
        }
        Op::HunkRevert => {
            // An agent hunk B over A, then a revert of B: it would edit A,
            // so it is conflicted unless A is settled — and A never moves.
            apply(w, doc, a, Op::Review, source);
            let b = hunk_ids(w, doc)
                .into_iter()
                .find(|id| state(w, doc, id).0 == HunkState::Pending && id != a);
            let b = b.expect("B");
            let before = state(w, doc, a);
            let decision = w.plan_revert(doc, &b).expect("plan").decision;
            let conflicted = match decision {
                RevertDecision::Apply { postimage, .. } => {
                    revert(w, doc, &b, &head_text(w, doc), &postimage).expect("revert B");
                    false
                }
                RevertDecision::Conflicted => {
                    decide(w, doc, ReviewAction::Conflicted, &[(&b, 0)]).expect("conflicted");
                    true
                }
                RevertDecision::FoundBase => panic!("B's text is in place"),
            };
            assert_eq!(state(w, doc, a), before, "a revert of B never moves A");
            return conflicted;
        }
    }
    false
}

/// A's state after `op` from `s` (a hunkRevert's B supersedes a live A first).
fn expected(op: Op, s: HunkState) -> HunkState {
    let live = matches!(s, HunkState::Pending | HunkState::Conflicted);
    match op {
        Op::Review | Op::HunkRevert if live => HunkState::Superseded,
        Op::NoneToBase if live => HunkState::ResolvedByHumanEdit,
        _ => s,
    }
}

/// Items `op` adds (a hunkRevert adds none; its B adds one before it).
fn added(op: Op) -> usize {
    match op {
        Op::Review | Op::Restore | Op::HunkRevert => 1,
        Op::NoneEdit | Op::NoneRemove | Op::NoneToBase => 0,
    }
}

#[test]
fn every_state_by_every_review_op() {
    for s in STATES {
        for op in OPS {
            let dir = tmp();
            let (w, _) = open_fast(dir.path());
            let doc = DocId::new();
            let (a, source) = subject(&w, doc);
            into(&w, doc, &a, s);
            let (review_gen, items) = (state(&w, doc, &a).1, hunk_ids(&w, doc).len());
            let conflicted = apply(&w, doc, &a, op, source);
            let after = state(&w, doc, &a);
            let case = format!("{s:?} × {op:?}");
            assert_eq!(after.0, expected(op, s), "{case}");
            assert_eq!(
                after.1,
                review_gen + u64::from(after.0 != s),
                "{case}: reviewGen"
            );
            assert_eq!(hunk_ids(&w, doc).len(), items + added(op), "{case}: items");
            if matches!(op, Op::HunkRevert) {
                assert_eq!(
                    conflicted,
                    s != HunkState::Settled,
                    "{case}: a revert over a live hunk"
                );
            }
            if matches!(op, Op::NoneEdit | Op::NoneRemove) && s != HunkState::Settled {
                let span = &w.snapshot().state.docs[&doc].hunks[&a].span;
                assert!(span.edited_since, "{case}: edited since");
            }
        }
    }
}
