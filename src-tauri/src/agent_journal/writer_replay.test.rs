//! Streaming startup replay: the sink must fold exactly what the
//! whole-file read folded, however the payload bytes are chunked, and must
//! hold no payload once its frame has ended.
//!
//! Edge cases: a frame split into one-byte chunks, a damaged frame's bytes
//! discarded (never glued onto the next frame), a future-schema record
//! stopping replay as a typed `FutureFormat` at that frame, a corrupt record surfacing as a
//! typed `Corrupt` error that wins over the scan's string, an empty journal,
//! a frame whose buffer cannot be reserved (a typed I/O failure that leaves
//! the journal's bytes as they were, never a truncation).

use std::sync::Arc;

use super::Replay;
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::frame::FrameSink;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::{JournalFile, SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::MAX_SUPPORTED_SCHEMA;
use crate::agent_journal::test_support::*;

/// The payloads of a real journal with two linearized saves on one document.
fn journal_payloads() -> Vec<Vec<u8>> {
    let dir = tmp();
    {
        let (w, _) = open(dir.path());
        let doc = DocId::new();
        human_save(&w, doc, "alpha 中文");
        human_save(&w, doc, "alpha 中文 🙂 beta");
    }
    let opened = JournalFile::open(
        &dir.path().join(JOURNAL_FILE),
        SyncPolicy::None,
        Arc::new(Faults::default()),
    )
    .expect("open");
    opened.payloads
}

/// The whole-file fold the streaming replay replaced: the oracle.
fn folded(payloads: &[Vec<u8>]) -> Projection {
    let mut proj = Projection::default();
    for p in payloads {
        match codec::decode(p).expect("decode") {
            Decoded::Known(env) => proj.apply(&env).expect("apply"),
            Decoded::Future { .. } => unreachable!("no future records here"),
        }
    }
    proj
}

fn feed(replay: &mut Replay, payload: &[u8], chunk: usize) -> Result<(), String> {
    for c in payload.chunks(chunk.max(1)) {
        replay.chunk(c)?;
    }
    replay.frame(0, payload.len() as u64)
}

#[test]
fn streamed_frames_fold_into_the_same_projection_at_any_chunk_size() {
    let payloads = journal_payloads();
    assert!(payloads.len() > 2, "the journal has records to replay");
    let expected = folded(&payloads);
    for chunk in [1, 3, 64 * 1024] {
        let mut replay = Replay::new(MAX_SUPPORTED_SCHEMA, &Faults::default());
        for p in &payloads {
            feed(&mut replay, p, chunk).expect("frame");
            assert!(replay.cur.is_empty(), "no payload is held after its frame");
        }
        assert_eq!(replay.proj, expected, "chunk size {chunk}");
        assert!(replay.failed.is_none());
    }
}

#[test]
fn a_clean_scan_with_no_frames_passes_its_result_through_untouched() {
    let mut replay = Replay::new(MAX_SUPPORTED_SCHEMA, &Faults::default());
    assert_eq!(replay.finish(Ok(7)), Ok(7));
    assert_eq!(replay.proj, Projection::default());
}

#[test]
fn a_discarded_frame_leaves_nothing_for_the_next_one() {
    let payloads = journal_payloads();
    let mut replay = Replay::new(MAX_SUPPORTED_SCHEMA, &Faults::default());
    replay
        .chunk(b"{\"schemaVersion\":2,\"torn")
        .expect("buffered");
    replay.discard();
    for p in &payloads {
        feed(&mut replay, p, 5).expect("frame after a discard");
    }
    assert_eq!(replay.proj, folded(&payloads));
}

#[test]
fn the_first_future_record_stops_replay_as_future_format() {
    let mut replay = Replay::new(MAX_SUPPORTED_SCHEMA, &Faults::default());
    let v = MAX_SUPPORTED_SCHEMA;
    let p = format!("{{\"schemaVersion\":{},\"seq\":\"1\"}}", v + 3);
    feed(&mut replay, p.as_bytes(), 2).expect_err("a future record stops the scan");
    assert_eq!(
        replay.finish(Ok(())),
        Err(TxnError::FutureFormat { version: v + 3 }),
        "the typed stop wins and the projection is never finished"
    );
    assert_eq!(replay.proj, Projection::default());
}

#[test]
fn a_corrupt_record_stops_replay_with_its_typed_error() {
    let mut replay = Replay::new(MAX_SUPPORTED_SCHEMA, &Faults::default());
    let msg = feed(&mut replay, b"{\"no\":\"version\"}", 4).unwrap_err();
    assert!(msg.contains("schemaVersion"), "{msg}");
    assert!(replay.cur.is_empty());
    // The scan reports the stop as a string; the typed cause wins.
    let scanned: Result<(), TxnError> = Err(TxnError::Corrupt(msg.clone()));
    match replay.finish(scanned) {
        Err(TxnError::Corrupt(m)) => assert!(m.contains("schemaVersion"), "{m}"),
        other => panic!("expected the typed corruption, got {other:?}"),
    }
}

#[test]
fn reopening_a_journal_with_a_corrupt_record_is_refused_as_corruption() {
    let dir = tmp();
    let path = dir.path().join(JOURNAL_FILE);
    {
        let opened =
            JournalFile::open(&path, SyncPolicy::None, Arc::new(Faults::default())).unwrap();
        let mut file = opened.file;
        file.append(b"{\"schemaVersion\":2,\"seq\":\"1\",\"record\":{\"kind\":\"nope\"}}")
            .unwrap();
    }
    let (cfg, _) = config(dir.path(), SyncPolicy::None);
    match crate::agent_journal::writer::Writer::open(cfg) {
        Err(TxnError::Corrupt(_)) => {}
        Err(e) => panic!("expected Corrupt, got {e:?}"),
        Ok(_) => panic!("a corrupt record must refuse the open"),
    }
}

/// Replay refuses a record at generation `u64::MAX`, so the writer must
/// never append one: it would be written, fail to apply, poison the writer
/// and make the next open read the journal as corrupt.
#[test]
fn the_writer_refuses_the_generation_replay_would_refuse_and_writes_nothing() {
    let dir = tmp();
    let doc = DocId::new();
    {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "kept");
        w.lock().proj.generation = u64::MAX - 1;
        let len = w.journal_len();
        let err = w.arm_epoch(DocId::new()).unwrap_err();
        assert!(
            matches!(err, TxnError::Io(ref m) if m.contains("generation")),
            "{err:?}"
        );
        assert_eq!(w.journal_len(), len, "nothing appended");
        assert!(w.health().is_ok(), "the writer is not poisoned");
    }
    let (cfg, _) = config(dir.path(), SyncPolicy::Full);
    let reopened = crate::agent_journal::writer::Writer::open(cfg);
    assert!(
        reopened.is_ok(),
        "the journal still opens: {:?}",
        reopened.err()
    );
}

/// A rewrite's header floor is the next generation too: forgetting
/// checkpoints at the cap must refuse, not publish a header replay refuses.
#[test]
fn a_rewrite_at_the_generation_cap_is_refused_and_the_journal_still_opens() {
    let dir = tmp();
    {
        let (w, _) = open(dir.path());
        let line = r#"{"id":"cp-1","tabId":"t","filePath":null,"timestamp":1,"tool":"x","contentBefore":"秘密"}"#;
        w.append_checkpoint(line).unwrap();
        w.lock().proj.generation = u64::MAX - 1;
        let err = w.forget_legacy(&["cp-1".to_string()]).unwrap_err();
        assert!(
            matches!(err, TxnError::Io(ref m) if m.contains("generation")),
            "{err:?}"
        );
        assert!(w.health().is_ok(), "the writer is not poisoned");
    }
    let (cfg, _) = config(dir.path(), SyncPolicy::Full);
    let reopened = crate::agent_journal::writer::Writer::open(cfg);
    assert!(
        reopened.is_ok(),
        "the journal still opens: {:?}",
        reopened.err()
    );
}

#[test]
fn a_frame_whose_buffer_cannot_grow_stops_replay_with_a_typed_io_error() {
    let faults = Faults::default();
    faults.fail_replay_reserve_beyond(8);
    let mut replay = Replay::new(MAX_SUPPORTED_SCHEMA, &faults);
    replay.chunk(b"{\"schema").expect("8 bytes fit");
    let msg = replay.chunk(b"Version\":2").unwrap_err();
    assert!(msg.contains("replay"), "{msg}");
    assert!(replay.cur.is_empty(), "the partial payload is released");
    match replay.finish::<()>(Err(TxnError::Corrupt(msg))) {
        Err(TxnError::Io(m)) => assert!(m.contains("replay"), "{m}"),
        other => panic!("expected the typed I/O failure, got {other:?}"),
    }
}

/// A frame larger than one 64 KiB scan chunk, whose second chunk cannot be
/// buffered: the open fails typed, the file is untouched (the tail is not
/// truncated as torn), and an open that can allocate replays it whole.
#[test]
fn an_allocation_failure_mid_frame_refuses_the_open_and_keeps_the_journal() {
    let dir = tmp();
    let path = dir.path().join(JOURNAL_FILE);
    let line = serde_json::json!({
        "id": "cp-big", "tabId": "t-1", "filePath": null, "timestamp": 1,
        "tool": "document.write", "description": "说".repeat(50_000), "contentBefore": "原文",
    })
    .to_string();
    let doc = DocId::new();
    let want = {
        let (w, _) = open(dir.path());
        w.append_checkpoint(&line).unwrap();
        human_save(&w, doc, "after the big frame");
        w.snapshot().state
    };
    let before = std::fs::read(&path).unwrap();
    assert!(
        before.len() > 2 * 64 * 1024,
        "one frame spans several chunks"
    );
    let (cfg, faults) = config(dir.path(), SyncPolicy::Full);
    faults.fail_replay_reserve_beyond(64 * 1024);
    match crate::agent_journal::writer::Writer::open(cfg) {
        Err(TxnError::Io(m)) => assert!(m.contains("replay"), "{m}"),
        Err(e) => panic!("expected a typed I/O failure, got {e:?}"),
        Ok(_) => panic!("an unbufferable frame must refuse the open"),
    }
    assert_eq!(std::fs::read(&path).unwrap(), before, "nothing truncated");
    let (cfg, _) = config(dir.path(), SyncPolicy::Full);
    let (w, _) = crate::agent_journal::writer::Writer::open(cfg).expect("reopen");
    assert_eq!(w.snapshot().state.revisions, want.revisions);
    assert_eq!(w.legacy_entries().len(), 1);
}
