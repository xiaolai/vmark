// WI-AL1.2 — controlled-mutation races: two windows against one document, reservations held across failed terminal appends
//! WI-AL0.8 (writer half) — controlled-mutation races: two windows against
//! one document, failed `aborted` recovery, commit-failure degraded queue,
//! byte-level crash at the commit append.

use std::sync::{Arc, Barrier};

use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::{RevisionKind, TxnStatus};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{ReviewEffects, ReviewOp};
use crate::agent_journal::writer::{CommitRequest, LinearizeRequest, ObserveRequest, Writer};

#[test]
fn two_windows_prepare_against_one_document_exactly_one_is_accepted() {
    for _round in 0..20 {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let w = Arc::new(w);
        let doc = DocId::new();
        agent_change(
            &w,
            doc,
            "",
            "base",
            Edit {
                at: 0,
                delete: 0,
                insert: 4,
            },
        );
        let head = w.head(doc);
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let (w, barrier) = (w.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    w.prepare(prepare_req(doc, head, "base", ReviewOp::Review))
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let ok: Vec<_> = results.iter().filter_map(|r| r.as_ref().ok()).collect();
        assert_eq!(ok.len(), 1, "{results:?}");
        let err = results.iter().find_map(|r| r.as_ref().err()).unwrap();
        assert!(
            matches!(err.code(), "JOURNAL_BUSY" | "STALE_PARENT"),
            "{err:?}"
        );
        // The loser recomputes on the new head after the winner commits.
        w.commit(
            ok[0].txn,
            commit_req(
                &w,
                doc,
                "base!",
                Edit {
                    at: 4,
                    delete: 0,
                    insert: 1,
                },
                vec![],
            ),
        )
        .unwrap();
        let stale = w
            .prepare(prepare_req(doc, head, "base", ReviewOp::Review))
            .unwrap_err();
        assert_eq!(stale.code(), "STALE_PARENT");
    }
}

#[test]
fn many_windows_with_retries_keep_the_head_linear() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let w = Arc::new(w);
    let doc = DocId::new();
    let handles: Vec<_> = (0..8)
        .map(|t| {
            let w = w.clone();
            std::thread::spawn(move || {
                let mut done = 0;
                while done < 15 {
                    // Head and text are read in two steps: a racing commit in
                    // between makes the prepare STALE_PARENT, and it retries.
                    let head = w.head(doc);
                    let pre = head_text(&w, doc);
                    let Ok(p) = w.prepare(prepare_req(doc, head, &pre, ReviewOp::Review)) else {
                        continue;
                    };
                    let post = format!("t{t}-{done}");
                    w.commit(
                        p.txn,
                        CommitRequest {
                            provenance: None,
                            postimage: post,
                            resolves: None,
                            effects: Default::default(),
                        },
                    )
                    .unwrap();
                    done += 1;
                }
            })
        })
        .collect();
    handles.into_iter().for_each(|h| h.join().unwrap());
    let snap = w.snapshot();
    let mut revs: Vec<_> = snap
        .state
        .revisions
        .values()
        .filter(|r| r.doc == doc)
        .collect();
    revs.sort_by_key(|r| r.seq);
    assert_eq!(revs.len(), 120);
    let mut prev = None;
    for r in revs {
        assert_eq!(r.parent, prev, "no sibling revisions");
        prev = Some(r.id);
    }
    assert_eq!(snap.state.docs[&doc].head, prev);
}

#[test]
fn failed_aborted_keeps_the_reservation_and_recovers_without_restart() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap();
    faults.fail_next_appends(1);
    let out = w
        .abort(p.txn, "user typed")
        .expect("the refusal is still answered");
    assert!(!out.durable);
    assert!(w.is_degraded(doc));
    assert_eq!(
        w.reservation(doc).map(|r| r.txn),
        Some(p.txn),
        "reservation kept"
    );
    assert_eq!(
        w.prepare(prepare_req(doc, None, "", ReviewOp::Review))
            .unwrap_err()
            .code(),
        "JOURNAL_DEGRADED"
    );
    // Still failing: nothing changes, nothing is lost.
    faults.fail_next_appends(1);
    assert!(!w.retry_degraded(doc).unwrap());
    assert!(w.is_degraded(doc));
    assert!(w.retry_degraded(doc).unwrap());
    assert!(!w.is_degraded(doc) && w.reservation(doc).is_none());
    assert_eq!(w.snapshot().state.txns[&p.txn].status, TxnStatus::Aborted);
    w.prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .expect("usable again, no restart");
}

#[test]
fn commit_failure_degrades_drains_and_a_human_edit_chains_through_gap() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    agent_change(
        &w,
        doc,
        "",
        "H",
        Edit {
            at: 0,
            delete: 0,
            insert: 1,
        },
    );
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "H", ReviewOp::Review))
        .unwrap();
    faults.fail_next_appends(1);
    let out = w
        .commit(
            p.txn,
            commit_req(
                &w,
                doc,
                "HC",
                Edit {
                    at: 1,
                    delete: 0,
                    insert: 1,
                },
                vec![],
            ),
        )
        .unwrap();
    assert!(
        out.applied && !out.durable,
        "never a plain error after content changed"
    );
    assert!(w.is_degraded(doc));
    assert_eq!(
        w.prepare(prepare_req(doc, w.head(doc), "HC", ReviewOp::Review))
            .unwrap_err()
            .code(),
        "JOURNAL_DEGRADED"
    );
    assert!(
        w.pins()
            .blobs
            .contains(&crate::agent_journal::ids::BlobHash::of_text("HC")),
        "degraded entry pinned"
    );
    // The human keeps typing on the non-durable postimage and saves.
    let obs = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "HC!".into(),
            observed_parent: ObservedRef::Revision {
                revision: out.revision,
            },
            provenance: None,
        })
        .unwrap();
    let pending = &w.snapshot().state.observations[&obs.observation];
    assert_eq!(
        pending.observed_parent,
        ObservedRef::Unjournaled {
            revision: out.revision
        }
    );
    let early = w.linearize_next(
        doc,
        LinearizeRequest {
            expected_head: w.head(doc),
            effects: ReviewEffects::default(),
        },
    );
    assert_eq!(
        early.unwrap_err().code(),
        "JOURNAL_DEGRADED",
        "queued behind the undrained commit"
    );
    assert!(w.retry_degraded(doc).unwrap());
    assert_eq!(
        w.head(doc),
        Some(out.revision),
        "the queued commit landed first"
    );
    let lin = linearize(&w, doc);
    let snap = w.snapshot();
    let gap = crate::agent_journal::provenance::Block::new(
        crate::agent_journal::provenance::BreakReason::ParentMismatch,
        "gap",
    )
    .unwrap();
    assert!(
        snap.state.docs[&doc]
            .hunks
            .values()
            .all(|h| h.span.block == Some(gap.clone())),
        "a gap is a barrier (R21)"
    );
    let rev = &snap.state.revisions[&lin.revision];
    assert_eq!(rev.kind, RevisionKind::Gap);
    assert_eq!(rev.parent, Some(out.revision));
    assert_eq!(
        rev.preimage,
        Some(crate::agent_journal::ids::BlobHash::of_text("HC")),
        "exact before-text kept"
    );
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
    }
}

#[test]
fn crash_at_every_byte_of_the_commit_append_is_committed_or_uncommitted() {
    let dir = tmp();
    let doc = DocId::new();
    let (before, after, txn) = {
        let (w, _) = open(dir.path());
        agent_change(
            &w,
            doc,
            "",
            "a",
            Edit {
                at: 0,
                delete: 0,
                insert: 1,
            },
        );
        let p = w
            .prepare(prepare_req(doc, w.head(doc), "a", ReviewOp::Review))
            .unwrap();
        let before = w.journal_len();
        w.commit(
            p.txn,
            commit_req(
                &w,
                doc,
                "ab",
                Edit {
                    at: 1,
                    delete: 0,
                    insert: 1,
                },
                vec![],
            ),
        )
        .unwrap();
        (before, w.journal_len(), p.txn)
    };
    for cut in before..=after {
        let crash = tmp();
        copy_dir(dir.path(), crash.path());
        let f = std::fs::OpenOptions::new()
            .write(true)
            .open(crash.path().join(JOURNAL_FILE))
            .unwrap();
        f.set_len(cut).unwrap();
        let (w, _) = Writer::open(config(crash.path(), SyncPolicy::None).0).unwrap();
        let status = w.snapshot().state.txns[&txn].status.clone();
        if cut == after {
            assert_eq!(status, TxnStatus::Committed, "cut={cut}");
        } else {
            assert_eq!(status, TxnStatus::Uncommitted, "cut={cut}");
            assert!(w.reservation(doc).is_none());
        }
    }
}

/// R2: a commit whose blob write fails is queued with its text in memory
/// only. A human save captured on top of it must make BOTH texts durable
/// before the ack: after a crash the queued commit never lands, so the
/// observation's before-text exists nowhere else.
#[test]
fn blob_write_failure_then_human_save_then_crash_keeps_both_texts() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    agent_change(
        &w,
        doc,
        "",
        "H",
        Edit {
            at: 0,
            delete: 0,
            insert: 1,
        },
    );
    let survivor = w.head(doc);
    let p = w
        .prepare(prepare_req(doc, survivor, "H", ReviewOp::Review))
        .unwrap();
    faults.fail_next_blob_writes(1);
    let out = w
        .commit(
            p.txn,
            commit_req(
                &w,
                doc,
                "HC",
                Edit {
                    at: 1,
                    delete: 0,
                    insert: 1,
                },
                vec![],
            ),
        )
        .unwrap();
    assert!(out.applied && !out.durable);
    let obs = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "HC!".into(),
            observed_parent: ObservedRef::Revision {
                revision: out.revision,
            },
            provenance: None,
        })
        .unwrap();
    assert_eq!(
        obs.journaled,
        crate::agent_journal::writer::Journaled::Pending,
        "acked as durable"
    );
    drop(w); // crash before the queue drains
    let (w, report) = Writer::open(config(dir.path(), SyncPolicy::Full).0).unwrap();
    assert_eq!(
        report.uncommitted,
        vec![p.txn],
        "the queued commit never became durable"
    );
    assert_eq!(
        w.snapshot().state.txns[&p.txn].status,
        TxnStatus::Uncommitted
    );
    assert_eq!(w.head(doc), survivor);
    for text in ["HC", "HC!"] {
        assert_eq!(
            w.blob_text(&crate::agent_journal::ids::BlobHash::of_text(text))
                .unwrap(),
            text,
            "{text} readable after reopen"
        );
    }
    // The gap attaches to the surviving head; the observed origin stays separate.
    assert_eq!(w.head(doc), survivor);
    let lin = linearize(&w, doc);
    let snap = w.snapshot();
    let rev = &snap.state.revisions[&lin.revision];
    assert_eq!((rev.kind, rev.parent), (RevisionKind::Gap, survivor));
    assert_eq!(
        rev.preimage,
        Some(crate::agent_journal::ids::BlobHash::of_text("HC")),
        "attributed before-text = the lost commit's text"
    );
    assert_eq!(
        snap.state.observations[&obs.observation].observed_parent,
        ObservedRef::Unjournaled {
            revision: out.revision
        }
    );
}

/// R2 for a capture queued in memory behind another capture: when it
/// drains, its before-text (the earlier capture's postimage) is stored too.
#[test]
fn a_capture_built_on_a_genesis_or_queued_base_stores_every_referenced_text() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    faults.fail_next_appends(1);
    let first = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "one".into(),
            observed_parent: ObservedRef::Genesis,
            provenance: None,
        })
        .unwrap();
    assert_eq!(first.journaled, crate::agent_journal::writer::Journaled::No);
    let second = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "two".into(),
            observed_parent: ObservedRef::Pending {
                observation: first.observation,
            },
            provenance: None,
        })
        .unwrap();
    assert_eq!(
        second.journaled,
        crate::agent_journal::writer::Journaled::No,
        "behind the first"
    );
    assert!(w.retry_degraded(doc).unwrap());
    drop(w);
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::Full).0).unwrap();
    for text in ["", "one", "two"] {
        assert_eq!(
            w.blob_text(&crate::agent_journal::ids::BlobHash::of_text(text))
                .unwrap(),
            text,
            "{text:?} readable after reopen"
        );
    }
}
