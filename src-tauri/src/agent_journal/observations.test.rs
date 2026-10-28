// WI-AL1.2 — observational capture: pending observations queued and linearized in order, concurrent observations and gaps
//! WI-AL0.8 (writer half) — observational capture: pendingObservation queued
//! behind a reservation, H → B1 → B2 chains across crash and replay,
//! concurrentObservation dual bases.

use super::test_support::*;
use crate::agent_journal::ids::{BlobHash, DocId, TxnId};
use crate::agent_journal::projection::{RevisionKind, TxnStatus};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{ReviewEffects, ReviewOp};
use crate::agent_journal::writer::{Journaled, LinearizeRequest, ObserveRequest, Writer};

fn save(w: &Writer, doc: DocId, text: &str, parent: ObservedRef) -> TxnId {
    let out = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: text.into(),
            observed_parent: parent,
            provenance: None,
        })
        .unwrap();
    assert_eq!(out.journaled, Journaled::Pending);
    out.observation
}

/// Linearize the oldest pending capture, which must hold `post`. These
/// captures carry no provenance, so each is a `snapshotOnly` barrier (R21);
/// the effects are derived the way the writer derives them.
fn linearize(w: &Writer, doc: DocId, post: &str) -> crate::agent_journal::writer::Linearized {
    let s = w.snapshot().state;
    let obs = s.docs[&doc].pending[0];
    assert_eq!(s.observations[&obs].postimage, BlobHash::of_text(post));
    super::test_support::linearize(w, doc)
}

fn reopen(dir: &std::path::Path) -> Writer {
    Writer::open(config(dir, crate::agent_journal::journal_file::SyncPolicy::Full).0)
        .unwrap()
        .0
}

#[test]
fn h_b1_b2_queued_behind_a_reservation_survive_crash_and_keep_their_chain() {
    let dir = tmp();
    let doc = DocId::new();
    let (h, b1, b2, c) = {
        let (w, _) = open(dir.path());
        let (_, h) = agent_change(
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
            .prepare(prepare_req(doc, Some(h), "H", ReviewOp::Review))
            .unwrap();
        let b1 = save(&w, doc, "H1", ObservedRef::Revision { revision: h });
        let busy = w.linearize_next(
            doc,
            LinearizeRequest {
                expected_head: Some(h),
                effects: Default::default(),
            },
        );
        assert_eq!(
            busy.unwrap_err().code(),
            "JOURNAL_BUSY",
            "queued behind the reservation"
        );
        let b2 = save(&w, doc, "H12", ObservedRef::Pending { observation: b1 });
        let c = w
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
            .unwrap()
            .revision;
        (h, b1, b2, c)
        // crash: dropped before linearization
    };
    let w = reopen(dir.path());
    assert_eq!(
        w.pending_observations(doc),
        vec![b1, b2],
        "replayed in order"
    );
    let l1 = linearize(&w, doc, "H1");
    let l2 = linearize(&w, doc, "H12");
    let s = w.snapshot().state;
    let (r1, r2) = (&s.revisions[&l1.revision], &s.revisions[&l2.revision]);
    assert_eq!(
        (r1.kind, r1.parent),
        (RevisionKind::Concurrent, Some(c)),
        "C landed first: B1 is concurrent"
    );
    assert_eq!(
        s.observations[&b1].observed_parent,
        ObservedRef::Revision { revision: h }
    );
    assert_eq!(
        (r2.kind, r2.parent),
        (RevisionKind::Observed, Some(l1.revision))
    );
    assert_eq!(
        r2.preimage,
        Some(BlobHash::of_text("H1")),
        "B2's attributed before-text is B1, not H"
    );
    assert_eq!(
        r1.preimage,
        Some(BlobHash::of_text("H")),
        "B1's attributed before-text is H"
    );
    assert!(w.pending_observations(doc).is_empty());
}

#[test]
fn chain_survives_a_crash_before_the_controlled_commit_too() {
    let dir = tmp();
    let doc = DocId::new();
    let (b1, prep) = {
        let (w, _) = open(dir.path());
        let (_, h) = agent_change(
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
            .prepare(prepare_req(doc, Some(h), "H", ReviewOp::Review))
            .unwrap();
        let b1 = save(&w, doc, "H1", ObservedRef::Revision { revision: h });
        save(&w, doc, "H12", ObservedRef::Pending { observation: b1 });
        (b1, p.txn)
    };
    let w = reopen(dir.path());
    assert_eq!(
        w.snapshot().state.txns[&prep].status,
        TxnStatus::Uncommitted
    );
    let l1 = linearize(&w, doc, "H1");
    let l2 = linearize(&w, doc, "H12");
    let s = w.snapshot().state;
    assert_eq!(
        s.revisions[&l1.revision].kind,
        RevisionKind::Observed,
        "nothing landed between: ordinary"
    );
    assert_eq!(s.revisions[&l2.revision].kind, RevisionKind::Observed);
    assert_eq!(
        s.revisions[&l2.revision].preimage,
        Some(BlobHash::of_text("H1"))
    );
    assert_eq!(s.observations[&b1].linearized, Some(l1.revision));
}

#[test]
fn save_during_a_held_prepare_lands_after_the_commit_with_both_bases() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (_, h) = agent_change(
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
        .prepare(prepare_req(doc, Some(h), "H", ReviewOp::Review))
        .unwrap();
    let b = save(&w, doc, "Hb", ObservedRef::Revision { revision: h });
    let c = w
        .commit(
            p.txn,
            commit_req(
                &w,
                doc,
                "Hc",
                Edit {
                    at: 1,
                    delete: 0,
                    insert: 1,
                },
                vec![],
            ),
        )
        .unwrap()
        .revision;
    let l = linearize(&w, doc, "Hb");
    let s = w.snapshot().state;
    let rev = &s.revisions[&l.revision];
    assert_eq!(rev.kind, RevisionKind::Concurrent);
    assert_eq!(
        rev.parent,
        Some(c),
        "linear parent: what review/revert/export use"
    );
    assert_eq!(
        rev.preimage,
        Some(BlobHash::of_text("H")),
        "observed before-text: what attribution uses"
    );
    assert_eq!(
        s.observations[&b].observed_parent,
        ObservedRef::Revision { revision: h }
    );
    assert_eq!(
        rev.review_op,
        ReviewOp::None,
        "a human save creates no hunk"
    );
    assert_eq!(s.docs[&doc].head, Some(l.revision));
}

#[test]
fn observation_without_reservation_linearizes_as_ordinary_and_genesis_works() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    save(&w, doc, "", ObservedRef::Genesis);
    let l = linearize(&w, doc, "");
    let s = w.snapshot().state;
    assert_eq!(
        (
            s.revisions[&l.revision].kind,
            s.revisions[&l.revision].parent
        ),
        (RevisionKind::Observed, None)
    );
    assert_eq!(
        s.revisions[&l.revision].preimage,
        Some(BlobHash::of_text(""))
    );
}

#[test]
fn linearize_with_a_stale_head_is_refused_and_nothing_pending_is_none() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    assert!(w
        .linearize_next(
            doc,
            LinearizeRequest {
                expected_head: None,
                effects: Default::default()
            }
        )
        .unwrap()
        .is_none());
    let (_, h) = agent_change(
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
    save(&w, doc, "Hx", ObservedRef::Revision { revision: h });
    let err = w
        .linearize_next(
            doc,
            LinearizeRequest {
                expected_head: None,
                effects: Default::default(),
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "STALE_PARENT");
    assert_eq!(
        w.pending_observations(doc).len(),
        1,
        "still durably pending"
    );
}

#[test]
fn an_unknown_observed_parent_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let err = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "x".into(),
            observed_parent: ObservedRef::Pending {
                observation: TxnId::new(),
            },
            provenance: None,
        })
        .unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST");
}

#[test]
fn capture_append_failure_reports_journaled_no_and_queues() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    faults.fail_next_appends(1);
    let out = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "x".into(),
            observed_parent: ObservedRef::Genesis,
            provenance: None,
        })
        .unwrap();
    assert_eq!(out.journaled, Journaled::No);
    assert!(w.is_degraded(doc));
    assert!(
        w.pins().blobs.contains(&BlobHash::of_text("x")),
        "queued capture is a root"
    );
    assert!(w.retry_degraded(doc).unwrap());
    assert_eq!(w.pending_observations(doc), vec![out.observation]);
}

#[test]
fn a_capture_naming_a_queued_capture_queues_behind_it_and_drains_in_order() {
    let dir = tmp();
    let doc = DocId::new();
    let (first, second) = {
        let (w, faults) = open(dir.path());
        faults.fail_next_appends(1);
        let first = w
            .observe(ObserveRequest {
                doc,
                actor: human(),
                initiator: human(),
                postimage: "a".into(),
                observed_parent: ObservedRef::Genesis,
                provenance: None,
            })
            .unwrap();
        assert_eq!(first.journaled, Journaled::No);
        let second = w
            .observe(ObserveRequest {
                doc,
                actor: human(),
                initiator: human(),
                postimage: "ab".into(),
                observed_parent: ObservedRef::Pending {
                    observation: first.observation,
                },
                provenance: None,
            })
            .unwrap();
        assert_eq!(
            second.journaled,
            Journaled::No,
            "queued behind the earlier capture, never ahead of it"
        );
        assert!(w.pending_observations(doc).is_empty());
        assert!(w.retry_degraded(doc).unwrap());
        assert_eq!(
            w.pending_observations(doc),
            vec![first.observation, second.observation]
        );
        (first.observation, second.observation)
    };
    let w = reopen(dir.path());
    assert_eq!(w.pending_observations(doc), vec![first, second]);
    linearize(&w, doc, "a");
    let l2 = linearize(&w, doc, "ab");
    let s = w.snapshot().state;
    assert_eq!(s.revisions[&l2.revision].kind, RevisionKind::Observed);
    assert_eq!(
        s.revisions[&l2.revision].preimage,
        Some(BlobHash::of_text("a"))
    );
}

#[test]
fn cjk_and_emoji_postimages_validate_utf16_spans() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    // "中🙂" is 3 UTF-16 units; the hunk covers the emoji (units 1..3).
    human_save(&w, doc, "中");
    let (_, h) = agent_change(
        &w,
        doc,
        "中",
        "中🙂",
        Edit {
            at: 1,
            delete: 0,
            insert: 2,
        },
    );
    save(&w, doc, "中🙂文", ObservedRef::Revision { revision: h });
    let l = linearize(&w, doc, "中🙂文");
    assert_eq!(w.head(doc), Some(l.revision));
    // A span that splits a surrogate pair is refused.
    save(
        &w,
        doc,
        "中🙂文!",
        ObservedRef::Revision {
            revision: l.revision,
        },
    );
    let id = hunk_ids(&w, doc)[0].clone();
    let bad = crate::agent_journal::review::MappedSpan {
        hunk_id: id,
        range: r(1, 2),
        edited_since: false,
        growing: false,
        block: None,
        last_certified: None,
    };
    let err = w
        .linearize_next(
            doc,
            LinearizeRequest {
                expected_head: w.head(doc),
                effects: ReviewEffects {
                    spans: vec![bad],
                    ..Default::default()
                },
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST");
}

/// See `review_gen.test.rs`: a refused record is corruption and changes
/// nothing.
fn refused_untouched(
    records: &[crate::agent_journal::record::Envelope],
    at: usize,
    tampered: &crate::agent_journal::record::Envelope,
) {
    let mut p = crate::agent_journal::projection::Projection::default();
    for e in &records[..at] {
        p.apply(e).expect("a clean prefix replays");
    }
    let before = p.clone();
    let got = p.apply(tampered);
    assert!(
        matches!(got, Err(crate::agent_journal::errors::TxnError::Corrupt(_))),
        "{got:?}"
    );
    assert_eq!(p, before, "a refused record changes nothing");
}

#[test]
fn linearization_replay_checks_its_bindings_before_changing_anything() {
    use crate::agent_journal::record::Record;
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "one");
    let obs = observe(&w, doc, "two", None);
    linearize(&w, doc, "two");
    let snap = w.snapshot().state;
    let pending = snap.observations[&obs].clone();
    let records = w.debug_records();
    let at = records
        .iter()
        .rposition(|e| matches!(e.record, Record::ObservedRevision { .. }))
        .expect("a linearization");
    let Record::ObservedRevision {
        revision,
        parent,
        effects,
    } = records[at].record.clone()
    else {
        unreachable!()
    };
    let with = |record: Record| {
        let mut e = records[at].clone();
        e.record = record;
        e
    };
    // The parent must be the document's head.
    refused_untouched(
        &records,
        at,
        &with(Record::ObservedRevision {
            revision,
            parent: Some(crate::agent_journal::ids::RevisionId::new()),
            effects: effects.clone(),
        }),
    );
    // A concurrent record repeats the observation's bases exactly.
    let concurrent = |observed_parent: ObservedRef, observed_preimage: BlobHash| {
        with(Record::ConcurrentObservation {
            revision,
            parent,
            observed_parent,
            observed_preimage,
            effects: effects.clone(),
        })
    };
    // Built on the head, it linearizes as observed: even matching bases
    // cannot make it concurrent (`projection_replay.test.rs` checks the
    // bases of a genuinely concurrent one).
    refused_untouched(
        &records,
        at,
        &concurrent(
            pending.observed_parent.clone(),
            pending.observed_preimage.clone(),
        ),
    );
    refused_untouched(
        &records,
        at,
        &concurrent(ObservedRef::Genesis, pending.observed_preimage.clone()),
    );
    refused_untouched(
        &records,
        at,
        &concurrent(pending.observed_parent.clone(), BlobHash::of_text("other")),
    );
    // An effect naming an unknown hunk leaves the observation pending.
    let mut bad = effects.clone();
    bad.transitions
        .push(crate::agent_journal::review::HunkTransition {
            hunk_id: crate::agent_journal::ids::HunkId("h-unknown".into()),
            expected_review_gen: 0,
            to: crate::agent_journal::review::HunkState::Superseded,
        });
    refused_untouched(
        &records,
        at,
        &with(Record::ObservedRevision {
            revision,
            parent,
            effects: bad,
        }),
    );
}

#[test]
fn a_commit_whose_effects_fail_registers_no_revision() {
    use crate::agent_journal::record::Record;
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    agent_change(&w, doc, "", "X", diff_edit("", "X"));
    let records = w.debug_records();
    let at = records
        .iter()
        .rposition(|e| matches!(e.record, Record::Committed { .. }))
        .expect("a commit");
    let mut e = records[at].clone();
    if let Record::Committed { effects, .. } = &mut e.record {
        let dup = effects.new_hunks[0].clone();
        effects.new_hunks.push(dup);
    }
    refused_untouched(&records, at, &e);
}
