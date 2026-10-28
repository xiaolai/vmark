// WI-AL2.2b — the compaction crash matrix over revert decisions: with one multi-item admission (a baseline and the conflicted decision behind it) and one decision-only revert in the journal, a collection crashed after every compaction step reopens to the old journal or to the collected one, whole, and each decision request retried with its payload gets its original reply with nothing appended
//! R106's crash clause on the existing `CompactionStep` matrix: the old or
//! new journal is decided by the step, compared against a twin that ran the
//! same collection to completion.

use std::path::Path;

use super::revert_support::*;
use crate::agent_journal::admission::receipt::{Outcome, PayloadDigest};
use crate::agent_journal::controlled_revert::RevertPrepareRequest;
use crate::agent_journal::faults::CompactionStep;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::Record;
use crate::agent_journal::test_review_helpers::two_hunks;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

type Decision = (DocId, RevertPrepareRequest, PayloadDigest, Outcome);

fn policy() -> GcPolicy {
    GcPolicy {
        max_revisions: 1,
        ..GcPolicy::default()
    }
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("mkdir");
    for entry in std::fs::read_dir(from).expect("read dir") {
        let entry = entry.expect("entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("type").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).expect("copy");
        }
    }
}

fn reopen(dir: &Path) -> Writer {
    Writer::open(config(dir, SyncPolicy::Full).0)
        .expect("reopen")
        .0
}

/// Close `doc`'s epoch, as a clean shutdown does, so a reopen appends nothing.
fn quiesce(w: &Writer, doc: DocId) {
    if let Some(epoch) = w.epoch(doc) {
        w.close_epoch(doc, epoch).expect("close epoch");
    }
}

/// A receipted revert of A over "zx" whose dirty buffer is recorded as a
/// baseline: one admission of three items, the last the decision.
fn multi_item(w: &Writer) -> Decision {
    let doc = DocId::new();
    let (a, _) = two_hunks(w, doc);
    let (mut req, digest) = receipted(rreq(w, doc, "zx", &a));
    req.baseline_provenance = Some(baseline_map(
        w,
        doc,
        "xx",
        "zx",
        &[Edit {
            at: 0,
            delete: 1,
            insert: 1,
        }],
    ));
    let first = run(w, doc, req.clone(), Some(digest.clone())).expect("revert");
    let Record::Admission { items } = last_record(w).record else {
        panic!("one admission frame");
    };
    assert_eq!(items.len(), 3, "a multi-item admission");
    assert!(matches!(items[2].record, Record::ReviewDecision { .. }));
    (doc, req, digest, first)
}

/// A receipted revert of A over a saved "zx": the decision alone.
fn decision_only(w: &Writer) -> Decision {
    let doc = DocId::new();
    let (a, _) = conflicted_pending(w, doc);
    let (req, digest) = receipted(rreq(w, doc, "zx", &a));
    let first = run(w, doc, req.clone(), Some(digest.clone())).expect("revert");
    let last = last_record(w).record;
    let items = match last {
        Record::Admission { items } => items.into_iter().map(|e| e.record).collect(),
        other => vec![other],
    };
    assert!(
        matches!(items.as_slice(), [Record::ReviewDecision { .. }]),
        "the decision alone: {items:?}"
    );
    (doc, req, digest, first)
}

/// Both decisions, then saves that leave their revisions collectable.
fn journal(dir: &Path) -> Vec<Decision> {
    let (w, _) = open(dir);
    let decisions = vec![multi_item(&w), decision_only(&w)];
    for (doc, ..) in &decisions {
        for text in ["p", "pq", "pqr"] {
            human_save(&w, *doc, text);
        }
        quiesce(&w, *doc);
    }
    decisions
}

fn retry_each(w: &Writer, decisions: &[Decision], case: &str) {
    for (doc, req, digest, first) in decisions {
        let before = mark(w);
        let again = run(w, *doc, req.clone(), Some(digest.clone())).expect("retry");
        assert_eq!(&again, first, "{case}: the original reply");
        assert_eq!(mark(w), before, "{case}: nothing appended");
    }
}

#[test]
fn a_collection_crashed_at_every_step_keeps_both_decisions_retryable() {
    for step in [
        CompactionStep::TempWritten,
        CompactionStep::TempSynced,
        CompactionStep::Renamed,
        CompactionStep::DirSynced,
    ] {
        let case = format!("{step:?}");
        let dir = tmp();
        let decisions = journal(dir.path());
        let old: Projection = reopen(dir.path()).lock().proj.clone();
        let twin = tmp();
        copy_dir(dir.path(), twin.path());
        let new: Projection = {
            let w = reopen(twin.path());
            let report = w.collect(&policy()).expect("collect");
            assert!(!report.collected.is_empty(), "{case}: {report:?}");
            drop(w);
            let p = reopen(twin.path()).lock().proj.clone();
            p
        };
        assert_ne!(old, new, "{case}: the collection changes the journal");

        let (w, faults) = open(dir.path());
        faults.crash_compaction_after(step);
        assert!(w.collect(&policy()).is_err(), "{case}: injected crash");
        drop(w); // the crash ends the process, releasing its lock
        let w = reopen(dir.path());
        let want = match step {
            CompactionStep::Renamed | CompactionStep::DirSynced => &new,
            _ => &old,
        };
        assert_eq!(&w.lock().proj, want, "{case}: a whole journal");
        retry_each(&w, &decisions, &case);
    }
}
