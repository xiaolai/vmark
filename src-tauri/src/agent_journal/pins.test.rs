// WI-AL1.2 — pin projection: head, hunk base/target, latest revert, window bases and open uncommitted transactions are roots; prepared→aborted is unpinned
//! WI-AL0.2 pin projection and the WI-AL0.8 GC bound: only the
//! latest attached hunkRevert is a root (toggle 5,000 times → ≤ 3 pinned).
//! The collector itself is tested with the collector; here the pin set is
//! what a collector would keep.

use super::test_support::*;
use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::pins::PinReason;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{HunkState, ReviewAction, ReviewEffects, ReviewItem, ReviewOp};
use crate::agent_journal::writer::{CommitRequest, ObserveRequest, ReviewRequest, Writer};

fn has(w: &Writer, rev: crate::agent_journal::ids::RevisionId, reason: PinReason) -> bool {
    w.pins()
        .revisions
        .get(&rev)
        .is_some_and(|rs| rs.contains(&reason))
}

#[test]
fn roots_head_hunk_base_target_and_unresolved_transactions() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let (_, base) = agent_change(
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
    let (_, target) = agent_change(
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
    let ids = hunk_ids(&w, doc);
    assert!(has(&w, target, PinReason::Head));
    assert!(ids
        .iter()
        .any(|id| has(&w, base, PinReason::HunkBase(id.clone()))));
    assert!(ids
        .iter()
        .any(|id| has(&w, target, PinReason::HunkTarget(id.clone()))));
    // R3: a prepare over unsaved text is refused and pins nothing.
    let err = w
        .prepare(prepare_req(
            doc,
            w.head(doc),
            "ab-unsaved",
            ReviewOp::Review,
        ))
        .unwrap_err();
    assert_eq!(err.code(), "STALE_PARENT");
    assert!(w.pins().txns.is_empty());
    assert!(!w.pins().blobs.contains(&BlobHash::of_text("ab-unsaved")));
    // prepared → aborted pins nothing beyond revisions.
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "ab", ReviewOp::Review))
        .unwrap();
    assert!(w.pins().txns.contains(&p.txn));
    w.abort(p.txn, "x").unwrap();
    assert!(!w.pins().txns.contains(&p.txn));
}

#[test]
fn settling_releases_hunk_roots() {
    let dir = tmp();
    let (w, _) = open(dir.path());
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
    let (_, second) = agent_change(
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
    let id = hunk_ids(&w, doc)
        .into_iter()
        .find(|id| has(&w, second, PinReason::HunkTarget(id.clone())))
        .unwrap();
    for (action, gen) in [(ReviewAction::Keep, 0), (ReviewAction::ClearReviewed, 1)] {
        w.decide(ReviewRequest {
            doc,
            expected_head: w.head(doc),
            action,
            items: vec![ReviewItem {
                hunk_id: id.clone(),
                expected_review_gen: gen,
            }],
        })
        .unwrap();
    }
    assert!(!has(&w, second, PinReason::HunkTarget(id)));
    assert!(has(&w, second, PinReason::Head));
}

#[test]
fn pending_observations_and_live_window_bases_are_roots_until_restart() {
    let dir = tmp();
    let doc = DocId::new();
    {
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
        let (_, h2) = agent_change(
            &w,
            doc,
            "H",
            "H2",
            Edit {
                at: 1,
                delete: 0,
                insert: 1,
            },
        );
        w.register_window_base("win-1", doc, ObservedRef::Revision { revision: h });
        assert!(has(&w, h, PinReason::WindowBase("win-1".into())));
        let p = w
            .prepare(prepare_req(doc, Some(h2), "H2", ReviewOp::Review))
            .unwrap();
        let obs = w
            .observe(ObserveRequest {
                doc,
                actor: human(),
                initiator: human(),
                postimage: "H!".into(),
                observed_parent: ObservedRef::Revision { revision: h },
                provenance: None,
            })
            .unwrap();
        // The window's next save names the pending observation; the old root
        // is cleared only after the durable append (the caller does that).
        w.register_window_base(
            "win-1",
            doc,
            ObservedRef::Pending {
                observation: obs.observation,
            },
        );
        let pins = w.pins();
        assert!(pins.blobs.contains(&BlobHash::of_text("H!")));
        assert!(
            pins.blobs.contains(&BlobHash::of_text("H")),
            "observedPreimage of an unlinearized observation"
        );
        w.abort(p.txn, "x").unwrap();
    }
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::Full).0).unwrap();
    assert!(
        w.pins()
            .revisions
            .values()
            .flatten()
            .all(|r| !matches!(r, PinReason::WindowBase(_))),
        "no window survives a restart"
    );
    assert!(
        w.pins().blobs.contains(&BlobHash::of_text("H!")),
        "the pending observation itself still is a root"
    );
}

#[test]
fn toggling_one_hunk_revert_5000_times_retains_at_most_three_revisions_for_it() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    seed_hunks(&w, doc, 1);
    let id = hunk_ids(&w, doc)[0].clone();
    let mut text = "x".to_string();
    for i in 0..5000u64 {
        let next = if text == "x" { "y" } else { "x" }.to_string();
        let op = ReviewOp::HunkRevert {
            hunk_id: id.clone(),
            expected_review_gen: i,
        };
        let effects = w.plan_revert(doc, &id).unwrap().effects;
        let p = w.prepare(prepare_req(doc, w.head(doc), &text, op)).unwrap();
        w.commit(
            p.txn,
            CommitRequest {
                provenance: None,
                postimage: next.clone(),
                resolves: None,
                effects,
            },
        )
        .unwrap();
        text = next;
    }
    let h = w.snapshot().state.docs[&doc].hunks[&id].clone();
    assert_eq!((h.state, h.review_gen), (HunkState::Pending, 5000));
    let s = w.snapshot().state;
    let pins = w.pins();
    let retained: Vec<_> = s
        .revisions
        .values()
        .filter(|r| r.doc == doc && pins.revisions.contains_key(&r.id))
        .map(|r| r.id)
        .collect();
    assert!(retained.len() <= 3, "pinned {}", retained.len());
    assert!(retained.contains(&h.hunk.target) && retained.contains(&h.attached_revert.unwrap()));
    // Revert-of-revert still works after a clean restart (an unclosed
    // epoch would block it: provenance_epochs.test.rs).
    w.close_epoch(doc, w.epoch(doc).unwrap()).unwrap();
    drop(w);
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::None).0).unwrap();
    let op = ReviewOp::HunkRevert {
        hunk_id: id.clone(),
        expected_review_gen: 5000,
    };
    let effects = w.plan_revert(doc, &id).unwrap().effects;
    let p = w.prepare(prepare_req(doc, w.head(doc), &text, op)).unwrap();
    w.commit(
        p.txn,
        CommitRequest {
            provenance: None,
            postimage: "y".into(),
            resolves: None,
            effects,
        },
    )
    .unwrap();
    assert_eq!(
        w.snapshot().state.docs[&doc].hunks[&id].state,
        HunkState::Reverted
    );
}

#[test]
fn an_open_uncommitted_transaction_stays_pinned_across_restarts() {
    let dir = tmp();
    let doc = DocId::new();
    let txn = {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "saved");
        let p = w
            .prepare(prepare_req(doc, w.head(doc), "saved", ReviewOp::Review))
            .unwrap();
        // Crash with the transaction prepared: no commit, no abort.
        p.txn
    };
    for (start, turned) in [(1, vec![txn]), (2, vec![])] {
        let (w, report) = Writer::open(config(dir.path(), SyncPolicy::Full).0).unwrap();
        assert_eq!(report.uncommitted, turned, "start {start}");
        assert_eq!(
            w.snapshot().state.txns[&txn].status,
            crate::agent_journal::projection::TxnStatus::Uncommitted
        );
        let pins = w.pins();
        assert!(
            pins.txns.contains(&txn),
            "uncommitted is a root until resolved"
        );
        assert!(
            pins.blobs.contains(&BlobHash::of_text("saved")),
            "its preimage too"
        );
    }
}

/// R21 historical placement: a blocked hunk is drawn at `lastCertified`
/// (revision `at`, range in its coordinates), so that revision and its text
/// are roots while the hunk is live — through replay — and are released
/// once the hunk settles.
#[test]
fn the_last_certified_revision_of_every_live_blocked_hunk_is_a_root_until_it_settles() {
    let dir = tmp();
    let doc = DocId::new();
    let (id, certified) = {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "abc");
        agent_change(
            &w,
            doc,
            "abc",
            "aBc",
            Edit {
                at: 1,
                delete: 1,
                insert: 1,
            },
        );
        let id = hunk_ids(&w, doc)[0].clone();
        let certified = human_edit(
            &w,
            doc,
            "aBc!",
            &[Edit {
                at: 3,
                delete: 0,
                insert: 1,
            }],
        );
        snapshot_save(&w, doc, "ZZZ"); // snapshotOnly barrier: lastCertified.at = `certified`
        human_save(&w, doc, "ZZZ?");
        let span = w.snapshot().state.docs[&doc].hunks[&id].span.clone();
        assert!(span.block.is_some(), "the snapshot save blocks the hunk");
        assert_eq!(span.last_certified.map(|l| l.at), Some(certified));
        assert!(
            has(&w, certified, PinReason::LastCertified(id.clone())),
            "{:?}",
            w.pins().revisions
        );
        (id, certified)
    };
    let (w, _) = Writer::open(config(dir.path(), SyncPolicy::Full).0).unwrap();
    let s = w.snapshot().state;
    let lc = s.docs[&doc].hunks[&id]
        .span
        .last_certified
        .expect("lastCertified survives replay");
    assert_eq!(lc.at, certified);
    assert!(
        has(&w, certified, PinReason::LastCertified(id.clone())),
        "still a root after replay"
    );
    assert_eq!(
        w.blob_text(&s.revisions[&certified].postimage).unwrap(),
        "aBc!",
        "the highlight's text is readable after replay"
    );
    // Settling the hunk releases the root.
    for (action, gen) in [(ReviewAction::Keep, 0), (ReviewAction::ClearReviewed, 1)] {
        w.decide(ReviewRequest {
            doc,
            expected_head: w.head(doc),
            action,
            items: vec![ReviewItem {
                hunk_id: id.clone(),
                expected_review_gen: gen,
            }],
        })
        .unwrap();
    }
    assert!(!has(&w, certified, PinReason::LastCertified(id)));
}

#[test]
fn a_window_based_on_a_linearized_observation_pins_the_revision_it_became() {
    // WI-AL0.8 (Codex r7 N4): a frozen save names the pending observation it
    // was built on. Once that observation is linearized into r and the head
    // moves on, r is still the save's base (its `pre`): it must stay a root,
    // or a collector drops it and the save can no longer be captured.
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let lin = |w: &Writer| {
        let req = crate::agent_journal::writer::LinearizeRequest {
            expected_head: w.head(doc),
            effects: ReviewEffects::default(),
        };
        w.linearize_next(doc, req).unwrap().unwrap().revision
    };
    let save = |w: &Writer, text: &str, parent: ObservedRef| {
        w.observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: text.into(),
            observed_parent: parent,
            provenance: None,
        })
        .unwrap()
    };
    save(&w, "one", ObservedRef::Genesis);
    let first = lin(&w);
    let o = save(&w, "two", ObservedRef::Revision { revision: first }).observation;
    w.register_window_base("win-1", doc, ObservedRef::Pending { observation: o });
    let r = lin(&w);
    save(&w, "three", ObservedRef::Revision { revision: r });
    lin(&w); // the head moves past r
    assert!(
        has(&w, r, PinReason::WindowBase("win-1".into())),
        "the observation's revision is the window's base"
    );
    assert!(
        !w.pins().revisions.contains_key(&first),
        "the revision before it is not a root"
    );
    // The frozen save built on o is still capturable.
    save(&w, "two!", ObservedRef::Pending { observation: o });
    w.clear_window_base("win-1");
    assert!(
        !has(&w, r, PinReason::WindowBase("win-1".into())),
        "released once the window has nothing on it"
    );
}
