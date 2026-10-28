// WI-AL1.2 — the single writer: two-window prepare CAS (JOURNAL_BUSY, STALE_PARENT), restart turns prepared into uncommitted, generation + broadcast, hydration gap refetch, legacy migration once
//! WI-AL0.2 — the single writer: reservation + parent CAS, terminal-append
//! failure (degraded), restart → `uncommitted`, `discarded` via maintenance
//! reservation, `committed { resolves }`, generation, restart projection.

use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::review::{HunkKind, RestoreSource, ReviewEffects, ReviewOp};
use crate::agent_journal::writer::{CommitRequest, Writer};

fn reopen(dir: &std::path::Path) -> (Writer, crate::agent_journal::writer::OpenReport) {
    Writer::open(config(dir, crate::agent_journal::journal_file::SyncPolicy::Full).0)
        .expect("reopen")
}

fn plain_commit(post: &str) -> CommitRequest {
    CommitRequest {
        provenance: None,
        postimage: post.into(),
        resolves: None,
        effects: ReviewEffects::default(),
    }
}

#[test]
fn prepare_takes_the_reservation_and_commit_advances_the_head() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let g0 = w.snapshot().generation;
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap();
    assert_eq!(p.generation, g0 + 1);
    assert_eq!(w.reservation(doc).map(|r| r.txn), Some(p.txn));
    let out = w.commit(p.txn, plain_commit("hello")).unwrap();
    assert!(out.applied && out.durable);
    assert_eq!(w.head(doc), Some(out.revision));
    assert_eq!(
        out.revision, p.revision,
        "the id minted at prepare is the revision"
    );
    assert!(w.reservation(doc).is_none());
    assert_eq!(w.snapshot().generation, g0 + 2);
}

#[test]
fn second_prepare_is_busy_and_a_stale_parent_returns_the_head() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap();
    let err = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap_err();
    assert_eq!(err.code(), "JOURNAL_BUSY");
    let gen = w.snapshot().generation;
    w.commit(p.txn, plain_commit("a")).unwrap();
    let err = w
        .prepare(prepare_req(doc, None, "a", ReviewOp::Review))
        .unwrap_err();
    assert_eq!(
        err,
        crate::agent_journal::errors::TxnError::StaleParent { head: w.head(doc) }
    );
    assert_eq!(w.snapshot().generation, gen + 1, "refusals append nothing");
}

#[test]
fn reservations_are_per_document() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let (a, b) = (DocId::new(), DocId::new());
    w.prepare(prepare_req(a, None, "", ReviewOp::Review))
        .unwrap();
    w.prepare(prepare_req(b, None, "", ReviewOp::Review))
        .expect("another document is free");
}

#[test]
fn abort_releases_and_leaves_the_head() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap();
    assert!(w.abort(p.txn, "user typed").unwrap().durable);
    assert!(w.reservation(doc).is_none());
    assert_eq!(w.head(doc), None);
    assert_eq!(w.snapshot().state.txns[&p.txn].status, TxnStatus::Aborted);
}

#[test]
fn commit_or_abort_of_an_unknown_or_finished_txn_is_invalid() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let p = w
        .prepare(prepare_req(doc, None, "", ReviewOp::Review))
        .unwrap();
    w.commit(p.txn, plain_commit("a")).unwrap();
    assert_eq!(
        w.commit(p.txn, plain_commit("b")).unwrap_err().code(),
        "INVALID_REQUEST"
    );
    assert_eq!(
        w.abort(p.txn, "late").unwrap_err().code(),
        "INVALID_REQUEST"
    );
    assert_eq!(
        w.abort(crate::agent_journal::ids::TxnId::new(), "x")
            .unwrap_err()
            .code(),
        "INVALID_REQUEST"
    );
}

#[test]
fn prepare_append_failure_rejects_with_nothing_changed() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    let before = w.snapshot();
    faults.fail_next_appends(1);
    assert_eq!(
        w.prepare(prepare_req(doc, None, "", ReviewOp::Review))
            .unwrap_err()
            .code(),
        "JOURNAL_IO"
    );
    assert!(w.reservation(doc).is_none());
    assert_eq!(w.snapshot(), before);
}

#[test]
fn restart_turns_unresolved_prepared_into_uncommitted_and_releases() {
    let dir = tmp();
    let doc = DocId::new();
    let txn = {
        let (w, _) = open(dir.path());
        let base = human_save(&w, doc, "pre");
        w.prepare(prepare_req(doc, Some(base), "pre", ReviewOp::Review))
            .unwrap()
            .txn
    };
    let (w, report) = reopen(dir.path());
    assert_eq!(report.uncommitted, vec![txn]);
    assert_eq!(w.snapshot().state.txns[&txn].status, TxnStatus::Uncommitted);
    assert!(w.reservation(doc).is_none(), "reservation released");
    let pins = w.pins();
    assert!(
        pins.blobs
            .contains(&crate::agent_journal::ids::BlobHash::of_text("pre")),
        "preimage stays pinned"
    );
    // A second restart does not append a second `uncommitted`.
    drop(w);
    let (_, again) = reopen(dir.path());
    assert!(again.uncommitted.is_empty());
}

#[test]
fn discard_uses_a_maintenance_reservation_and_unpins() {
    let dir = tmp();
    let doc = DocId::new();
    let txn = {
        let (w, _) = open(dir.path());
        let base = human_save(&w, doc, "pre");
        w.prepare(prepare_req(doc, Some(base), "pre", ReviewOp::Review))
            .unwrap()
            .txn
    };
    let (w, _) = reopen(dir.path());
    // While another transaction holds the document, discard is busy.
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "pre", ReviewOp::Review))
        .unwrap();
    assert_eq!(w.discard(txn).unwrap_err().code(), "JOURNAL_BUSY");
    w.abort(p.txn, "x").unwrap();
    assert!(w.discard(txn).unwrap().durable);
    assert!(w.reservation(doc).is_none());
    assert!(matches!(
        w.snapshot().state.txns[&txn].status,
        TxnStatus::Discarded { .. }
    ));
    // Its preimage is the head text (R3), so only the transaction root goes.
    assert!(
        !w.pins().reasons_for_txn(txn),
        "no longer an unresolved-transaction root"
    );
    assert_eq!(
        w.discard(txn).unwrap_err().code(),
        "INVALID_REQUEST",
        "only uncommitted can be discarded"
    );
}

#[test]
fn failed_discard_keeps_the_maintenance_reservation_until_drained() {
    let dir = tmp();
    let doc = DocId::new();
    let txn = {
        let (w, _) = open(dir.path());
        let base = human_save(&w, doc, "pre");
        w.prepare(prepare_req(doc, Some(base), "pre", ReviewOp::Review))
            .unwrap()
            .txn
    };
    let (w, faults) = {
        let (cfg, faults) = config(
            dir.path(),
            crate::agent_journal::journal_file::SyncPolicy::Full,
        );
        (Writer::open(cfg).unwrap().0, faults)
    };
    faults.fail_next_appends(1);
    assert!(!w.discard(txn).unwrap().durable);
    assert!(w.is_degraded(doc));
    assert_eq!(
        w.prepare(prepare_req(doc, w.head(doc), "pre", ReviewOp::Review))
            .unwrap_err()
            .code(),
        "JOURNAL_DEGRADED"
    );
    assert!(w.retry_degraded(doc).unwrap(), "drained");
    assert!(w.reservation(doc).is_none() && !w.is_degraded(doc));
    assert!(matches!(
        w.snapshot().state.txns[&txn].status,
        TxnStatus::Discarded { .. }
    ));
}

#[test]
fn restore_of_uncommitted_resolves_it_and_unpins_in_one_record() {
    let dir = tmp();
    let doc = DocId::new();
    let txn = {
        let (w, _) = open(dir.path());
        let base = human_save(&w, doc, "pre");
        w.prepare(prepare_req(doc, Some(base), "pre", ReviewOp::Review))
            .unwrap()
            .txn
    };
    let (w, _) = reopen(dir.path());
    let op = ReviewOp::Restore {
        source: RestoreSource::UncommittedPreimage { txn },
    };
    let current = human_save(&w, doc, "current");
    let p = w
        .prepare(prepare_req(doc, Some(current), "current", op))
        .unwrap();
    let item = hunk(
        Some(current),
        p.revision,
        "current",
        "pre",
        r(0, 7),
        r(0, 3),
        HunkKind::Restore,
    );
    let req = CommitRequest {
        postimage: "pre".into(),
        provenance: None,
        resolves: Some(txn),
        effects: ReviewEffects {
            new_hunks: vec![item],
            ..Default::default()
        },
    };
    let gen = w.snapshot().generation;
    w.commit(p.txn, req).unwrap();
    assert_eq!(
        w.snapshot().generation,
        gen + 1,
        "a single record resolves it"
    );
    assert_eq!(
        w.snapshot().state.txns[&txn].status,
        TxnStatus::Resolved { by: p.txn }
    );
    let pins = w.pins();
    assert!(
        pins.blobs
            .contains(&crate::agent_journal::ids::BlobHash::of_text("pre")),
        "pinned now as the head's postimage"
    );
    assert!(
        !pins.reasons_for_txn(txn),
        "no longer pinned as an unresolved transaction"
    );
}

#[test]
fn generations_are_monotonic_across_restart() {
    let dir = tmp();
    let doc = DocId::new();
    let g = {
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
        w.snapshot().generation
    };
    let (w, report) = reopen(dir.path());
    assert_eq!(
        report.unclosed_epochs.len(),
        1,
        "the armed epoch is recorded unclosed (R24)"
    );
    assert_eq!(
        w.snapshot().generation,
        g + 1,
        "one epochUnclosed record, at the next generation"
    );
    let g = g + 1;
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "a", ReviewOp::Review))
        .unwrap();
    assert_eq!(p.generation, g + 1);
}

#[test]
fn restart_projection_equals_live_projection() {
    let dir = tmp();
    let doc = DocId::new();
    let live = {
        let (w, _) = open(dir.path());
        agent_change(
            &w,
            doc,
            "",
            "ab",
            Edit {
                at: 0,
                delete: 0,
                insert: 2,
            },
        );
        let p = w
            .prepare(prepare_req(doc, w.head(doc), "ab", ReviewOp::Review))
            .unwrap();
        w.abort(p.txn, "x").unwrap();
        // A closed epoch: reopen appends nothing, so the projections match.
        w.close_epoch(doc, w.epoch(doc).unwrap()).unwrap();
        w.snapshot()
    };
    let (w, _) = reopen(dir.path());
    assert_eq!(w.snapshot(), live);
}

#[test]
fn a_future_format_record_refuses_the_open_and_appends_nothing() {
    let dir = tmp();
    let doc = DocId::new();
    {
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
        let v = serde_json::json!({"schemaVersion": crate::agent_journal::record::SCHEMA_VERSION + 1, "seq": 99, "txn": crate::agent_journal::ids::TxnId::new(), "at": 0, "record": {"kind": "fromTheFuture"}});
        w.debug_append_raw(&serde_json::to_vec(&v).unwrap())
            .unwrap();
    }
    let path = dir.path().join(JOURNAL_FILE);
    let before = std::fs::read(&path).unwrap();
    let err = Writer::open(config(dir.path(), SyncPolicy::Full).0)
        .err()
        .expect("a newer record turns the journal off");
    assert_eq!(err.code(), "JOURNAL_FUTURE_FORMAT");
    assert_eq!(std::fs::read(&path).unwrap(), before, "nothing appended");
}

#[test]
fn legacy_checkpoints_migrate_once_and_stay_outside_revision_chains() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let line = r#"{"id":"ck-1","tabId":"tab-3","filePath":null,"timestamp":5,"tool":"document.write","description":"","contentBefore":"old","revisionBefore":"a","revisionAfter":"b","byteSize":3}"#;
    assert_eq!(
        w.migrate_legacy(&[line, line]).unwrap(),
        1,
        "idempotent by legacy id"
    );
    let snap = w.snapshot();
    assert_eq!(snap.state.legacy.len(), 1);
    assert!(snap.state.revisions.is_empty() && snap.state.docs.is_empty());
    assert_eq!(
        w.blob_text(&crate::agent_journal::ids::BlobHash::of_text("old"))
            .unwrap(),
        "old"
    );
    assert!(w
        .pins()
        .blobs
        .contains(&crate::agent_journal::ids::BlobHash::of_text("old")));
}

#[test]
fn hydration_buffers_drops_old_generations_and_refetches_on_gap() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
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
    let mut view = crate::agent_journal::hydration::HydratedView::hydrate(&w);
    assert_eq!(view.state, w.snapshot().state);
    agent_change(
        &w,
        doc,
        "a",
        "ab",
        Edit {
            at: 1,
            delete: 0,
            insert: 1,
        },
    );
    view.pump(&w).unwrap();
    assert_eq!(
        (view.generation, view.refetches),
        (w.snapshot().generation, 0)
    );
    assert_eq!(view.state, w.snapshot().state);
    // Lose one broadcast: the next event reveals the gap and forces a refetch.
    faults.drop_next_broadcasts(1);
    agent_change(
        &w,
        doc,
        "ab",
        "abc",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    agent_change(
        &w,
        doc,
        "abc",
        "abcd",
        Edit {
            at: 3,
            delete: 0,
            insert: 1,
        },
    );
    view.pump(&w).unwrap();
    assert_eq!(view.refetches, 1);
    assert_eq!(view.state, w.snapshot().state);
    assert_eq!(view.generation, w.snapshot().generation);
}

#[test]
fn hydration_subscribes_before_the_snapshot_so_nothing_is_missed() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let w = std::sync::Arc::new(w);
    let doc = DocId::new();
    let bg = {
        let w = w.clone();
        std::thread::spawn(move || {
            let mut text = String::new();
            for i in 0..40u64 {
                let next = format!("{text}x");
                agent_change(
                    &w,
                    doc,
                    &text,
                    &next,
                    Edit {
                        at: i,
                        delete: 0,
                        insert: 1,
                    },
                );
                text = next;
            }
        })
    };
    let mut view = crate::agent_journal::hydration::HydratedView::hydrate(&w);
    bg.join().unwrap();
    view.pump(&w).unwrap();
    assert_eq!(view.state, w.snapshot().state);
    assert_eq!(
        view.refetches, 0,
        "buffered events ≤ snapshot generation were dropped, the rest applied in order"
    );
}
