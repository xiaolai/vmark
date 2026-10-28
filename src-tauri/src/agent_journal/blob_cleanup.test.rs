//! Stateless pack cleanup: the pack itself says whether a compaction is
//! owed. When one after a published rewrite fails, the next collection
//! (even one with nothing to collect) or forget (even of ids already gone)
//! retries it, across a restart, and keeps every reachable text; a pack
//! holding exactly what is reachable is never rewritten; a deferred
//! collection does not compact (its roots may be incomplete).

use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

const SECRET: &str = "private draft 秘密 😀";
const KEPT: &str = "kept checkpoint";

fn line(id: &str, content: &str, ts: u64) -> String {
    serde_json::json!({
        "id": id, "tabId": "t-1", "filePath": "/a.md", "timestamp": ts, "tool": "document.write",
        "description": "Wrote document", "contentBefore": content,
    })
    .to_string()
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_string()).collect()
}

fn pack(dir: &std::path::Path) -> Vec<u8> {
    std::fs::read(dir.join(crate::agent_journal::blob_store::BLOB_PACK)).expect("pack")
}

fn holds(bytes: &[u8], text: &str) -> bool {
    bytes.windows(text.len()).any(|w| w == text.as_bytes())
}

/// A journal whose pack still holds `SECRET` after its checkpoint was
/// forgotten: the compaction after the published rewrite failed.
fn orphaned(dir: &std::path::Path) {
    let (w, faults) = open(dir);
    w.append_checkpoint(&line("cp-1", SECRET, 1)).unwrap();
    w.append_checkpoint(&line("cp-2", KEPT, 2)).unwrap();
    human_save(&w, DocId::new(), "a document");
    faults.fail_next_blob_compactions(1);
    let report = w.forget_legacy(&ids(&["cp-1"])).unwrap();
    assert_eq!(report.forgotten, 1);
    assert!(report.blob_error.is_some(), "the compaction failed");
    assert!(holds(&pack(dir), SECRET), "the orphan is still on disk");
}

fn cleaned(w: &Writer, dir: &std::path::Path) {
    assert!(!holds(&pack(dir), SECRET), "the orphan text is gone");
    assert!(w.blob_text(&BlobHash::of_text(SECRET)).is_err());
    assert_eq!(w.blob_text(&BlobHash::of_text(KEPT)).unwrap(), KEPT);
    assert_eq!(
        w.blob_text(&BlobHash::of_text("a document")).unwrap(),
        "a document"
    );
}

#[test]
fn repeating_a_forget_after_reopen_removes_the_orphan_text() {
    let dir = tmp();
    orphaned(dir.path());
    let (w, _) = open(dir.path());
    let report = w.forget_legacy(&ids(&["cp-1"])).unwrap();
    assert_eq!((report.forgotten, report.blob_error), (0, None));
    cleaned(&w, dir.path());
}

#[test]
fn a_collection_with_no_victims_after_reopen_removes_the_orphan_text() {
    let dir = tmp();
    orphaned(dir.path());
    let (w, _) = open(dir.path());
    let report = w.collect(&GcPolicy::default()).unwrap();
    assert!(report.collected.is_empty() && report.deferred.is_none());
    assert_eq!(report.blob_error, None);
    cleaned(&w, dir.path());
}

#[test]
fn a_cleanup_that_fails_again_keeps_reporting_until_one_succeeds() {
    let dir = tmp();
    orphaned(dir.path());
    let (w, faults) = open(dir.path());
    faults.fail_next_blob_compactions(1);
    assert!(w
        .forget_legacy(&ids(&["cp-1"]))
        .unwrap()
        .blob_error
        .is_some());
    faults.fail_next_blob_compactions(1);
    assert!(w
        .collect(&GcPolicy::default())
        .unwrap()
        .blob_error
        .is_some());
    assert!(holds(&pack(dir.path()), SECRET));
    assert_eq!(w.collect(&GcPolicy::default()).unwrap().blob_error, None);
    cleaned(&w, dir.path());
}

#[test]
fn a_deferred_collection_leaves_the_orphan_for_a_later_run() {
    let dir = tmp();
    orphaned(dir.path());
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "H");
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "H", ReviewOp::Review))
        .unwrap();
    let report = w.collect(&GcPolicy::default()).unwrap();
    assert!(report.deferred.is_some());
    assert!(holds(&pack(dir.path()), SECRET), "deferred: no compaction");
    w.abort(p.txn, "x").unwrap();
    assert_eq!(w.collect(&GcPolicy::default()).unwrap().blob_error, None);
    cleaned(&w, dir.path());
}

/// Nothing beyond the reachable set: neither call rewrites the pack.
#[cfg(unix)]
#[test]
fn a_pack_holding_exactly_the_reachable_texts_is_not_rewritten() {
    use std::os::unix::fs::MetadataExt;
    let dir = tmp();
    let (w, _) = open(dir.path());
    w.append_checkpoint(&line("cp-2", KEPT, 2)).unwrap();
    human_save(&w, DocId::new(), "a document");
    let path = dir.path().join(crate::agent_journal::blob_store::BLOB_PACK);
    let before = std::fs::metadata(&path).unwrap().ino();
    assert_eq!(w.forget_legacy(&ids(&["gone"])).unwrap().blob_error, None);
    assert_eq!(w.collect(&GcPolicy::default()).unwrap().blob_error, None);
    assert_eq!(std::fs::metadata(&path).unwrap().ino(), before);
}

/// Three saves of one document whose pack then lost every text the
/// journal reaches (compacted around them).
fn missing_reachable(dir: &std::path::Path) -> Writer {
    let (w, _) = open(dir);
    let doc = DocId::new();
    for text in ["one", "two", "three"] {
        human_save(&w, doc, text);
    }
    w.lock()
        .blobs
        .compact(&std::collections::BTreeSet::new())
        .expect("compact to nothing");
    w
}

fn keep_one() -> GcPolicy {
    GcPolicy {
        max_revisions: 1,
        ..GcPolicy::default()
    }
}

#[test]
fn a_missing_reachable_text_is_corruption_not_cleanup_debt() {
    let dir = tmp();
    let w = missing_reachable(dir.path());
    let err = w.collect(&GcPolicy::default()).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_CORRUPT", "{err:?}");
    let err = w.forget_legacy(&ids(&["gone"])).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_CORRUPT", "{err:?}");
}

/// The startup pass that finds a reachable text missing leaves a writer
/// that refuses every write as corrupt, not one that still reports healthy.
#[test]
fn a_startup_pass_that_finds_a_missing_text_leaves_the_writer_refusing() {
    let dir = tmp();
    let w = missing_reachable(dir.path());
    assert!(w.health().is_ok(), "nothing has looked at the pack yet");
    let summary = crate::agent_journal::service_gc::startup_gc(&w, &GcPolicy::default());
    assert!(
        summary
            .error
            .as_deref()
            .is_some_and(|e| e.starts_with("JOURNAL_CORRUPT")),
        "{summary:?}"
    );
    let err = w.health().unwrap_err();
    assert_eq!(err.code(), "JOURNAL_CORRUPT", "{err:?}");
}

#[test]
fn a_collection_over_a_missing_reachable_text_publishes_nothing() {
    let control = tmp();
    let (w, _) = open(control.path());
    let doc = DocId::new();
    for text in ["one", "two", "three"] {
        human_save(&w, doc, text);
    }
    assert!(!w.collect(&keep_one()).unwrap().collected.is_empty());
    let dir = tmp();
    let w = missing_reachable(dir.path());
    let journal = dir
        .path()
        .join(crate::agent_journal::journal_file::JOURNAL_FILE);
    let before = std::fs::read(&journal).unwrap();
    let err = w.collect(&keep_one()).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_CORRUPT", "{err:?}");
    assert_eq!(
        std::fs::read(&journal).unwrap(),
        before,
        "nothing published"
    );
}
