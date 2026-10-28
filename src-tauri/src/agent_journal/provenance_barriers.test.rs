// WI-AL1.2 — provenance barriers: sticky blocks, whole-document writes block older hunks, AMBIGUOUS_REVERT refused before prepare with nothing changed
//! WI-AL0.8 (R20–R23) — barrier semantics through the writer, mirroring the
//! TypeScript barrier probe. A block is sticky: no later certified
//! edit, base-text equality, keep/un-keep or revert of another hunk clears
//! it. A blocked revert is `AMBIGUOUS_REVERT` before prepare, with nothing
//! changed. Bounded breaks block only the hunks they may reach.

use super::test_review_helpers::{decide, revert_planned, state};
use super::test_support::*;
use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::provenance::{
    Block, BreakReason, Provenance, ProvenancePayload, PROVENANCE_CAP,
};
use crate::agent_journal::record::Record;
use crate::agent_journal::review::{
    HunkKind, HunkState, LastCertified, Range, ReviewAction, ReviewOp,
};
use crate::agent_journal::writer::Writer;

const BASE: &str = "a\nbeta\nc\ndelta\ne\n";
const AGENT: &str = "a\nBETA\nc\nDELTA\ne\n";

fn block(reason: BreakReason, origin: &str) -> Option<Block> {
    Some(Block::new(reason, origin).unwrap())
}

/// A certified agent revision `head → post` through `edits`, one hunk per
/// (base range, target range).
fn agent_edit(
    w: &Writer,
    doc: DocId,
    post: &str,
    edits: &[Edit],
    items: &[(Range, Range)],
) -> Vec<HunkId> {
    let (head, pre) = (w.head(doc), head_text(w, doc));
    let p = w
        .prepare(prepare_req(doc, head, &pre, ReviewOp::Review))
        .unwrap();
    let hunks: Vec<_> = items
        .iter()
        .map(|(b, t)| hunk(head, p.revision, &pre, post, *b, *t, HunkKind::Change))
        .collect();
    let ids = hunks.iter().map(|h| h.id.clone()).collect();
    w.commit(
        p.txn,
        commit_req_op(w, doc, post, edits, hunks, &ReviewOp::Review),
    )
    .unwrap();
    ids
}

/// Two hunks: line 1 (beta → BETA) and line 3 (delta → DELTA).
fn two(w: &Writer, doc: DocId) -> (HunkId, HunkId) {
    human_save(w, doc, BASE);
    let ids = agent_edit(
        w,
        doc,
        AGENT,
        &[
            Edit {
                at: 2,
                delete: 4,
                insert: 4,
            },
            Edit {
                at: 9,
                delete: 5,
                insert: 5,
            },
        ],
        &[(r(2, 6), r(2, 6)), (r(9, 14), r(9, 14))],
    );
    (ids[0].clone(), ids[1].clone())
}

/// A human capture of `post` mapped by `win` (built over the head text), linearized.
fn capture_window(w: &Writer, doc: DocId, post: &str, win: &Provenance) {
    let epoch = ensure_epoch(w, doc).to_string();
    let p = ProvenancePayload::encode(
        &doc.to_string(),
        &epoch,
        &basis(w.head(doc)),
        &head_text(w, doc),
        post,
        win,
    )
    .unwrap();
    observe(w, doc, post, Some(p));
    linearize(w, doc);
}

fn span_block(w: &Writer, doc: DocId, id: &HunkId) -> Option<Block> {
    w.snapshot().state.docs[&doc].hunks[id].span.block.clone()
}

/// The revert is refused AMBIGUOUS_REVERT, by plan and by prepare, naming
/// the block; the projection and the journal are unchanged.
fn expect_ambiguous(w: &Writer, doc: DocId, id: &HunkId, reason: BreakReason) {
    let (before, len) = (w.snapshot(), w.journal_len());
    let err = w.plan_revert(doc, id).unwrap_err();
    assert_eq!(err.code(), "AMBIGUOUS_REVERT");
    assert!(
        matches!(&err, crate::agent_journal::errors::TxnError::AmbiguousRevert { block: Some(b), .. } if b.reason == reason),
        "{err:?}"
    );
    let op = ReviewOp::HunkRevert {
        hunk_id: id.clone(),
        expected_review_gen: state(w, doc, id).1,
    };
    assert_eq!(
        w.prepare(prepare_req(doc, w.head(doc), &head_text(w, doc), op))
            .unwrap_err()
            .code(),
        "AMBIGUOUS_REVERT"
    );
    assert_eq!(
        (w.snapshot(), w.journal_len()),
        (before, len),
        "nothing changed: no generation, no record, no reservation"
    );
}

#[test]
fn no_later_certified_edit_base_text_equality_keep_or_unkeep_clears_a_block() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (h1, h2) = two(&w, doc);
    let parent = w.head(doc).unwrap();
    snapshot_save(&w, doc, AGENT); // the same text, snapshot only: still a barrier
    let snap = block(BreakReason::SnapshotOnly, "snapshot");
    assert_eq!(
        (span_block(&w, doc, &h1), span_block(&w, doc, &h2)),
        (snap.clone(), snap.clone())
    );
    let last = w.snapshot().state.docs[&doc].hunks[&h1].span.last_certified;
    assert_eq!(
        last,
        Some(LastCertified {
            at: parent,
            range: r(2, 6)
        }),
        "the last certified span is kept for display"
    );
    human_edit(
        &w,
        doc,
        "a\nbeta\nc\nDELTA\ne\n",
        &[Edit {
            at: 2,
            delete: 4,
            insert: 4,
        }],
    ); // base text typed back
    assert_eq!(
        state(&w, doc, &h1).0,
        HunkState::Pending,
        "no resolvedByHumanEdit across a break"
    );
    decide(&w, doc, ReviewAction::Keep, &[(&h1, 0)]).unwrap();
    decide(&w, doc, ReviewAction::Unkeep, &[(&h1, 1)]).unwrap();
    agent_edit(
        &w,
        doc,
        "A\nbeta\nc\nDELTA\ne\n",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
        &[(r(0, 1), r(0, 1))],
    );
    assert_eq!(span_block(&w, doc, &h1), snap);
    assert_eq!(
        w.snapshot().state.docs[&doc].hunks[&h1].span.last_certified,
        last,
        "lastCertified is not moved"
    );
    expect_ambiguous(&w, doc, &h1, BreakReason::SnapshotOnly);
    expect_ambiguous(&w, doc, &h2, BreakReason::SnapshotOnly);
    let spans = w
        .debug_records()
        .into_iter()
        .rev()
        .find_map(|e| match e.record {
            Record::Committed { effects, .. } => Some(effects.spans),
            _ => None,
        })
        .unwrap();
    assert!(
        spans
            .iter()
            .filter(|s| s.hunk_id == h1 || s.hunk_id == h2)
            .all(|s| s.block == snap),
        "persisted with reason and origin"
    );
}

#[test]
fn the_first_reason_wins_a_later_whole_document_write_does_not_overwrite_it() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (h1, _) = two(&w, doc);
    let n = AGENT.encode_utf16().count() as i64;
    let mut reload = Provenance::new(n, PROVENANCE_CAP).unwrap();
    reload
        .break_whole(n, BreakReason::ExternalReload, "watcher")
        .unwrap();
    capture_window(&w, doc, AGENT, &reload);
    let (head, pre) = (w.head(doc), head_text(&w, doc));
    let p = w
        .prepare(prepare_req(doc, head, &pre, ReviewOp::Review))
        .unwrap();
    w.commit(
        p.txn,
        barrier_commit_req(&w, doc, "a\nBETA\nc\nDELTA\nE\n", vec![], &ReviewOp::Review),
    )
    .unwrap();
    assert_eq!(
        span_block(&w, doc, &h1),
        block(BreakReason::ExternalReload, "watcher")
    );
}

#[test]
fn a_whole_document_controlled_write_blocks_every_older_hunk() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (h1, h2) = two(&w, doc);
    let (head, pre) = (w.head(doc), head_text(&w, doc));
    let p = w
        .prepare(prepare_req(doc, head, &pre, ReviewOp::Review))
        .unwrap();
    w.commit(
        p.txn,
        barrier_commit_req(&w, doc, "a\nBETA\nc\nDELTA\nE\n", vec![], &ReviewOp::Review),
    )
    .unwrap();
    let whole = block(BreakReason::WholeDocumentWrite, "agent");
    assert_eq!(
        (span_block(&w, doc, &h1), span_block(&w, doc, &h2)),
        (whole.clone(), whole)
    );
    assert_eq!(
        (state(&w, doc, &h1).0, state(&w, doc, &h2).0),
        (HunkState::Pending, HunkState::Pending),
        "a blocked hunk is never superseded"
    );
    expect_ambiguous(&w, doc, &h1, BreakReason::WholeDocumentWrite);
}

#[test]
fn a_reverted_hunk_whose_span_is_later_blocked_refuses_its_revert_of_revert() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (h1, _) = two(&w, doc);
    assert_eq!(
        revert_planned(&w, doc, &h1).unwrap(),
        "a\nbeta\nc\nDELTA\ne\n"
    );
    snapshot_save(&w, doc, &head_text(&w, doc));
    assert_eq!(state(&w, doc, &h1).0, HunkState::Reverted);
    expect_ambiguous(&w, doc, &h1, BreakReason::SnapshotOnly);
}

#[test]
fn a_hunk_created_after_the_break_reverts_and_the_blocked_one_does_not() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (h1, _) = two(&w, doc);
    snapshot_save(&w, doc, AGENT);
    let h3 = agent_edit(
        &w,
        doc,
        "a\nBETA\nc\nDELTA\nE\n",
        &[Edit {
            at: 15,
            delete: 1,
            insert: 1,
        }],
        &[(r(15, 16), r(15, 16))],
    );
    assert_eq!(revert_planned(&w, doc, &h3[0]).unwrap(), AGENT);
    expect_ambiguous(&w, doc, &h1, BreakReason::SnapshotOnly);
}

#[test]
fn an_uncertified_range_on_line_3_blocks_only_hunk_2_and_hunk_1_reverts_exactly() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (h1, h2) = two(&w, doc);
    let mut win = window(
        AGENT,
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    );
    win.break_range(9, 14, 5, BreakReason::UncertifiedRange, "user")
        .unwrap();
    capture_window(&w, doc, "A\nBETA\nc\nDeLTA\ne\n", &win);
    let span = w.snapshot().state.docs[&doc].hunks[&h1].span.clone();
    assert_eq!((span.range, span.block), (r(2, 6), None));
    assert_eq!(
        span_block(&w, doc, &h2),
        block(BreakReason::UncertifiedRange, "user")
    );
    assert_eq!(
        revert_planned(&w, doc, &h1).unwrap(),
        "A\nbeta\nc\nDeLTA\ne\n"
    );
    expect_ambiguous(&w, doc, &h2, BreakReason::UncertifiedRange);
}

#[test]
fn cjk_emoji_rtl_a_bounded_break_beside_a_hunk_does_not_block_it_one_touching_it_does() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "你好\n👋🏽 wave\nשלום\n");
    let post = "你好世界\n👋🏽 wave\nשלום עולם\n";
    let ids = agent_edit(
        &w,
        doc,
        post,
        &[
            Edit {
                at: 2,
                delete: 0,
                insert: 2,
            },
            Edit {
                at: 19,
                delete: 0,
                insert: 5,
            },
        ],
        &[(r(2, 2), r(2, 4)), (r(17, 17), r(19, 24))],
    );
    let mut emoji = Provenance::new(25, PROVENANCE_CAP).unwrap();
    emoji
        .break_range(5, 9, 2, BreakReason::UncertifiedRange, "user")
        .unwrap(); // the emoji line, between the hunks
    capture_window(&w, doc, "你好世界\n🙂 wave\nשלום עולם\n", &emoji);
    assert_eq!(
        (span_block(&w, doc, &ids[0]), span_block(&w, doc, &ids[1])),
        (None, None)
    );
    let mut inside = Provenance::new(23, PROVENANCE_CAP).unwrap();
    inside
        .break_range(3, 4, 1, BreakReason::UncertifiedRange, "user")
        .unwrap(); // inside hunk 1's "世界"
    capture_window(&w, doc, "你好世地\n🙂 wave\nשלום עולם\n", &inside);
    assert_eq!(
        span_block(&w, doc, &ids[0]),
        block(BreakReason::UncertifiedRange, "user")
    );
    assert_eq!(
        revert_planned(&w, doc, &ids[1]).unwrap(),
        "你好世地\n🙂 wave\nשלום\n"
    );
}

#[test]
fn more_disjoint_edits_than_the_cap_in_one_window_is_a_cap_overflow_barrier() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let n = PROVENANCE_CAP;
    let base = format!("{}\ntail\n", "x".repeat(4 * n as usize));
    human_save(&w, doc, &base);
    let at = 4 * n + 1;
    let post = base.replace("tail", "TAIL");
    let h = agent_edit(
        &w,
        doc,
        &post,
        &[Edit {
            at,
            delete: 4,
            insert: 4,
        }],
        &[(r(at, at + 4), r(at, at + 4))],
    );
    let edits: Vec<_> = (0..n)
        .map(|k| Edit {
            at: 4 * (n - 1 - k),
            delete: 1,
            insert: 0,
        })
        .collect(); // right to left
    let text = format!("{}\nTAIL\n", "xxx".repeat(n as usize));
    human_edit(&w, doc, &text, &edits);
    assert_eq!(
        span_block(&w, doc, &h[0]),
        block(BreakReason::CapOverflow, "accumulator")
    );
    expect_ambiguous(&w, doc, &h[0], BreakReason::CapOverflow);
}

#[test]
fn blocked_hunks_refuse_conflicted_and_capture_transitions() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (h1, _) = two(&w, doc);
    snapshot_save(&w, doc, AGENT);
    let err = decide(&w, doc, ReviewAction::Conflicted, &[(&h1, 0)]).unwrap_err();
    assert_eq!(
        err.code(),
        "AMBIGUOUS_REVERT",
        "a blocked revert is not a conflict"
    );
    // A capture that claims a transition on a blocked hunk is refused.
    certified_capture_and_claim(&w, doc, &h1);
}

fn certified_capture_and_claim(w: &Writer, doc: DocId, id: &HunkId) {
    super::test_review_helpers::certified_capture(
        w,
        doc,
        "a\nbeta\nc\nDELTA\ne\n",
        &[Edit {
            at: 2,
            delete: 4,
            insert: 4,
        }],
    );
    let mut effects = linearize_effects(w, doc);
    assert!(
        effects.transitions.is_empty(),
        "derived: nothing is inferred across a break"
    );
    effects
        .transitions
        .push(crate::agent_journal::review::HunkTransition {
            hunk_id: id.clone(),
            expected_review_gen: 0,
            to: HunkState::ResolvedByHumanEdit,
        });
    let req = crate::agent_journal::writer::LinearizeRequest {
        expected_head: w.head(doc),
        effects,
    };
    assert_eq!(
        w.linearize_next(doc, req).unwrap_err().code(),
        "INVALID_REQUEST"
    );
}

#[test]
fn planning_a_revert_is_pure_and_an_edge_neighbour_does_not_block_it() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "abc");
    let a = agent_edit(
        &w,
        doc,
        "aBc",
        &[Edit {
            at: 1,
            delete: 1,
            insert: 1,
        }],
        &[(r(1, 2), r(1, 2))],
    );
    let c = agent_edit(
        &w,
        doc,
        "aBC",
        &[Edit {
            at: 2,
            delete: 1,
            insert: 1,
        }],
        &[(r(2, 3), r(2, 3))],
    );
    let (before, len) = (w.snapshot(), w.journal_len());
    w.plan_revert(doc, &a[0]).unwrap();
    assert_eq!(
        (w.snapshot(), w.journal_len()),
        (before, len),
        "planning is pure"
    );
    assert_eq!(revert_planned(&w, doc, &a[0]).unwrap(), "abC");
    assert_eq!(
        state(&w, doc, &c[0]).0,
        HunkState::Pending,
        "the neighbour is untouched"
    );
}

#[test]
fn two_live_deletion_anchors_at_one_offset_are_ambiguous_without_a_block() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "abc");
    let a = agent_edit(
        &w,
        doc,
        "bc",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 0,
        }],
        &[(r(0, 1), r(0, 0))],
    );
    let b = agent_edit(
        &w,
        doc,
        "c",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 0,
        }],
        &[(r(0, 1), r(0, 0))],
    );
    let s = w.snapshot().state;
    let (sa, sb) = (&s.docs[&doc].hunks[&a[0]], &s.docs[&doc].hunks[&b[0]]);
    assert_eq!(
        (sa.state, sa.span.range, sb.span.range),
        (HunkState::Pending, r(0, 0), r(0, 0)),
        "both anchors live at 0"
    );
    for id in [&a[0], &b[0]] {
        let (before, len) = (w.snapshot(), w.journal_len());
        let err = w.plan_revert(doc, id).unwrap_err();
        assert_eq!(
            err,
            crate::agent_journal::errors::TxnError::AmbiguousRevert {
                hunk: id.clone(),
                block: None
            }
        );
        assert_eq!((w.snapshot(), w.journal_len()), (before, len));
    }
}
