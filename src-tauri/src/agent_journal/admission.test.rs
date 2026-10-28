// WI-AL1.2 — hunk-slot admission ported into the app journal: 500 agent / 600 restore non-settled hunks, refusals write nothing
//! WI-AL0.8 (writer half) — hunk-slot admission: 500 for agent changes, 600
//! for restores, the last-slot race, count-neutral hunk reverts, restore
//! blocking (never superseding) everything older in one record (R21).

use std::sync::{Arc, Barrier};

use super::test_support::*;
use crate::agent_journal::errors::{TxnError, RETRY_AFTER_USER_REVIEW};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::provenance::{Block, BreakReason};
use crate::agent_journal::review::{HunkKind, HunkState, RestoreSource, ReviewOp};
use crate::agent_journal::writer::Writer;

fn count(w: &Writer, doc: DocId) -> usize {
    w.snapshot().state.docs[&doc].non_settled()
}

/// Restore the head's parent, whose text differs from the head only in the
/// trailing marker (R1: the restored text must be the source text).
fn restore_op(w: &Writer, doc: DocId) -> ReviewOp {
    let s = w.snapshot().state;
    let parent = s.revisions[&w.head(doc).unwrap()].parent.unwrap();
    ReviewOp::Restore {
        source: RestoreSource::Revision { revision: parent },
    }
}

/// Toggle the trailing marker char with a restore; adds one restore item.
fn restore_once(w: &Writer, doc: DocId, text: &mut String) -> Result<(), TxnError> {
    let n = text.encode_utf16().count() as u64;
    let next = if text.ends_with('z') {
        format!("{}w", &text[..text.len() - 1])
    } else {
        format!("{}z", &text[..text.len() - 1])
    };
    let op = restore_op(w, doc);
    let p = w.prepare(prepare_req(doc, w.head(doc), text, op.clone()))?;
    let item = hunk(
        w.head(doc),
        p.revision,
        text,
        &next,
        r(n - 1, n),
        r(n - 1, n),
        HunkKind::Restore,
    );
    w.commit(p.txn, barrier_commit_req(w, doc, &next, vec![item], &op))?;
    *text = next;
    Ok(())
}

/// `n` hunks over "x…x" followed by a marker char outside every hunk,
/// saved by hand as "…w" and then "…z" (so the head's parent is a restore
/// source with the other marker).
fn seeded(w: &Writer, doc: DocId, n: u64) -> String {
    let text = seed_hunks(w, doc, n);
    let mut post = String::new();
    for marker in ['w', 'z'] {
        post = format!("{text}{marker}");
        human_save(w, doc, &post);
    }
    post
}

#[test]
fn at_500_an_agent_change_is_refused_at_prepare_but_human_saves_record() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let text = seeded(&w, doc, 500);
    let gen = w.snapshot().generation;
    let err = w
        .prepare(prepare_req(doc, w.head(doc), &text, ReviewOp::Review))
        .unwrap_err();
    assert_eq!(
        err,
        TxnError::ReviewBacklogFull {
            count: 500,
            limit: 500,
            retry: RETRY_AFTER_USER_REVIEW
        }
    );
    assert_eq!(w.snapshot().generation, gen, "nothing mutated");
    let post = format!("{text}!");
    human_save(&w, doc, &post);
    assert_eq!(count(&w, doc), 500);
}

#[test]
fn with_one_free_slot_a_large_change_is_one_coarse_hunk() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let text = seeded(&w, doc, 499);
    let n = text.len() as u64;
    let post = format!("{text}{}", "q".repeat(501));
    let p = w
        .prepare(prepare_req(doc, w.head(doc), &text, ReviewOp::Review))
        .unwrap();
    let split: Vec<_> = (0..2)
        .map(|i| {
            hunk(
                w.head(doc),
                p.revision,
                &text,
                &post,
                r(n, n),
                r(n + i, n + i + 1),
                HunkKind::Change,
            )
        })
        .collect();
    let err = w
        .commit(
            p.txn,
            commit_req(
                &w,
                doc,
                &post,
                Edit {
                    at: n,
                    delete: 0,
                    insert: 501,
                },
                split,
            ),
        )
        .unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST", "more hunks than free slots");
    let coarse = hunk(
        w.head(doc),
        p.revision,
        &text,
        &post,
        r(n, n),
        r(n, n + 501),
        HunkKind::LargeChange,
    );
    w.commit(
        p.txn,
        commit_req(
            &w,
            doc,
            &post,
            Edit {
                at: n,
                delete: 0,
                insert: 501,
            },
            vec![coarse],
        ),
    )
    .unwrap();
    assert_eq!(count(&w, doc), 500);
}

#[test]
fn two_windows_racing_for_the_last_slot_exactly_one_is_accepted() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let w = Arc::new(w);
    let doc = DocId::new();
    let text = Arc::new(seeded(&w, doc, 499));
    let bar = Arc::new(Barrier::new(2));
    let head = w.head(doc);
    let hs: Vec<_> = (0..2)
        .map(|_| {
            let (w, bar, text) = (w.clone(), bar.clone(), text.clone());
            std::thread::spawn(move || {
                bar.wait();
                w.prepare(prepare_req(doc, head, &text, ReviewOp::Review))
            })
        })
        .collect();
    let res: Vec<_> = hs.into_iter().map(|h| h.join().unwrap()).collect();
    let winner = res
        .iter()
        .find_map(|r| r.as_ref().ok().copied())
        .expect("one accepted");
    assert_eq!(res.iter().filter(|r| r.is_err()).count(), 1);
    assert_eq!(
        res.iter().find_map(|r| r.as_ref().err()).unwrap().code(),
        "JOURNAL_BUSY"
    );
    let n = text.len() as u64;
    let post = format!("{text}k");
    let h = hunk(
        head,
        winner.revision,
        &text,
        &post,
        r(n, n),
        r(n, n + 1),
        HunkKind::Change,
    );
    w.commit(
        winner.txn,
        commit_req(
            &w,
            doc,
            &post,
            Edit {
                at: n,
                delete: 0,
                insert: 1,
            },
            vec![h],
        ),
    )
    .unwrap();
    let err = w
        .prepare(prepare_req(doc, w.head(doc), &post, ReviewOp::Review))
        .unwrap_err();
    assert_eq!(
        err.code(),
        "REVIEW_BACKLOG_FULL",
        "the loser's retry meets the cap"
    );
}

#[test]
fn a_hunk_revert_at_500_succeeds_and_the_count_stays_500() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let text = seeded(&w, doc, 500);
    let id = hunk_ids(&w, doc)[0].clone();
    let post = super::test_review_helpers::revert_planned(&w, doc, &id).unwrap();
    assert_eq!(
        (post.len(), post.matches('y').count()),
        (text.len(), 1),
        "exactly the hunk's base char is put back"
    );
    assert_eq!(count(&w, doc), 500);
    assert_eq!(
        w.snapshot().state.docs[&doc].hunks[&id].state,
        HunkState::Reverted
    );
}

#[test]
fn restores_are_admitted_to_600_and_refused_at_600_with_nothing_mutated() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let mut text = seeded(&w, doc, 500);
    for _ in 0..99 {
        restore_once(&w, doc, &mut text).unwrap();
    }
    assert_eq!(count(&w, doc), 599);
    // Two concurrent restores at 599: the reservation admits one.
    let p = w
        .prepare(prepare_req(doc, w.head(doc), &text, restore_op(&w, doc)))
        .unwrap();
    assert_eq!(
        w.prepare(prepare_req(doc, w.head(doc), &text, restore_op(&w, doc)))
            .unwrap_err()
            .code(),
        "JOURNAL_BUSY"
    );
    w.abort(p.txn, "test").unwrap();
    restore_once(&w, doc, &mut text).unwrap();
    assert_eq!(count(&w, doc), 600);
    let gen = w.snapshot().generation;
    let err = restore_once(&w, doc, &mut text).unwrap_err();
    assert_eq!(
        err,
        TxnError::ReviewBacklogFull {
            count: 600,
            limit: 600,
            retry: RETRY_AFTER_USER_REVIEW
        }
    );
    assert_eq!(w.snapshot().generation, gen);
}

#[test]
fn restore_over_500_pending_hunks_blocks_them_in_one_record() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let text = seeded(&w, doc, 500);
    let op = restore_op(&w, doc);
    let p = w
        .prepare(prepare_req(doc, w.head(doc), &text, op.clone()))
        .unwrap();
    let post = format!("{}w", &text[..text.len() - 1]);
    let n = text.encode_utf16().count() as u64;
    let item = hunk(
        w.head(doc),
        p.revision,
        &text,
        &post,
        r(0, n),
        r(0, n),
        HunkKind::Restore,
    );
    let req = barrier_commit_req(&w, doc, &post, vec![item], &op);
    assert!(
        req.effects.transitions.is_empty(),
        "R21: a restore is a whole-document barrier; a blocked span is never claimed"
    );
    let gen = w.snapshot().generation;
    w.commit(p.txn, req).unwrap();
    assert_eq!(w.snapshot().generation, gen + 1);
    let s = w.snapshot().state;
    assert_eq!(s.docs[&doc].non_settled(), 501);
    let restore = Block::new(BreakReason::Restore, "restore").unwrap();
    let older = s.docs[&doc]
        .hunks
        .values()
        .filter(|h| h.hunk.kind == HunkKind::Change);
    assert!(older
        .clone()
        .all(|h| h.state == HunkState::Pending && h.span.block == Some(restore.clone())));
    assert_eq!(older.count(), 500);
}

#[test]
fn a_restore_must_create_exactly_one_restore_item() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    let text = seeded(&w, doc, 2);
    let op = restore_op(&w, doc);
    let p = w
        .prepare(prepare_req(doc, w.head(doc), &text, op.clone()))
        .unwrap();
    let post = format!("{}w", &text[..text.len() - 1]);
    let err = w
        .commit(p.txn, barrier_commit_req(&w, doc, &post, vec![], &op))
        .unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST", "{err:?}");
}
