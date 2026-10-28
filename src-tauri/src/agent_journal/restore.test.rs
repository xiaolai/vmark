// WI-AL1.6 — restore as a controlled mutation: the overwritten buffer is
// recorded first as a baseline, the restore is one revertible `restore`
// hunk (revert, then revert of the revert), it is a `restore` barrier over
// older live hunks and never supersedes them, a collected source is refused
// before anything is appended, and the history survives GC and a reopen
// (empty text and supplementary-plane text included).

use super::test_review_helpers::{revert_planned, state};
use super::test_support::*;
use crate::agent_journal::actor::Actor;
use crate::agent_journal::controlled::commit_controlled;
use crate::agent_journal::controlled_restore::{
    prepare_restore, RestorePrepareRequest, RestorePrepared,
};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::provenance::BreakReason;
use crate::agent_journal::review::{HunkKind, HunkState, HunkTransition, RestoreSource, ReviewOp};
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

fn req(w: &Writer, doc: DocId, buffer: &str, source: RestoreSource) -> RestorePrepareRequest {
    RestorePrepareRequest {
        doc_key: "path:/notes.md".into(),
        parent: w.head(doc),
        preimage: buffer.into(),
        source,
        baseline_provenance: None,
        baseline_touched: false,
        observed_parent: None,
        request_id: None,
        capture: None,
    }
}

fn of(revision: RevisionId) -> RestoreSource {
    RestoreSource::Revision { revision }
}

fn post(text: &str) -> Vec<u8> {
    serde_json::json!({ "postimage": text })
        .to_string()
        .into_bytes()
}

/// Restore `source` over `buffer` and commit the text the prepare handed back.
fn restore(w: &Writer, doc: DocId, buffer: &str, source: RestoreSource) -> RevisionId {
    let p = prepare_restore(w, doc, req(w, doc, buffer, source)).expect("prepare restore");
    commit_controlled(w, p.txn, &post(&p.text)).expect("commit restore");
    p.revision
}

fn restore_hunk(w: &Writer, doc: DocId, revision: RevisionId) -> crate::agent_journal::ids::HunkId {
    let s = w.snapshot().state;
    let hunks: Vec<_> = s.docs[&doc]
        .hunks
        .iter()
        .filter(|(_, h)| h.hunk.target == revision)
        .collect();
    assert_eq!(hunks.len(), 1, "exactly one restore hunk");
    assert_eq!(hunks[0].1.hunk.kind, HunkKind::Restore);
    hunks[0].0.clone()
}

#[test]
fn restore_records_the_overwritten_buffer_as_a_baseline_before_it_restores() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let one = human_save(&w, doc, "one");
    let two = human_save(&w, doc, "two");
    let p = prepare_restore(&w, doc, req(&w, doc, "two, unsaved", of(one))).expect("prepare");
    let baseline = p.baseline.expect("the unsaved buffer is recorded first");
    let s = w.snapshot().state;
    assert_eq!(s.revisions[&baseline].parent, Some(two));
    assert_eq!(s.revisions[&baseline].actor, Actor::Human);
    assert_eq!(
        w.blob_text(&s.revisions[&baseline].postimage).unwrap(),
        "two, unsaved"
    );
    assert_eq!(
        p.text, "one",
        "the prepare hands the source text to the window"
    );
    assert_eq!(p.resolves, None);
    commit_controlled(&w, p.txn, &post("one")).expect("commit");
    assert_eq!(head_text(&w, doc), "one");
    let s = w.snapshot().state;
    let m = &s.revisions[&p.revision];
    assert_eq!(
        m.parent,
        Some(baseline),
        "the restore's parent is the baseline"
    );
    assert_eq!(
        m.actor,
        Actor::Human,
        "a restore is the person's own action"
    );
    assert!(matches!(m.review_op, ReviewOp::Restore { .. }));
}

#[test]
fn an_equal_untouched_buffer_records_no_baseline() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let one = human_save(&w, doc, "one");
    human_save(&w, doc, "two");
    let p = prepare_restore(&w, doc, req(&w, doc, "two", of(one))).expect("prepare");
    assert_eq!(p.baseline, None);
}

#[test]
fn a_restore_is_revertible_and_its_revert_reverts_again() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let one = human_save(&w, doc, "one 𝒳");
    human_save(&w, doc, "two");
    let rev = restore(&w, doc, "two 😀 unsaved", of(one));
    let id = restore_hunk(&w, doc, rev);
    assert_eq!(state(&w, doc, &id).0, HunkState::Pending);
    assert_eq!(
        revert_planned(&w, doc, &id).unwrap(),
        "two 😀 unsaved",
        "revert gives the overwritten buffer back"
    );
    assert_eq!(state(&w, doc, &id).0, HunkState::Reverted);
    assert_eq!(
        revert_planned(&w, doc, &id).unwrap(),
        "one 𝒳",
        "reverting the revert restores again"
    );
    assert_eq!(state(&w, doc, &id).0, HunkState::Pending);
}

#[test]
fn a_restore_is_a_barrier_and_never_supersedes_older_hunks() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let first = human_save(&w, doc, "first");
    seed_hunks(&w, doc, 2);
    let older = hunk_ids(&w, doc);
    restore(&w, doc, "xx", of(first));
    let s = w.snapshot().state;
    for id in &older {
        let h = &s.docs[&doc].hunks[id];
        assert_eq!(h.state, HunkState::Pending, "a restore never supersedes");
        let block = h
            .span
            .block
            .as_ref()
            .expect("blocked by the restore barrier");
        assert_eq!(block.reason, BreakReason::Restore);
    }
}

#[test]
fn a_restore_commit_carrying_a_superseded_transition_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let first = human_save(&w, doc, "first");
    seed_hunks(&w, doc, 1);
    let id = hunk_ids(&w, doc)[0].clone();
    let p = prepare_restore(&w, doc, req(&w, doc, "x", of(first))).expect("prepare");
    let mut commit = crate::agent_journal::writer::CommitRequest {
        postimage: "first".into(),
        resolves: None,
        provenance: None,
        effects: Default::default(),
    };
    commit.effects = w.derive_commit_effects(p.txn, &commit).expect("derive");
    commit.effects.transitions.push(HunkTransition {
        hunk_id: id.clone(),
        expected_review_gen: state(&w, doc, &id).1,
        to: HunkState::Superseded,
    });
    let err = w
        .commit(p.txn, commit)
        .expect_err("a restore never supersedes");
    assert!(
        matches!(&err, TxnError::InvalidRequest(m) if m.contains("cannot cause that transition")),
        "{err:?}"
    );
}

#[test]
fn restoring_an_uncommitted_preimage_resolves_it_and_drops_its_pin() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "before");
    let t = w
        .prepare(prepare_req(doc, w.head(doc), "before", ReviewOp::Review))
        .expect("prepare")
        .txn;
    w.record_uncommitted(t).expect("uncommitted");
    human_save(&w, doc, "after");
    assert!(w
        .pins()
        .blobs
        .contains(&w.snapshot().state.txns[&t].preimage));
    let src = RestoreSource::UncommittedPreimage { txn: t };
    let p = prepare_restore(&w, doc, req(&w, doc, "after", src)).expect("prepare");
    assert_eq!((p.text.as_str(), p.resolves), ("before", Some(t)));
    commit_controlled(&w, p.txn, &post("before")).expect("commit");
    assert_eq!(
        w.snapshot().state.txns[&t].status,
        TxnStatus::Resolved { by: p.txn }
    );
}

#[test]
fn a_restore_with_another_text_is_refused_and_ends_uncommitted() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let one = human_save(&w, doc, "one");
    human_save(&w, doc, "two");
    let p = prepare_restore(&w, doc, req(&w, doc, "two", of(one))).expect("prepare");
    assert!(commit_controlled(&w, p.txn, &post("not one")).is_err());
    assert_eq!(
        w.snapshot().state.txns[&p.txn].status,
        TxnStatus::Uncommitted
    );
}

#[test]
fn an_unknown_or_collected_source_is_refused_before_anything_is_appended() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let revs: Vec<RevisionId> = (0..6)
        .map(|i| human_save(&w, doc, &format!("t{i}")))
        .collect();
    w.collect(&GcPolicy {
        max_revisions: 2,
        ..GcPolicy::default()
    })
    .expect("collect");
    let len = w.journal_len();
    for source in [
        of(revs[0]),
        of(RevisionId::new()),
        RestoreSource::UncommittedPreimage { txn: TxnId::new() },
        RestoreSource::LegacyCheckpoint {
            legacy_id: "nope".into(),
        },
    ] {
        let err =
            prepare_restore(&w, doc, req(&w, doc, "changed buffer", source)).expect_err("refused");
        assert!(matches!(err, TxnError::InvalidRequest(_)), "{err:?}");
        assert_eq!(w.journal_len(), len, "no baseline for a refused restore");
    }
}

#[test]
fn a_restore_of_another_documents_revision_is_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let (a, b) = (DocId::new(), DocId::new());
    let ra = human_save(&w, a, "a");
    human_save(&w, b, "b");
    assert!(prepare_restore(&w, b, req(&w, b, "b", of(ra))).is_err());
}

#[test]
fn restore_then_gc_then_reopen_then_revert_and_revert_of_revert() {
    for (old, cur) in [("", "now"), ("𝒳𝒴 😀", ""), ("same", "same")] {
        let dir = tmp();
        let rev = {
            let (w, _) = open(dir.path());
            let doc = DocId::new();
            let src = human_save(&w, doc, old);
            for i in 0..4 {
                human_save(&w, doc, &format!("{cur}{i}"));
            }
            human_save(&w, doc, cur);
            let rev = restore(&w, doc, cur, of(src));
            let report = w
                .collect(&GcPolicy {
                    max_revisions: 1,
                    ..GcPolicy::default()
                })
                .expect("collect");
            assert!(
                !report.collected.contains(&rev),
                "the restore's hunk pins it"
            );
            // A clean shutdown closes the editing epoch (an unclosed one
            // blocks every live hunk on reopen).
            if let Some(epoch) = w.epoch(doc) {
                w.close_epoch(doc, epoch).expect("close epoch");
            }
            (rev, doc)
        };
        let (w, _) = open(dir.path());
        let (rev, doc) = rev;
        assert_eq!(head_text(&w, doc), old);
        let id = restore_hunk(&w, doc, rev);
        if old == cur {
            // Restoring the text already there: the restore's base is in
            // place, so a revert has nothing to do.
            let plan = w.plan_revert(doc, &id).expect("plan");
            assert_eq!(
                plan.decision,
                crate::agent_journal::revert_gate::RevertDecision::FoundBase
            );
            continue;
        }
        assert_eq!(
            revert_planned(&w, doc, &id).unwrap(),
            cur,
            "{old:?} over {cur:?}"
        );
        assert_eq!(revert_planned(&w, doc, &id).unwrap(), old);
    }
}

#[test]
fn a_reserved_document_refuses_a_restore_with_nothing_appended() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let one = human_save(&w, doc, "one");
    human_save(&w, doc, "two");
    let _open = w
        .prepare(prepare_req(doc, w.head(doc), "two", ReviewOp::Review))
        .expect("prepare");
    let len = w.journal_len();
    assert!(prepare_restore(&w, doc, req(&w, doc, "two, edited", of(one))).is_err());
    assert_eq!(w.journal_len(), len);
}

#[test]
fn a_stale_parent_refuses_a_restore() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let one = human_save(&w, doc, "one");
    let mut r = req(&w, doc, "one", of(one));
    human_save(&w, doc, "two");
    r.preimage = "two".into();
    let err = prepare_restore(&w, doc, r).expect_err("stale");
    assert!(matches!(err, TxnError::StaleParent { .. }), "{err:?}");
}

/// Neither the journal nor the projection shows `buffer`: no capture, no
/// revision, no restore transaction opened.
fn no_trace(w: &Writer, buffer: &str, k: u32) {
    use crate::agent_journal::ids::BlobHash;
    use crate::agent_journal::record::Record;
    let hash = BlobHash::of_text(buffer);
    let s = w.snapshot().state;
    assert!(
        !s.revisions.values().any(|m| m.postimage == hash),
        "k={k}: a revision of the refused buffer"
    );
    let captured = w.debug_records().into_iter().any(
        |e| matches!(e.record, Record::PendingObservation { postimage, .. } if postimage == hash),
    );
    assert!(!captured, "k={k}: a capture of the refused buffer");
}

/// A restore of what `setup` returns over a dirty buffer, raced against
/// `competitor`, injected before the prepare's `k`-th writer-lock
/// acquisition; `check` judges both results.
fn race<S: Sync, RB: Send>(
    k: u32,
    setup: impl FnOnce(&Writer, DocId) -> (RestoreSource, S),
    competitor: impl FnOnce(&Writer, &S) -> RB + Send,
    check: impl FnOnce(&Writer, DocId, &S, Result<RestorePrepared, TxnError>, RB),
) {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    let (source, state) = setup(&w, doc);
    let r = req(&w, doc, "dirty buffer", source);
    let (a, b, _) = interleave(
        &faults,
        k,
        || prepare_restore(&w, doc, r),
        || competitor(&w, &state),
    );
    check(&w, doc, &state, a, b);
}

#[test]
fn the_loser_of_two_racing_restores_appends_nothing_at_any_interleaving() {
    for k in 1..=16 {
        let dir = tmp();
        let (w, faults) = open(dir.path());
        let doc = DocId::new();
        let one = human_save(&w, doc, "one");
        human_save(&w, doc, "two");
        let generation = w.generation();
        let (a, b, _) = interleave(
            &faults,
            k,
            || prepare_restore(&w, doc, req(&w, doc, "two, A", of(one))),
            || prepare_restore(&w, doc, req(&w, doc, "two, B", of(one))),
        );
        let (won, lost) = match (a, b) {
            (Ok(p), Err(_)) => (p, "two, B"),
            (Err(_), Ok(p)) => (p, "two, A"),
            (a, b) => panic!("k={k}: exactly one restore wins: {a:?} / {b:?}"),
        };
        no_trace(&w, lost, k);
        assert_eq!(
            w.generation() - generation,
            3,
            "k={k}: the winner's baseline, its linearization and the prepare"
        );
        assert_eq!(w.reservation(doc).map(|r| r.txn), Some(won.txn));
    }
}

#[test]
fn a_source_collected_before_the_reservation_refuses_with_nothing_appended() {
    for k in 1..=16 {
        race(
            k,
            |w, doc| {
                let saved: Vec<RevisionId> = (0..6)
                    .map(|i| human_save(w, doc, &format!("t{i}")))
                    .collect();
                (of(saved[0]), saved)
            },
            |w, _| {
                w.collect(&GcPolicy {
                    max_revisions: 2,
                    ..GcPolicy::default()
                })
            },
            |w, doc, saved, a, gc| {
                gc.expect("collect");
                let collected = w.snapshot().state.revisions[&saved[0]].collected;
                match a {
                    Ok(p) => {
                        assert!(!collected, "k={k}: a reserved restore's source stays");
                        assert_eq!(p.text, "t0");
                    }
                    Err(e) => {
                        assert!(matches!(e, TxnError::InvalidRequest(_)), "k={k}: {e:?}");
                        assert!(collected, "k={k}");
                        assert_eq!(w.head(doc), Some(saved[5]), "k={k}: head unmoved");
                        no_trace(w, "dirty buffer", k);
                    }
                }
            },
        );
    }
}

#[test]
fn an_uncommitted_source_discarded_before_the_reservation_refuses_with_nothing_appended() {
    for k in 1..=16 {
        race(
            k,
            |w, doc| {
                human_save(w, doc, "before");
                let t = w
                    .prepare(prepare_req(doc, w.head(doc), "before", ReviewOp::Review))
                    .expect("prepare")
                    .txn;
                w.record_uncommitted(t).expect("uncommitted");
                human_save(w, doc, "after");
                (RestoreSource::UncommittedPreimage { txn: t }, t)
            },
            |w, t| w.discard(*t),
            |w, doc, t, a, discarded| match (a, discarded) {
                (Ok(p), Err(_)) => assert_eq!(p.resolves, Some(*t), "k={k}"),
                (Err(e), Ok(_)) => {
                    assert!(matches!(e, TxnError::InvalidRequest(_)), "k={k}: {e:?}");
                    assert_eq!(w.reservation(doc), None, "k={k}");
                    no_trace(w, "dirty buffer", k);
                }
                (a, d) => panic!("k={k}: exactly one wins: {a:?} / {d:?}"),
            },
        );
    }
}
