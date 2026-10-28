// WI-AL1.6 — the collector: oldest unpinned revisions collected to tombstones; a cap exceeded only by pinned records deletes nothing and warns; near-cap warning at 80%; barriers, lastCertified, capture bases (observedParent) and observedPreimage roots kept
//! The ADR-AL13 collector over the pin projection. Every collection is a
//! compaction: the replayed journal must equal the live projection with
//! the victims tombstoned, and a restart must read the same state back.

use super::test_support::*;
use crate::agent_journal::faults::CompactionStep;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::pins::PinReason;
use crate::agent_journal::projection::RevisionKind;
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::writer::{JournalEvent, ObserveRequest, RetentionBudget, Writer};
use crate::agent_journal::writer_gc::{GcLimit, GcPolicy, GcWarningKind};

fn policy(max_revisions: usize) -> GcPolicy {
    GcPolicy {
        max_revisions,
        ..GcPolicy::default()
    }
}

fn saves(w: &Writer, doc: DocId, n: usize) -> Vec<RevisionId> {
    (0..n)
        .map(|i| human_save(w, doc, &format!("text {i}")))
        .collect()
}

/// Close `doc`'s open edit epoch, so a reopen (which appends
/// `epochUnclosed` for an armed epoch) replays to the same state.
fn settle(w: &Writer, doc: DocId) {
    if let Some(epoch) = w.epoch(doc) {
        w.close_epoch(doc, epoch).expect("close epoch");
    }
}

fn live(w: &Writer, doc: DocId) -> usize {
    let s = w.snapshot().state;
    s.revisions
        .values()
        .filter(|m| m.doc == doc && !m.collected)
        .count()
}

#[test]
fn collect_tombstones_the_oldest_unpinned_revisions_and_restart_reads_them_back() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let revs = saves(&w, doc, 10);
    let generation = w.generation();
    let rx = w.subscribe();
    let report = w.collect(&policy(4)).expect("collect");
    assert_eq!(
        report.collected,
        revs[..6].to_vec(),
        "oldest first, down to the cap"
    );
    assert_eq!(live(&w, doc), 4);
    let state = w.snapshot().state;
    for r in &revs[..6] {
        let m = &state.revisions[r];
        assert!(m.collected && m.kind == RevisionKind::Tombstone);
    }
    for r in &revs[..5] {
        assert!(
            w.blob_text(&state.revisions[r].postimage).is_err(),
            "a collected text is gone"
        );
    }
    // The last collected text is the next retained revision's before-text:
    // export writes the collected run as a commit with that tree.
    assert!(w.blob_text(&state.revisions[&revs[5]].postimage).is_ok());
    assert_eq!(head_text(&w, doc), "text 9");
    // One tombstone per collected revision; their observations are gone.
    let records = w.debug_records();
    let tombstones = records
        .iter()
        .filter(|e| matches!(e.record, Record::Tombstone { .. }))
        .count();
    assert_eq!(tombstones, 6);
    let pending = records
        .iter()
        .filter(|e| matches!(e.record, Record::PendingObservation { .. }))
        .count();
    assert_eq!(pending, 4, "a collected revision keeps no observation");
    assert!(
        matches!(records[0].record, Record::JournalHeader { generation_floor } if generation_floor == generation + 1)
    );
    // The floor is past every old seq, so a reader that missed the Resync
    // still sees a generation it never saw and refetches.
    assert!(
        matches!(rx.try_recv(), Ok(JournalEvent::Resync { generation: g }) if g == generation + 1)
    );
    // Generations never repeat, and a restart replays the same state.
    human_save(&w, doc, "after");
    assert_eq!(
        w.generation(),
        generation + 3,
        "the save's two records follow the floor"
    );
    settle(&w, doc);
    let before = w.snapshot().state;
    drop(w);
    let (w, _) = open(dir.path());
    assert_eq!(w.snapshot().state, before);
    assert_eq!(
        w.collect(&policy(4)).expect("again").collected.len(),
        1,
        "idempotent: only the new overflow"
    );
}

#[test]
fn collect_tombstones_controlled_revisions_without_reopening_their_transactions() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    for text in ["ab", "abc", "abcd"] {
        let pre = head_text(&w, doc);
        let p = w
            .prepare(prepare_req(doc, w.head(doc), &pre, ReviewOp::None))
            .expect("prepare");
        let req = commit_req_op(
            &w,
            doc,
            text,
            &[diff_edit(&pre, text)],
            vec![],
            &ReviewOp::None,
        );
        w.commit(p.txn, req).expect("commit");
    }
    let report = w.collect(&policy(1)).expect("collect");
    assert_eq!(report.collected.len(), 3);
    settle(&w, doc);
    let before = w.snapshot().state;
    drop(w);
    let (cfg, _) = config(
        dir.path(),
        crate::agent_journal::journal_file::SyncPolicy::Full,
    );
    let (w, open_report) = Writer::open(cfg).expect("reopen");
    assert!(
        open_report.uncommitted.is_empty(),
        "a tombstoned commit leaves no open prepared"
    );
    assert_eq!(w.snapshot().state, before);
}

#[test]
fn collect_pins_only_overflow_deletes_nothing_and_warns_naming_the_pins() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    seed_hunks(&w, doc, 3);
    let len = w.journal_len();
    let report = w.collect(&policy(1)).expect("collect");
    assert!(
        report.collected.is_empty(),
        "every revision over the cap is pinned"
    );
    assert_eq!(w.journal_len(), len, "nothing rewritten");
    let warn = report
        .warnings
        .iter()
        .find(|x| x.kind == GcWarningKind::PinnedOverCap)
        .expect("pins-only overflow warns");
    assert_eq!(
        (warn.doc, warn.limit, warn.used, warn.cap),
        (Some(doc), GcLimit::Revisions, 2, 1)
    );
    assert!(warn.pinned_by.contains_key("head") && warn.pinned_by.contains_key("hunkBase"));
    assert_eq!(live(&w, doc), 2);
}

#[test]
fn collect_warns_near_cap_at_80_percent_without_collecting() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    saves(&w, doc, 4);
    let report = w.collect(&policy(5)).expect("collect");
    assert!(report.collected.is_empty());
    let warn = report
        .warnings
        .iter()
        .find(|x| x.kind == GcWarningKind::NearCap)
        .expect("near-cap warn");
    assert_eq!((warn.used, warn.cap), (4, 5));
    let report = w.collect(&policy(6)).expect("collect");
    assert!(report.warnings.is_empty(), "4 of 6 is under 80%");
}

#[test]
fn collect_honours_the_byte_caps() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    for i in 0..5 {
        human_save(&w, doc, &"x".repeat(100 + i));
    }
    let per_doc = GcPolicy {
        max_doc_bytes: 250,
        ..GcPolicy::default()
    };
    let report = w.collect(&per_doc).expect("collect");
    assert!(!report.collected.is_empty() && live(&w, doc) < 5);
    let other = DocId::new();
    for i in 0..5 {
        human_save(&w, other, &"y".repeat(100 + i));
    }
    let total = GcPolicy {
        max_total_bytes: 600,
        ..GcPolicy::default()
    };
    let report = w.collect(&total).expect("collect");
    assert!(
        !report.collected.is_empty(),
        "the global cap collects across documents"
    );
}

#[test]
fn collect_keeps_barrier_last_certified_capture_base_and_observed_roots() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    seed_hunks(&w, doc, 2);
    // A save without provenance is a snapshotOnly barrier on the live hunks.
    let barrier = snapshot_save(&w, doc, "xx!");
    let more = saves(&w, doc, 4);
    // A save that loaded `more[0]`, still pending: its observedParent is a
    // capture base and its observedPreimage a blob root.
    let stale = w.snapshot().state.revisions[&more[0]].postimage.clone();
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: "concurrent".into(),
        observed_parent: ObservedRef::Revision { revision: more[0] },
        provenance: None,
    })
    .expect("observe");
    let pins = w.pins();
    let reasons = |r: &RevisionId| pins.revisions.get(r).cloned().unwrap_or_default();
    assert!(
        reasons(&barrier)
            .iter()
            .any(|p| matches!(p, PinReason::Barrier(_))),
        "the barrier revision is a root"
    );
    assert!(
        reasons(&more[0]).contains(&PinReason::CaptureBase),
        "observedParent is a root"
    );
    let state = w.snapshot().state;
    let certified: Vec<RevisionId> = state.docs[&doc]
        .hunks
        .values()
        .filter_map(|h| h.span.last_certified.map(|c| c.at))
        .collect();
    assert!(
        !certified.is_empty(),
        "the blocked hunks keep a lastCertified revision"
    );
    let report = w.collect(&policy(1)).expect("collect");
    assert!(
        !report.collected.is_empty(),
        "something unpinned was collected"
    );
    let state = w.snapshot().state;
    for kept in certified.iter().chain([&barrier, &more[0]]) {
        assert!(!state.revisions[kept].collected, "{kept:?} must survive");
    }
    assert!(w.blob_text(&stale).is_ok(), "observedPreimage survives");
    assert!(w.blob_text(&BlobHash::of_text("concurrent")).is_ok());
    assert!(report
        .warnings
        .iter()
        .any(|x| x.kind == GcWarningKind::PinnedOverCap));
}

#[test]
fn collect_waits_for_open_reservations() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    saves(&w, doc, 5);
    let p = w
        .prepare(prepare_req(
            doc,
            w.head(doc),
            &head_text(&w, doc),
            ReviewOp::Review,
        ))
        .expect("prepare");
    let report = w.collect(&policy(1)).expect("collect");
    assert!(report.collected.is_empty() && report.deferred.is_some());
    w.abort(p.txn, "x").expect("abort");
    assert_eq!(w.collect(&policy(1)).expect("collect").collected.len(), 4);
}

#[test]
fn a_crash_mid_collection_leaves_the_old_journal_whole() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    saves(&w, doc, 6);
    settle(&w, doc);
    let before = w.snapshot().state;
    faults.crash_compaction_after(CompactionStep::TempSynced);
    assert!(w.collect(&policy(2)).is_err());
    drop(w);
    let (w, _) = open(dir.path());
    assert_eq!(w.snapshot().state, before, "the rename never happened");
    assert_eq!(w.collect(&policy(2)).expect("collect").collected.len(), 4);
}

#[test]
fn a_reader_that_lost_the_collection_resync_sees_a_gap_on_the_next_append() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    saves(&w, doc, 6);
    let old = w.generation();
    let rx = w.subscribe();
    w.collect(&policy(2)).expect("collect");
    human_save(&w, doc, "after");
    let events: Vec<JournalEvent> = rx.try_iter().collect();
    assert!(matches!(events[0], JournalEvent::Resync { generation } if generation == old + 1));
    // Hydration applies an append only at `generation + 1`: a reader still at
    // `old` that lost the Resync sees `old + 2`, a gap, and refetches.
    assert!(matches!(&events[1], JournalEvent::Appended(env) if env.seq == old + 2));
}

#[test]
fn collect_defers_while_a_window_base_is_unpinned_past_the_window_budget() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    w.set_retention_budget(RetentionBudget {
        window_bases: 1,
        ..RetentionBudget::default()
    });
    let doc = DocId::new();
    let revs = saves(&w, doc, 6);
    let base = |r: RevisionId| ObservedRef::Revision { revision: r };
    w.register_window_base("w1", doc, base(revs[5]));
    w.register_window_base("w2", doc, base(revs[0]));
    let report = w.collect(&policy(2)).expect("collect");
    assert!(
        report.collected.is_empty(),
        "w2's base revs[0] is not pinned"
    );
    assert!(report.deferred.is_some());
    // The unpinned window closes: collection resumes.
    w.clear_window_base("w2");
    assert_eq!(
        w.collect(&policy(2)).expect("again").collected,
        revs[..4].to_vec()
    );
}

#[test]
fn a_capture_based_on_a_collected_revision_is_refused_loudly() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let revs = saves(&w, doc, 6);
    w.collect(&policy(2)).expect("collect");
    // revs[3]'s text survives as revs[4]'s before-text, but the revision is
    // a tombstone: no capture may name it as its base.
    let err = w
        .observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: "late".into(),
            observed_parent: ObservedRef::Revision { revision: revs[3] },
            provenance: None,
        })
        .expect_err("a collected base is unknown");
    assert!(err.to_string().contains("unknown"), "{err}");
}

#[test]
fn a_rewrite_naming_an_unknown_victim_is_an_invariant_error_not_a_panic() {
    use crate::agent_journal::gc_compact::Rewrite;
    use crate::agent_journal::projection::Projection;
    use std::collections::BTreeSet;
    let unknown: BTreeSet<RevisionId> = [RevisionId::new()].into_iter().collect();
    let err = Rewrite::new(&Projection::default(), &unknown, &BTreeSet::new())
        .err()
        .expect("an unknown victim is refused");
    assert_eq!(err.code(), "INVARIANT_BROKEN", "{err:?}");
}

#[test]
fn per_document_warnings_describe_usage_after_the_global_pass() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    for i in 0..5 {
        human_save(&w, doc, &"x".repeat(100 + i));
    }
    // ~510 bytes kept: 85% of the document cap before the global cap
    // collects the oldest revisions down to ~200 bytes.
    let report = w
        .collect(&GcPolicy {
            max_doc_bytes: 600,
            max_total_bytes: 300,
            ..GcPolicy::default()
        })
        .expect("collect");
    assert!(!report.collected.is_empty(), "the global cap collects");
    let stale: Vec<_> = report
        .warnings
        .iter()
        .filter(|x| x.limit == GcLimit::DocBytes)
        .collect();
    assert!(
        stale.is_empty(),
        "the document is well under 80% once the plan is applied: {stale:?}"
    );
}

#[test]
fn near_cap_is_exact_at_the_extremes() {
    use crate::agent_journal::gc_plan::near_cap;
    assert!(near_cap(4, 5) && !near_cap(3, 5));
    assert!(near_cap(80, 100) && !near_cap(79, 100));
    assert!(!near_cap(0, 0), "a zero cap is never near: over it or not");
    assert!(
        !near_cap(u64::MAX / 4, u64::MAX),
        "25% of a huge cap must not saturate into a warning"
    );
    assert!(near_cap(u64::MAX / 5 * 4, u64::MAX));
}

/// A deferred collection only says why it deferred: it runs no victim plan,
/// so it reports no usage warnings (their absence proves nothing about the
/// caps) and never labels collectible excess as pinned.
#[test]
fn a_deferred_collection_reports_its_reason_and_no_warnings() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    saves(&w, doc, 5);
    let p = w
        .prepare(prepare_req(
            doc,
            w.head(doc),
            &head_text(&w, doc),
            ReviewOp::Review,
        ))
        .expect("prepare");
    let before = w.snapshot().state;
    for cap in [2, 6] {
        let report = w.collect(&policy(cap)).expect("collect");
        assert!(report.collected.is_empty(), "cap {cap}");
        assert!(report.deferred.is_some(), "cap {cap}");
        assert_eq!(report.warnings, vec![], "cap {cap}: deferred, no plan");
        assert_eq!(w.snapshot().state, before, "cap {cap}");
    }
    w.abort(p.txn, "x").expect("abort");
}

/// The collector streams the journal one record at a time (it never holds
/// the file whole): a buffer bound far below the journal, but enough for
/// its largest record, lets it run; one below that record refuses it
/// typed, with nothing written.
#[test]
fn a_collection_buffers_one_record_at_a_time() {
    use crate::agent_journal::journal_file::JOURNAL_FILE;
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    for i in 0..40 {
        human_save(&w, doc, &format!("{i} {}", "x".repeat(200)));
    }
    let journal = dir.path().join(JOURNAL_FILE);
    let bytes = std::fs::read(&journal).unwrap();
    let scan = crate::agent_journal::frame::scan(&bytes).expect("a whole journal");
    let largest = scan.frames.iter().map(|f| f.payload.len()).max().unwrap();
    assert!(largest * 8 < bytes.len(), "{largest} of {}", bytes.len());
    faults.fail_replay_reserve_beyond(largest - 1);
    let err = w.collect(&policy(1)).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_IO", "{err:?}");
    assert!(err.to_string().contains("rewrite"), "{err}");
    assert_eq!(std::fs::read(&journal).unwrap(), bytes, "nothing written");
    faults.fail_replay_reserve_beyond(largest);
    assert!(!w.collect(&policy(1)).unwrap().collected.is_empty());
}

/// Compaction may leave a retained save's pending base ahead of its
/// evidence: B was built on pending A, and collecting A alone drops A's
/// `pendingObservation` while A's tombstone stays at A's linearization,
/// after B. The replay check waits for that tombstone instead of refusing
/// B, and the restart reads the same state back.
#[test]
fn collecting_the_pending_base_of_a_retained_save_compacts_and_restarts() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let observe = |text: &str, observed_parent| {
        w.observe(ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: text.into(),
            observed_parent,
            provenance: None,
        })
        .expect("observe")
        .observation
    };
    let a = observe("a", ObservedRef::Genesis);
    observe("ab", ObservedRef::Pending { observation: a });
    let ra = linearize(&w, doc).revision;
    linearize(&w, doc);
    let report = w.collect(&policy(1)).expect("collect");
    assert_eq!(report.collected, vec![ra], "A alone");
    let records = w.debug_records();
    let pending = records
        .iter()
        .filter(|e| matches!(e.record, Record::PendingObservation { .. }))
        .count();
    assert_eq!(pending, 1, "A's pendingObservation dropped, B's kept");
    settle(&w, doc);
    let before = w.snapshot().state;
    drop(w);
    let (w, _) = open(dir.path());
    assert_eq!(w.snapshot().state, before);
}
