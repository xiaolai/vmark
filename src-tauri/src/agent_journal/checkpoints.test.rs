// WI-AL1.6 — the checkpoint store moves into the journal: the frontend appends each checkpoint as a legacyCheckpoint (idempotent by id) and hydrates from the journal; a clear forgets checkpoints by rewriting the journal, deleting their records and their text bytes (unless another root still needs the blob), surviving reopen, with a Resync and a generation past the old one; an unknown id writes nothing; an open reservation is untouched
use super::test_support::*;
use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::writer::JournalEvent;

fn line(id: &str, content: &str, ts: u64) -> String {
    serde_json::json!({
        "id": id, "tabId": "t-1", "filePath": "/a.md", "timestamp": ts, "tool": "document.write",
        "description": "Wrote document", "contentBefore": content,
    })
    .to_string()
}

fn ids(w: &crate::agent_journal::writer::Writer) -> Vec<String> {
    w.legacy_entries().into_iter().map(|(id, _)| id).collect()
}

#[test]
fn an_appended_checkpoint_is_listed_with_its_text_and_a_repeat_is_idempotent() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    assert!(w
        .append_checkpoint(&line("cp-1", "長い 𝒳 😀 e\u{301}", 1))
        .unwrap());
    assert!(w.append_checkpoint(&line("cp-2", "", 2)).unwrap());
    let generation = w.generation();
    assert!(
        !w.append_checkpoint(&line("cp-1", "長い 𝒳 😀 e\u{301}", 1))
            .unwrap(),
        "idempotent by id"
    );
    assert_eq!(w.generation(), generation, "a repeat writes nothing");
    assert_eq!(ids(&w), ["cp-1", "cp-2"], "journal order");
    let (_, e) = &w.legacy_entries()[0];
    assert_eq!(w.blob_text(&e.preimage).unwrap(), "長い 𝒳 😀 e\u{301}");
}

#[test]
fn a_malformed_checkpoint_line_is_refused_and_writes_nothing() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let generation = w.generation();
    assert!(w.append_checkpoint("{\"id\":\"x\"}").is_err());
    assert!(w.append_checkpoint("not json").is_err());
    assert_eq!(w.generation(), generation);
}

#[test]
fn forgetting_checkpoints_deletes_their_records_and_bytes_and_survives_reopen() {
    let dir = tmp();
    let secret = "private draft 秘密";
    let pre = BlobHash::of_text(secret);
    {
        let (w, _) = open_fast(dir.path());
        w.append_checkpoint(&line("cp-1", secret, 1)).unwrap();
        w.append_checkpoint(&line("cp-2", "kept", 2)).unwrap();
        let before = w.generation();
        let rx = w.subscribe();
        let report = w.forget_legacy(&["cp-1".to_string()]).unwrap();
        assert_eq!(report.forgotten, 1);
        assert_eq!(report.blob_error, None);
        assert_eq!(ids(&w), ["cp-2"]);
        assert!(
            w.blob_text(&pre).is_err(),
            "the forgotten text is deleted, not hidden"
        );
        assert!(
            w.generation() > before,
            "a reader sees the rewrite as a gap"
        );
        assert!(rx
            .try_iter()
            .any(|e| matches!(e, JournalEvent::Resync { .. })));
        assert!(!w
            .debug_records()
            .iter()
            .any(|e| serde_json::to_string(&e.record).unwrap().contains("cp-1")));
    }
    let (w, _) = open_fast(dir.path());
    assert_eq!(ids(&w), ["cp-2"], "reopen replays the rewritten journal");
    assert!(w.blob_text(&pre).is_err());
    assert!(
        w.append_checkpoint(&line("cp-3", "after", 3)).unwrap(),
        "appends continue after the rewrite"
    );
}

#[test]
fn forgetting_keeps_a_blob_another_root_still_needs() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "shared text");
    w.append_checkpoint(&line("cp-1", "shared text", 1))
        .unwrap();
    w.forget_legacy(&["cp-1".to_string()]).unwrap();
    assert_eq!(
        head_text(&w, doc),
        "shared text",
        "the revision's blob stays"
    );
}

#[test]
fn forgetting_an_unknown_or_empty_set_writes_nothing() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    w.append_checkpoint(&line("cp-1", "a", 1)).unwrap();
    let generation = w.generation();
    assert_eq!(w.forget_legacy(&[]).unwrap().forgotten, 0);
    assert_eq!(w.forget_legacy(&["nope".to_string()]).unwrap().forgotten, 0);
    assert_eq!(w.generation(), generation);
    assert_eq!(ids(&w), ["cp-1"]);
}

#[test]
fn forgetting_leaves_every_other_record_and_an_open_reservation_intact() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "one");
    w.append_checkpoint(&line("cp-1", "gone", 1)).unwrap();
    let before = w.snapshot().state;
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "one", ReviewOp::None))
        .expect("prepare");
    w.forget_legacy(&["cp-1".to_string()]).unwrap();
    let after = w.snapshot().state;
    assert_eq!(after.docs, before.docs, "documents are unchanged");
    assert_eq!(after.revisions, before.revisions);
    let req = commit_req_op(
        &w,
        doc,
        "two",
        &[diff_edit("one", "two")],
        vec![],
        &ReviewOp::None,
    );
    w.commit(p.txn, req)
        .expect("the open transaction still commits");
    assert_eq!(head_text(&w, doc), "two");
}

/// A commit whose blob write failed sits in the degraded queue with its
/// text in memory only; the pack legitimately lacks that blob. Forgetting
/// a checkpoint meanwhile must still compact the pack: only blobs the
/// journal reaches are required to be stored.
#[test]
fn forgetting_compacts_while_a_queued_commit_holds_an_unstored_blob() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "H");
    w.append_checkpoint(&line("cp-1", "gone 消える", 1))
        .unwrap();
    let p = w
        .prepare(prepare_req(doc, w.head(doc), "H", ReviewOp::None))
        .unwrap();
    faults.fail_next_blob_writes(1);
    let edit = Edit {
        at: 1,
        delete: 0,
        insert: 1,
    };
    let out = w
        .commit(p.txn, commit_req(&w, doc, "HC", edit, vec![]))
        .unwrap();
    assert!(!out.durable, "the commit is queued");
    let report = w.forget_legacy(&["cp-1".to_string()]).unwrap();
    assert_eq!(report.forgotten, 1);
    assert_eq!(report.blob_error, None, "a queued blob is not required");
    assert!(w.blob_text(&BlobHash::of_text("gone 消える")).is_err());
}

/// A prepared restore from a checkpoint needs that checkpoint at commit
/// (the restore is bound to its source). Forgetting it in between would
/// fail the commit after the text was already put back, so the forget is
/// refused as busy until the restore ends; other checkpoints still go.
#[test]
fn a_checkpoint_a_prepared_restore_reads_is_not_forgotten_until_it_ends() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "H");
    w.append_checkpoint(&line("cp-1", "legacy", 1)).unwrap();
    w.append_checkpoint(&line("cp-2", "other", 2)).unwrap();
    let op = ReviewOp::Restore {
        source: crate::agent_journal::review::RestoreSource::LegacyCheckpoint {
            legacy_id: "cp-1".into(),
        },
    };
    let p = w.prepare(prepare_req(doc, w.head(doc), "H", op)).unwrap();

    let generation = w.generation();
    let err = w
        .forget_legacy(&["cp-2".to_string(), "cp-1".to_string()])
        .unwrap_err();
    assert_eq!(err.code(), "JOURNAL_BUSY");
    assert_eq!(w.generation(), generation, "nothing rewritten");
    assert_eq!(ids(&w), ["cp-1", "cp-2"]);

    assert_eq!(w.forget_legacy(&["cp-2".to_string()]).unwrap().forgotten, 1);
    w.abort(p.txn, "done").unwrap();
    assert_eq!(w.forget_legacy(&["cp-1".to_string()]).unwrap().forgotten, 1);
    assert!(ids(&w).is_empty());
}
