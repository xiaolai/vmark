// WI-AL1.2 — editing epochs: durably armed, an unclosed epoch after a crash or restart is a barrier; worker payloads checked against document, epoch and basis
//! WI-AL0.2 / WI-AL0.8 (R22) — editing epochs and the capture lifecycle.
//! A worker map counts only under a durably armed epoch; an epoch still
//! armed at the next open becomes `epochUnclosed`, a barrier on every live
//! hunk even when the recovered text equals the saved text. A capture
//! whose observed base is not the linear parent is a `parentMismatch`
//! barrier. Payloads must name the document, the armed epoch and the basis.

use super::test_review_helpers::{revert_planned, two_hunks};
use super::test_support::*;
use crate::agent_journal::hydration::HydratedView;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::provenance::{Block, BreakReason, ProvenancePayload};
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::review::{HunkState, LastCertified, ReviewOp};
use crate::agent_journal::writer::{ObserveRequest, Writer};

fn reopen(dir: &std::path::Path) -> (Writer, crate::agent_journal::writer::OpenReport) {
    Writer::open(config(dir, SyncPolicy::Full).0).expect("reopen")
}

fn unclosed() -> Option<Block> {
    Some(Block::new(BreakReason::UnclosedEpoch, "restart").unwrap())
}

#[test]
fn epochs_arm_close_and_never_reuse_a_number() {
    let dir = tmp();
    let doc = DocId::new();
    {
        let (w, _) = open(dir.path());
        assert_eq!(w.epoch(doc), None);
        assert_eq!(w.arm_epoch(doc).unwrap(), 1);
        assert_eq!(
            w.arm_epoch(doc).unwrap_err().code(),
            "INVALID_REQUEST",
            "one open epoch per document"
        );
        assert_eq!(
            w.close_epoch(doc, 2).unwrap_err().code(),
            "INVALID_REQUEST",
            "CAS on the open epoch"
        );
        w.close_epoch(doc, 1).unwrap();
        assert_eq!(
            w.close_epoch(doc, 1).unwrap_err().code(),
            "INVALID_REQUEST",
            "closed once"
        );
        assert_eq!(w.arm_epoch(doc).unwrap(), 2);
        w.close_epoch(doc, 2).unwrap();
    }
    let (w, report) = reopen(dir.path());
    assert!(report.unclosed_epochs.is_empty(), "every epoch was closed");
    assert_eq!(w.arm_epoch(doc).unwrap(), 3, "the counter is persisted");
}

#[test]
fn an_unclosed_epoch_after_restart_blocks_every_live_hunk_even_with_equal_text() {
    let dir = tmp();
    let doc = DocId::new();
    let (head, a, b, epoch) = {
        let (w, _) = open(dir.path());
        let (a, b) = two_hunks(&w, doc);
        (w.head(doc).unwrap(), a, b, w.epoch(doc).unwrap())
        // crash: the epoch is never closed
    };
    let (w, report) = reopen(dir.path());
    assert_eq!(report.unclosed_epochs, vec![(doc, epoch)]);
    assert_eq!(
        head_text(&w, doc),
        "xx",
        "the recovered text equals the saved text"
    );
    let s = w.snapshot().state;
    for id in [&a, &b] {
        let span = &s.docs[&doc].hunks[id].span;
        assert_eq!(span.block, unclosed(), "{id:?}");
        assert_eq!(
            span.last_certified.map(|l| l.at),
            Some(head),
            "last certified at the head"
        );
    }
    assert_eq!(w.epoch(doc), None, "the unclosed epoch is no longer armed");
    let (before, len) = (w.snapshot(), w.journal_len());
    assert_eq!(
        w.plan_revert(doc, &a).unwrap_err().code(),
        "AMBIGUOUS_REVERT"
    );
    assert_eq!((w.snapshot(), w.journal_len()), (before, len));
    // Saving the same text under a new epoch does not clear it.
    human_save(&w, doc, "xx");
    assert_eq!(
        w.snapshot().state.docs[&doc].hunks[&a].span.block,
        unclosed()
    );
    assert_eq!(
        w.snapshot().state.docs[&doc].hunks[&a].state,
        HunkState::Pending
    );
}

#[test]
fn the_unclosed_record_is_appended_once_and_replays_to_the_same_projection() {
    let dir = tmp();
    let doc = DocId::new();
    {
        let (w, _) = open(dir.path());
        two_hunks(&w, doc);
    }
    let first = reopen(dir.path()).0.snapshot();
    let (w, report) = reopen(dir.path());
    assert!(
        report.unclosed_epochs.is_empty(),
        "already recorded unclosed"
    );
    assert_eq!(w.snapshot(), first, "replay reproduces the blocks");
    let unclosed_records = w
        .debug_records()
        .iter()
        .filter(|e| matches!(e.record, Record::EpochUnclosed { .. }))
        .count();
    assert_eq!(unclosed_records, 1);
    let view = HydratedView::hydrate(&w);
    assert_eq!(
        view.state,
        w.snapshot().state,
        "hydration carries blocks and epochs"
    );
}

#[test]
fn a_hunk_created_after_the_restart_is_certified_and_reverts() {
    let dir = tmp();
    let doc = DocId::new();
    {
        let (w, _) = open(dir.path());
        two_hunks(&w, doc);
    }
    let (w, _) = reopen(dir.path());
    let (_, h) = agent_change(
        &w,
        doc,
        "xx",
        "xxz",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    let id = w.snapshot().state.docs[&doc]
        .hunks
        .iter()
        .find(|(_, e)| e.hunk.target == h)
        .map(|(id, _)| id.clone())
        .unwrap();
    assert_eq!(revert_planned(&w, doc, &id).unwrap(), "xx");
}

#[test]
fn a_worker_payload_without_an_armed_epoch_or_naming_another_epoch_document_or_basis_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "ab");
    let epoch = w.epoch(doc).unwrap();
    let head = w.head(doc);
    let edit = [Edit {
        at: 2,
        delete: 0,
        insert: 1,
    }];
    let encode = |doc: DocId, epoch: u64, basis: &str, pre: &str| {
        ProvenancePayload::encode(
            &doc.to_string(),
            &epoch.to_string(),
            basis,
            pre,
            "abc",
            &window(pre, &edit),
        )
        .unwrap()
    };
    let try_observe = |p: ProvenancePayload| {
        let observed_parent = ObservedRef::Revision {
            revision: head.unwrap(),
        };
        w.observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "abc".into(),
            observed_parent,
            provenance: Some(p),
        })
    };
    let cases = [
        (
            "another document",
            encode(DocId::new(), epoch, &basis(head), "ab"),
        ),
        ("another epoch", encode(doc, epoch + 1, &basis(head), "ab")),
        ("another basis", encode(doc, epoch, "genesis", "ab")),
        (
            "another preimage",
            ProvenancePayload::encode(
                &doc.to_string(),
                &epoch.to_string(),
                &basis(head),
                "xy",
                "abc",
                &window("xy", &edit),
            )
            .unwrap(),
        ),
    ];
    let len = w.journal_len();
    for (what, p) in cases {
        assert_eq!(
            try_observe(p).unwrap_err().code(),
            "INVALID_REQUEST",
            "{what}"
        );
    }
    assert_eq!(
        w.journal_len(),
        len,
        "nothing appended by a refused capture"
    );
    w.close_epoch(doc, epoch).unwrap();
    let len = w.journal_len();
    assert_eq!(
        try_observe(encode(doc, epoch, &basis(head), "ab"))
            .unwrap_err()
            .code(),
        "INVALID_REQUEST",
        "no armed epoch"
    );
    assert_eq!(
        w.journal_len(),
        len,
        "nothing appended by a refused capture"
    );
    // The same rules hold for a controlled commit.
    let p = w
        .prepare(prepare_req(doc, head, "ab", ReviewOp::Review))
        .unwrap();
    let mut req = commit_req(&w, doc, "abc", edit[0], vec![]);
    req.provenance = Some(encode(doc, epoch, &basis(head), "ab"));
    assert_eq!(
        w.commit(p.txn, req).unwrap_err().code(),
        "INVALID_REQUEST",
        "a closed epoch"
    );
}

#[test]
fn a_capture_whose_observed_base_is_not_the_linear_parent_is_a_parent_mismatch_barrier() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (a, _) = two_hunks(&w, doc);
    let base = w.head(doc).unwrap();
    let p = w
        .prepare(prepare_req(doc, Some(base), "xx", ReviewOp::Review))
        .unwrap();
    // The human saves on the old head while the agent commit is in flight.
    let payload = payload(
        &w,
        doc,
        &basis(Some(base)),
        "xx",
        "xx!",
        &[Edit {
            at: 2,
            delete: 0,
            insert: 1,
        }],
    );
    observe(&w, doc, "xx!", Some(payload));
    w.commit(
        p.txn,
        commit_req(
            &w,
            doc,
            "xx?",
            Edit {
                at: 2,
                delete: 0,
                insert: 1,
            },
            vec![],
        ),
    )
    .unwrap();
    let parent = w.head(doc).unwrap();
    linearize(&w, doc);
    let span = w.snapshot().state.docs[&doc].hunks[&a].span.clone();
    assert_eq!(
        span.block,
        Some(Block::new(BreakReason::ParentMismatch, "concurrentObservation").unwrap())
    );
    assert_eq!(
        span.last_certified,
        Some(LastCertified {
            at: parent,
            range: r(0, 1)
        })
    );
}

#[test]
fn replay_refuses_an_epoch_armed_out_of_order_reused_or_closed_twice() {
    use crate::agent_journal::ids::TxnId;
    use crate::agent_journal::projection::Projection;
    use crate::agent_journal::record::{Envelope, SCHEMA_VERSION};
    let doc = DocId::new();
    let env = |seq, record| Envelope {
        schema_version: SCHEMA_VERSION,
        seq,
        txn: TxnId::new(),
        at: 0,
        record,
        receipt: None,
    };
    let armed = |epoch| Record::EpochArmed { doc, epoch };
    let corrupt = |p: &mut Projection, e: &Envelope| p.apply(e).unwrap_err().code();
    assert_eq!(
        corrupt(&mut Projection::default(), &env(1, armed(2))),
        "JOURNAL_CORRUPT",
        "epoch 1 skipped"
    );
    let mut p = Projection::default();
    p.apply(&env(1, armed(1))).unwrap();
    assert_eq!(
        corrupt(&mut p, &env(2, armed(2))),
        "JOURNAL_CORRUPT",
        "armed while 1 is open"
    );
    p.apply(&env(2, Record::EpochClosed { doc, epoch: 1 }))
        .unwrap();
    assert_eq!(
        corrupt(&mut p, &env(3, armed(1))),
        "JOURNAL_CORRUPT",
        "epoch 1 reused"
    );
    assert_eq!(
        corrupt(&mut p, &env(3, Record::EpochClosed { doc, epoch: 1 })),
        "JOURNAL_CORRUPT",
        "closed twice"
    );
    assert_eq!(
        corrupt(&mut p, &env(3, Record::EpochUnclosed { doc, epoch: 1 })),
        "JOURNAL_CORRUPT",
        "unclosed after close"
    );
    p.apply(&env(3, armed(2))).unwrap();
}
