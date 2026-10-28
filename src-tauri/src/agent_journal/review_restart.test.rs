// WI-AL2.3 — per-hunk review state end to end across restart and GC: keep B of A and B then restart leaves only A pending; keep → GC → un-keep → the span still renders and the revert lands exactly; Clear reviewed settles and stays settled across GC and a restart
//! Review state is a journal fact: decisions, spans and `settled` survive
//! a restart and a collection unchanged.

use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::review::{HunkState, ReviewAction};
use crate::agent_journal::test_review_helpers::{decide, revert_planned, state, two_hunks};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

/// A clean shutdown: close the window's epoch (an open one would block
/// every span it certified at the restart), then reopen from disk.
fn restart(w: Writer, doc: DocId, dir: &std::path::Path) -> Writer {
    if let Some(epoch) = w.epoch(doc) {
        w.close_epoch(doc, epoch).expect("close epoch");
    }
    drop(w);
    Writer::open(config(dir, SyncPolicy::Full).0)
        .expect("reopen")
        .0
}

/// `n` human saves, each appending one `z` after the hunks: disjoint from them.
fn disjoint_saves(w: &Writer, doc: DocId, n: usize) {
    for _ in 0..n {
        let text = format!("{}z", head_text(w, doc));
        human_save(w, doc, &text);
    }
}

fn policy(max_revisions: usize) -> GcPolicy {
    GcPolicy {
        max_revisions,
        ..GcPolicy::default()
    }
}

#[test]
fn keep_b_of_a_and_b_then_restart_leaves_only_a_pending() {
    let dir = tmp();
    let doc = DocId::new();
    let (w, _) = open(dir.path());
    let (a, b) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&b, 0)]).expect("keep B");
    let w = restart(w, doc, dir.path());
    assert_eq!(state(&w, doc, &a), (HunkState::Pending, 0));
    assert_eq!(state(&w, doc, &b), (HunkState::Kept, 1));
    let pending: Vec<_> = w.snapshot().state.docs[&doc]
        .hunks
        .iter()
        .filter(|(_, h)| h.state == HunkState::Pending)
        .map(|(id, _)| id.clone())
        .collect();
    assert_eq!(pending, vec![a]);
}

#[test]
fn keep_then_gc_then_unkeep_then_render_and_revert() {
    let dir = tmp();
    let doc = DocId::new();
    let (w, _) = open(dir.path());
    let (a, _) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).expect("keep A");
    disjoint_saves(&w, doc, 8);
    let report = w.collect(&policy(4)).expect("collect");
    assert!(!report.collected.is_empty(), "the collection ran");
    let w = restart(w, doc, dir.path());
    decide(&w, doc, ReviewAction::Unkeep, &[(&a, 1)]).expect("un-keep A");
    assert_eq!(state(&w, doc, &a), (HunkState::Pending, 2));
    let span = &w.snapshot().state.docs[&doc].hunks[&a].span;
    assert_eq!(
        (span.range, span.edited_since, span.block.is_none()),
        (r(0, 1), false, true)
    );
    assert_eq!(revert_planned(&w, doc, &a).expect("revert A"), "yxzzzzzzzz");
    assert_eq!(head_text(&w, doc), "yxzzzzzzzz");
    assert_eq!(state(&w, doc, &a).0, HunkState::Reverted);
}

#[test]
fn clear_reviewed_settles_and_stays_settled_across_gc_and_restart() {
    let dir = tmp();
    let doc = DocId::new();
    let (w, _) = open(dir.path());
    let (a, b) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).expect("keep A");
    decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1)]).expect("clear reviewed");
    assert_eq!(state(&w, doc, &a), (HunkState::Settled, 2));
    disjoint_saves(&w, doc, 8);
    assert!(!w.collect(&policy(4)).expect("collect").collected.is_empty());
    let w = restart(w, doc, dir.path());
    assert_eq!(state(&w, doc, &a), (HunkState::Settled, 2));
    assert_eq!(state(&w, doc, &b), (HunkState::Pending, 0));
    assert_eq!(
        decide(&w, doc, ReviewAction::Unkeep, &[(&a, 2)])
            .unwrap_err()
            .code(),
        "STALE_REVIEW",
        "settled is never reopened"
    );
    assert_eq!(state(&w, doc, &a), (HunkState::Settled, 2));
}
