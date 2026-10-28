// WI-AL1.2 — one atomic revision record: postimage, hunks, spans and transitions land together or not at all
//! R7 — one atomic revision record. A commit's postimage, hunks, spans and
//! capture transitions land in ONE `committed` frame; there is no stage
//! between "content recorded" and "review effects recorded" for a crash
//! to fall into. A crash between protocol stages (after `prepared`, after
//! `pendingObservation`) leaves a state that reopens to exactly one
//! outcome, and repeated timeouts (abort, or a crash while prepared) leave
//! no residue.
//!
//! Edge cases: the same document timing out several times in a row, live
//! and across restarts; a timeout right after a pending observation; a
//! second restart appending nothing.

use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::projection::{RevisionKind, TxnStatus};
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::review::{HunkKind, ReviewEffects, ReviewOp};
use crate::agent_journal::writer::{LinearizeRequest, ObserveRequest, Writer};

fn reopen(dir: &std::path::Path) -> (Writer, crate::agent_journal::writer::OpenReport) {
    Writer::open(config(dir, SyncPolicy::Full).0).expect("reopen")
}

#[test]
fn a_commit_is_one_frame_carrying_content_and_review_effects() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    seed_hunks(&w, doc, 2);
    let head = w.head(doc);
    let p = w
        .prepare(prepare_req(doc, head, "xx", ReviewOp::Review))
        .unwrap();
    let before = w.debug_records().len();
    let new = hunk(
        head,
        p.revision,
        "xx",
        "zx",
        r(0, 1),
        r(0, 1),
        HunkKind::Change,
    );
    w.commit(
        p.txn,
        commit_req(
            &w,
            doc,
            "zx",
            Edit {
                at: 0,
                delete: 1,
                insert: 1,
            },
            vec![new.clone()],
        ),
    )
    .unwrap();
    let records = w.debug_records();
    assert_eq!(records.len(), before + 1, "exactly one record per commit");
    let Record::Committed { effects, .. } = &records.last().unwrap().record else {
        panic!("not a committed record")
    };
    assert_eq!(effects.new_hunks, vec![new]);
    assert_eq!(
        effects.spans.len(),
        2,
        "every live hunk's span rides in the same record"
    );
    drop(w);
    let (w, _) = reopen(dir.path());
    assert_eq!(w.snapshot().state.docs[&doc].hunks.len(), 3);
}

#[test]
fn a_crash_after_prepared_reopens_as_uncommitted_and_never_as_a_revision() {
    let dir = tmp();
    let doc = DocId::new();
    let txn = {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "base");
        w.prepare(prepare_req(doc, w.head(doc), "base", ReviewOp::Review))
            .unwrap()
            .txn
    };
    let (w, report) = reopen(dir.path());
    assert_eq!(report.uncommitted, vec![txn]);
    let s = w.snapshot().state;
    assert_eq!(s.txns[&txn].status, TxnStatus::Uncommitted);
    assert!(
        s.revisions.values().all(|m| m.txn != txn),
        "no revision for the crashed commit"
    );
    assert_eq!(head_text(&w, doc), "base");
    assert!(w.reservation(doc).is_none(), "nothing holds the document");
}

#[test]
fn a_crash_after_pending_observation_linearizes_exactly_once_after_reopen() {
    let dir = tmp();
    let doc = DocId::new();
    let obs = {
        let (w, _) = open(dir.path());
        w.observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "saved".into(),
            observed_parent: ObservedRef::Genesis,
            provenance: None,
        })
        .unwrap()
        .observation
    };
    let (w, report) = reopen(dir.path());
    assert_eq!(report.pending_observations, 1);
    let lin = w
        .linearize_next(
            doc,
            LinearizeRequest {
                expected_head: None,
                effects: ReviewEffects::default(),
            },
        )
        .unwrap()
        .unwrap();
    assert_eq!((lin.observation, lin.kind), (obs, RevisionKind::Observed));
    assert!(w
        .linearize_next(
            doc,
            LinearizeRequest {
                expected_head: w.head(doc),
                effects: ReviewEffects::default()
            }
        )
        .unwrap()
        .is_none());
    drop(w);
    let (w, report) = reopen(dir.path());
    assert_eq!(report.pending_observations, 0);
    assert_eq!(head_text(&w, doc), "saved");
}

#[test]
fn several_timeouts_in_a_row_leave_no_residue() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "base");
    let head = w.head(doc);
    let mut generation = w.snapshot().generation;
    for i in 0..5 {
        let p = w
            .prepare(prepare_req(doc, head, "base", ReviewOp::Review))
            .unwrap();
        assert_eq!(p.generation, generation + 1, "timeout {i}");
        w.abort(p.txn, "timeout").unwrap();
        generation += 2;
        assert!(
            w.reservation(doc).is_none(),
            "timeout {i} released the document"
        );
        assert_eq!(w.head(doc), head);
    }
    agent_change(
        &w,
        doc,
        "base",
        "base!",
        Edit {
            at: 4,
            delete: 0,
            insert: 1,
        },
    );
    assert_eq!(head_text(&w, doc), "base!");
}

#[test]
fn several_crashes_while_prepared_in_a_row_each_leave_one_uncommitted() {
    let dir = tmp();
    let doc = DocId::new();
    {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "base");
    }
    let mut crashed = Vec::new();
    for _ in 0..4 {
        let (w, report) = reopen(dir.path());
        assert_eq!(
            report.uncommitted,
            crashed.last().copied().into_iter().collect::<Vec<_>>(),
            "only the latest crash is new"
        );
        crashed.push(
            w.prepare(prepare_req(doc, w.head(doc), "base", ReviewOp::Review))
                .unwrap()
                .txn,
        );
    }
    let (w, _) = reopen(dir.path());
    let (w2, again) = {
        drop(w);
        reopen(dir.path())
    };
    assert!(
        again.uncommitted.is_empty(),
        "a second restart appends nothing"
    );
    let s = w2.snapshot().state;
    assert!(crashed
        .iter()
        .all(|t| s.txns[t].status == TxnStatus::Uncommitted));
    assert_eq!(head_text(&w2, doc), "base");
    // Still usable: the next agent change commits normally.
    agent_change(
        &w2,
        doc,
        "base",
        "based",
        Edit {
            at: 4,
            delete: 0,
            insert: 1,
        },
    );
}
