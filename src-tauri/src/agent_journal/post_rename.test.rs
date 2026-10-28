// WI-AL2.0h — a rewrite that fails after its rename but leaves the writer alive: the pack's stale index is untrusted, so an orphan's text that the new pack dropped is queued rather than referenced, and both files reopen cleanly
//! R58 rule 2 and test 4–5. `rewrite_each` poisons the file right after the
//! rename; a later failure (directory sync, reopen) returns with the old
//! handle and, for the pack, the old index. That index still lists a blob
//! the replacement pack dropped; `put` used to trust it, so a capture of
//! that text durably named a blob absent from the file.
//!
//! Edge cases: both post-rename steps for the pack; the journal rewrite's
//! own post-rename failure, after which the live projection is the old
//! one while the file on disk is the new one.

use crate::agent_journal::blob_store::BLOB_PACK;
use crate::agent_journal::faults::{AfterRename, Rewritten};
use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::journal_file::JOURNAL_FILE;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::{JournalEvent, Journaled, ObserveRequest, Writer};
use crate::agent_journal::writer_gc::GcPolicy;

const ORPHAN: &str = "orphaned text 孤儿 😀";

fn file_len(dir: &std::path::Path, name: &str) -> u64 {
    std::fs::metadata(dir.join(name)).unwrap().len()
}

fn checkpoint(id: &str, content: &str) -> String {
    serde_json::json!({
        "id": id, "tabId": "t-1", "filePath": "/a.md", "timestamp": 1, "tool": "document.write",
        "description": "Wrote document", "contentBefore": content,
    })
    .to_string()
}

fn capture(w: &Writer, doc: DocId, text: &str) -> Journaled {
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: text.into(),
        observed_parent: ObservedRef::Revision {
            revision: w.head(doc).unwrap(),
        },
        provenance: None,
    })
    .expect("a poisoned writer still accepts a capture")
    .journaled
}

fn appended(rx: &std::sync::mpsc::Receiver<JournalEvent>) -> usize {
    rx.try_iter()
        .filter(|e| matches!(e, JournalEvent::Appended(_)))
        .count()
}

fn post_rename_pack_fault(step: AfterRename) {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "base");
    // A clean failed append leaves the orphan's text in the pack.
    faults.fail_next_appends(1);
    assert!(w.append_checkpoint(&checkpoint("cp", ORPHAN)).is_err());
    let h = BlobHash::of_text(ORPHAN);
    assert_eq!(w.blob_text(&h).unwrap(), ORPHAN, "the orphan is stored");

    faults.fail_after_rename(Rewritten::BlobPack, step);
    let report = w.collect(&GcPolicy::default()).unwrap();
    assert!(
        report.blob_error.is_some(),
        "{step:?}: the compaction failed"
    );
    assert!(
        w.lock().blobs.is_poisoned(),
        "{step:?}: the pack is poisoned"
    );

    let rx = w.subscribe();
    let journal = w.journal_len();
    assert_eq!(capture(&w, doc, ORPHAN), Journaled::No, "{step:?}: queued");
    assert_eq!(w.journal_len(), journal, "{step:?}: no journal growth");
    assert_eq!(appended(&rx), 0, "{step:?}: no event");
    drop(w);

    let (w, _) = open_fast(dir.path());
    assert!(w.health().is_ok(), "{step:?}: reopen is clean");
    assert!(w.blob_text(&h).is_err(), "{step:?}: the orphan is gone");
    assert!(
        w.pending_observations(doc).is_empty(),
        "{step:?}: unreferenced"
    );
    assert_eq!(w.collect(&GcPolicy::default()).unwrap().blob_error, None);
    assert!(w.health().is_ok(), "{step:?}: no reachable blob is missing");
    assert_eq!(head_text(&w, doc), "base");
}

#[test]
fn post_rename_pack_fault_at_the_directory_sync_queues_the_orphan_capture() {
    post_rename_pack_fault(AfterRename::SyncDir);
}

#[test]
fn post_rename_pack_fault_at_the_reopen_queues_the_orphan_capture() {
    post_rename_pack_fault(AfterRename::Reopen);
}

fn keep_one() -> GcPolicy {
    GcPolicy {
        max_revisions: 1,
        ..GcPolicy::default()
    }
}

#[test]
fn post_rename_journal_fault_keeps_the_projection_and_reopens_the_rewrite() {
    for step in [AfterRename::SyncDir, AfterRename::Reopen] {
        let dir = tmp();
        let (w, faults) = open_fast(dir.path());
        let doc = DocId::new();
        for text in ["one", "two", "three"] {
            human_save(&w, doc, text);
        }
        let before = w.snapshot().state;
        faults.fail_after_rename(Rewritten::Journal, step);
        assert_eq!(
            w.collect(&keep_one()).unwrap_err().code(),
            "JOURNAL_IO",
            "{step:?}"
        );
        assert_eq!(w.snapshot().state, before, "{step:?}: projection unchanged");
        assert!(w.lock().journal.is_poisoned(), "{step:?}");

        let rx = w.subscribe();
        let (journal, pack) = (
            file_len(dir.path(), JOURNAL_FILE),
            file_len(dir.path(), BLOB_PACK),
        );
        assert_eq!(
            w.prepare(prepare_req(doc, w.head(doc), "three", ReviewOp::Review))
                .unwrap_err()
                .code(),
            "JOURNAL_DEGRADED",
            "{step:?}: a controlled mutation refuses"
        );
        assert_eq!(capture(&w, doc, "a new text"), Journaled::No, "{step:?}");
        assert!(
            !w.retry_degraded(doc).unwrap(),
            "{step:?}: the drainer stops"
        );
        assert_eq!(file_len(dir.path(), JOURNAL_FILE), journal, "{step:?}");
        assert_eq!(file_len(dir.path(), BLOB_PACK), pack, "{step:?}");
        assert_eq!(appended(&rx), 0, "{step:?}: no event");
        drop(w);

        let (w, _) = open_fast(dir.path());
        assert!(w.health().is_ok(), "{step:?}: the rewrite replays cleanly");
        assert_eq!(head_text(&w, doc), "three", "{step:?}");
        let collected = |p: &crate::agent_journal::projection::Projection| {
            p.revisions.values().filter(|m| m.collected).count()
        };
        assert_eq!(collected(&before), 0, "{step:?}");
        assert!(
            collected(&w.snapshot().state) > 0,
            "{step:?}: the reopened journal is the rewritten one"
        );
    }
}
