// WI-AL2.0h — one persistence boundary: while either file is poisoned nothing is written, captures and terminal records queue, and the drainer stops with order kept; a corrupt writer refuses before touching either file
//! R58 rule 1. Every append goes through `append_unannounced`, so its one
//! health check covers the drainer, `abort`, `record_uncommitted` and a
//! capture alike. A poisoned blob pack alone used to let all four append:
//! `BlobStore::put` short-circuited on an indexed hash and the journal
//! file itself was healthy.
//!
//! Edge cases: blob-only poison with every text already stored (the
//! short-circuit path); journal-only poison, where a new text used to land
//! in the pack in front of the refused frame; a torn append whose rollback
//! sync fails; a corrupt writer, which refuses rather than queues.

use std::sync::mpsc::Receiver;

use crate::agent_journal::blob_store::BLOB_PACK;
use crate::agent_journal::ids::{BlobHash, DocId, TxnId};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::{
    CommitRequest, JournalEvent, Journaled, ObserveRequest, Writer,
};

/// Four documents, each set up for one persistence entry, all of their
/// texts already stored.
struct Fixture {
    dir: tempfile::TempDir,
    w: Writer,
    faults: std::sync::Arc<crate::agent_journal::faults::Faults>,
    /// A committed `"d1"` queued behind a clean append failure.
    drain: (DocId, TxnId),
    abort: TxnId,
    uncommitted: TxnId,
    /// Saved `"c0"` then `"c1"`: a capture of `"c0"` names stored texts only.
    capture: DocId,
}

fn fixture() -> Fixture {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let (d, a, u, c) = (DocId::new(), DocId::new(), DocId::new(), DocId::new());
    human_save(&w, d, "d0");
    let p = w
        .prepare(prepare_req(d, w.head(d), "d0", ReviewOp::Review))
        .unwrap();
    faults.fail_next_appends(1);
    let commit = CommitRequest {
        provenance: None,
        postimage: "d1".into(),
        resolves: None,
        effects: Default::default(),
    };
    let out = w.commit(p.txn, commit).unwrap();
    assert!(out.applied && !out.durable, "the commit is queued");
    let abort = w
        .prepare(prepare_req(a, None, "", ReviewOp::Review))
        .unwrap()
        .txn;
    let uncommitted = w
        .prepare(prepare_req(u, None, "", ReviewOp::Review))
        .unwrap()
        .txn;
    human_save(&w, c, "c0");
    human_save(&w, c, "c1");
    Fixture {
        dir,
        w,
        faults,
        drain: (d, p.txn),
        abort,
        uncommitted,
        capture: c,
    }
}

impl Fixture {
    fn pack_len(&self) -> u64 {
        std::fs::metadata(self.dir.path().join(BLOB_PACK))
            .unwrap()
            .len()
    }

    fn capture(&self, doc: DocId, text: &str) -> Result<Journaled, String> {
        let observed_parent = ObservedRef::Revision {
            revision: self.w.head(doc).unwrap(),
        };
        self.w
            .observe(ObserveRequest {
                doc,
                actor: human(),
                initiator: human(),
                postimage: text.into(),
                observed_parent,
                provenance: None,
            })
            .map(|o| o.journaled)
            .map_err(|e| e.code().to_string())
    }

    fn queued(&self, doc: DocId) -> Vec<(TxnId, Vec<(BlobHash, String)>)> {
        self.w.lock().degraded.get(&doc).map_or(vec![], |q| {
            q.iter().map(|e| (e.txn, e.blobs.clone())).collect()
        })
    }
}

fn no_appended(rx: &Receiver<JournalEvent>) {
    let appended = rx
        .try_iter()
        .filter(|e| matches!(e, JournalEvent::Appended(_)))
        .count();
    assert_eq!(appended, 0, "nothing was appended");
}

/// R58 test 1's assertions: the four entries queue, nothing is written to
/// either file, no `Appended` event, and the drainer stops in order.
fn nothing_persists_and_everything_queues(f: &Fixture) {
    let rx = f.w.subscribe();
    let (journal, pack) = (f.w.journal_len(), f.pack_len());
    let (drain_doc, drain_txn) = f.drain;

    assert_eq!(f.capture(f.capture, "c0"), Ok(Journaled::No));
    assert_eq!(f.queued(f.capture).len(), 1, "the capture is queued");

    assert!(!f.w.abort(f.abort, "x").unwrap().durable);
    assert!(!f.w.record_uncommitted(f.uncommitted).unwrap().durable);

    // A capture behind the queued commit, then the drainer.
    assert_eq!(f.capture(drain_doc, "d0 human"), Ok(Journaled::No));
    let before: Vec<TxnId> = f.queued(drain_doc).iter().map(|q| q.0).collect();
    assert_eq!(before.len(), 2);
    assert_eq!(before[0], drain_txn, "the commit leads its queue");
    assert!(!f.w.retry_degraded(drain_doc).unwrap(), "the drainer stops");
    let after: Vec<TxnId> = f.queued(drain_doc).iter().map(|q| q.0).collect();
    assert_eq!(after, before, "the drainer keeps the queue order");

    assert_eq!(f.w.journal_len(), journal, "no journal growth");
    assert_eq!(f.pack_len(), pack, "no blob pack growth");
    no_appended(&rx);
}

#[test]
fn persistence_boundary_blob_only_poison_stops_every_append() {
    let f = fixture();
    f.w.lock().blobs.poison();
    assert!(
        !f.w.lock().journal.is_poisoned(),
        "the journal file is healthy"
    );
    nothing_persists_and_everything_queues(&f);
    // The poisoned pack's index is untrusted: the capture queued every text
    // it names, the stored preimage included.
    let texts: Vec<String> = f.queued(f.capture)[0]
        .1
        .iter()
        .map(|(_, t)| t.clone())
        .collect();
    assert_eq!(texts, vec!["c0".to_string(), "c1".to_string()]);
    // Reads still go through the old handle: a referenced text is not
    // reported missing (corrupt) just because the pack is poisoned.
    let missing = crate::agent_journal::ids::HunkId("missing".into());
    let err = f.w.plan_revert(f.capture, &missing).unwrap_err();
    assert_ne!(err.code(), "JOURNAL_CORRUPT", "{err:?}");
}

#[test]
fn persistence_boundary_journal_only_poison_keeps_queueing() {
    let f = fixture();
    f.w.lock().journal.poison();
    nothing_persists_and_everything_queues(&f);
    // A new text is not written into the pack in front of a refused frame.
    let pack = f.pack_len();
    assert_eq!(f.capture(f.capture, "a brand new text"), Ok(Journaled::No));
    assert_eq!(f.pack_len(), pack);
}

#[test]
fn persistence_boundary_torn_append_with_a_failed_rollback_sync_poisons() {
    let f = fixture();
    let doc = DocId::new();
    f.faults.tear_next_append_after(3);
    f.faults.fail_next_rollback_syncs(1);
    let err =
        f.w.prepare(prepare_req(doc, None, "", ReviewOp::Review))
            .unwrap_err();
    assert_eq!(err.code(), "JOURNAL_IO");
    assert!(f.w.lock().journal.is_poisoned(), "the journal is poisoned");
    assert_eq!(f.w.health().unwrap_err().code(), "JOURNAL_DEGRADED");
    nothing_persists_and_everything_queues(&f);
}

#[test]
fn persistence_boundary_corrupt_writer_refuses_before_touching_either_file() {
    let f = fixture();
    f.w.lock().corrupt = Some("test: a reachable blob is missing".into());
    let rx = f.w.subscribe();
    let (journal, pack) = (f.w.journal_len(), f.pack_len());
    let (drain_doc, drain_txn) = f.drain;
    let corrupt = "JOURNAL_CORRUPT";
    assert_eq!(
        f.capture(f.capture, "a brand new text").unwrap_err(),
        corrupt
    );
    assert_eq!(f.w.abort(f.abort, "x").unwrap_err().code(), corrupt);
    assert_eq!(
        f.w.record_uncommitted(f.uncommitted).unwrap_err().code(),
        corrupt
    );
    assert_eq!(f.w.retry_degraded(drain_doc).unwrap_err().code(), corrupt);
    let kept: Vec<TxnId> = f.queued(drain_doc).iter().map(|q| q.0).collect();
    assert_eq!(kept, vec![drain_txn], "the refused drain keeps its record");
    assert!(
        f.queued(f.capture).is_empty(),
        "a corrupt writer does not queue"
    );
    assert_eq!(f.w.journal_len(), journal);
    assert_eq!(f.pack_len(), pack);
    no_appended(&rx);
}
