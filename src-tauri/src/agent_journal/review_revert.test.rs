// WI-AL2.3 — hunk reverts against review state: a revert preserves a later disjoint human edit; a revert of a revert restores exactly after GC and a restart and leaves the hunk pending; settled is never reopened — restoring the text before settled hunks is one new pending item of its own
//! The ADR-AL8 state machine after a revert is itself reverted, and across
//! retention.

use crate::agent_journal::controlled::commit_controlled;
use crate::agent_journal::controlled_restore::{prepare_restore, RestorePrepareRequest};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::review::{HunkKind, HunkState, RestoreSource, ReviewAction};
use crate::agent_journal::test_review_helpers::{decide, revert, revert_planned, state, two_hunks};
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

#[test]
fn revert_preserves_a_later_disjoint_human_edit() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, b) = two_hunks(&w, doc);
    human_save(&w, doc, "xx and a human tail");
    let text = revert_planned(&w, doc, &a).expect("revert A");
    assert!(
        text.contains(" and a human tail"),
        "the human edit survives: {text:?}"
    );
    assert_eq!(text, "yx and a human tail");
    assert_eq!(head_text(&w, doc), "yx and a human tail");
    assert_eq!(state(&w, doc, &a).0, HunkState::Reverted);
    assert_eq!(
        state(&w, doc, &b).0,
        HunkState::Pending,
        "only its own hunk moves"
    );
}

#[test]
fn revert_of_a_revert_restores_exactly_across_a_restart() {
    let dir = tmp();
    let doc = DocId::new();
    let a = {
        let (w, _) = open(dir.path());
        let (a, _) = two_hunks(&w, doc);
        revert(&w, doc, &a, "xx", "yx").expect("revert A");
        for _ in 0..8 {
            let text = format!("{}z", head_text(&w, doc));
            human_save(&w, doc, &text);
        }
        let policy = GcPolicy {
            max_revisions: 4,
            ..GcPolicy::default()
        };
        assert!(!w.collect(&policy).expect("collect").collected.is_empty());
        if let Some(epoch) = w.epoch(doc) {
            w.close_epoch(doc, epoch).expect("close epoch");
        }
        a
    };
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::Full).0).expect("reopen");
    assert_eq!(state(&w, doc, &a).0, HunkState::Reverted);
    let back = revert(&w, doc, &a, "yxzzzzzzzz", "xxzzzzzzzz").expect("revert the revert");
    assert_eq!(w.head(doc), Some(back.revision));
    assert_eq!(head_text(&w, doc), "xxzzzzzzzz");
    assert_eq!(state(&w, doc, &a).0, HunkState::Pending);
}

#[test]
fn restoring_the_text_before_settled_hunks_is_a_new_pending_item() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let before = human_save(&w, doc, "yy");
    let (a, b) = two_hunks(&w, doc);
    decide(&w, doc, ReviewAction::Keep, &[(&a, 0), (&b, 0)]).expect("keep both");
    decide(&w, doc, ReviewAction::ClearReviewed, &[(&a, 1), (&b, 1)]).expect("clear reviewed");
    let p = prepare_restore(
        &w,
        doc,
        RestorePrepareRequest {
            doc_key: "path:/notes.md".into(),
            parent: w.head(doc),
            preimage: "xx".into(),
            source: RestoreSource::Revision { revision: before },
            baseline_provenance: None,
            baseline_touched: false,
            observed_parent: None,
            request_id: None,
            capture: None,
        },
    )
    .expect("prepare restore");
    let body = serde_json::json!({ "postimage": p.text }).to_string();
    commit_controlled(&w, p.txn, body.as_bytes()).expect("commit restore");
    assert_eq!(head_text(&w, doc), "yy");
    let s = w.snapshot().state;
    let hunks = &s.docs[&doc].hunks;
    assert_eq!(hunks.len(), 3, "exactly one new item");
    assert_eq!(
        (hunks[&a].state, hunks[&b].state),
        (HunkState::Settled, HunkState::Settled)
    );
    let new: Vec<_> = hunks
        .values()
        .filter(|h| h.hunk.target == p.revision)
        .collect();
    assert_eq!(new.len(), 1);
    assert_eq!(
        (new[0].hunk.kind, new[0].state),
        (HunkKind::Restore, HunkState::Pending)
    );
}
