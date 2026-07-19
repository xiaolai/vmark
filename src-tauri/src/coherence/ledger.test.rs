// WI-1.2 — ledger storage (spec §5): per-writer JSONL segments with
// mkdir-p-every-append (S1 finding) and torn-tail termination (G1
// finding), reader with malformed-entry quarantine, idem dedupe
// (append-only history replay is harmless), (time,id) order-independence
// across segments, unknown-kind preservation, future-format skipping,
// rotation, and quarantine-unavailable fallback.
//
// I5 append-only property test: the public API offers appends and reads
// only — `append_only_api_surface` locks that in.

use super::*;
use crate::coherence::types::{Envelope, WriterId, FORMAT_VERSION};
use serde_json::json;

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn writer(n: u128) -> WriterId {
    WriterId(uuid::Uuid::from_u128(n))
}

fn diag(msg: &str) -> serde_json::Value {
    json!({ "code": "test", "message": msg })
}

fn entry(w: WriterId, time: &str, msg: &str) -> Envelope {
    let mut e = Envelope::create("diagnostic", w, diag(msg));
    e.time = time.to_string();
    e
}

#[test]
fn append_then_read_round_trips() {
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    let e = Envelope::create("diagnostic", writer(1), diag("hello"));
    ledger.append(&e).unwrap();
    let read = ledger.read_all().unwrap();
    assert_eq!(read.entries.len(), 1);
    assert_eq!(read.entries[0], e);
    assert!(read.quarantined.is_empty());
}

#[test]
fn append_recreates_pruned_directory() {
    // Git prunes empty dirs on branch switch (S1): every append mkdir -p's.
    let dir = tmp();
    let ledger_dir = dir.path().join("ledger");
    let ledger = Ledger::new(ledger_dir.clone(), writer(1));
    ledger
        .append(&Envelope::create("diagnostic", writer(1), diag("a")))
        .unwrap();
    std::fs::remove_dir_all(&ledger_dir).unwrap();
    ledger
        .append(&Envelope::create("diagnostic", writer(1), diag("b")))
        .unwrap();
    assert_eq!(ledger.read_all().unwrap().entries.len(), 1); // first was deleted with the dir
}

#[test]
fn torn_tail_is_terminated_then_quarantined_and_next_append_is_clean() {
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    ledger
        .append(&Envelope::create("diagnostic", writer(1), diag("a")))
        .unwrap();
    // Simulate a crash mid-append: torn fragment, no trailing newline.
    let seg = ledger.active_segment_path_for_test();
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().append(true).open(&seg).unwrap();
    f.write_all(b"{\"format\":0,\"id\":\"torn").unwrap();
    drop(f);
    // Writer terminates the tail before its next append (G1 finding).
    ledger
        .append(&Envelope::create("diagnostic", writer(1), diag("b")))
        .unwrap();
    let read = ledger.read_all().unwrap();
    assert_eq!(read.entries.len(), 2, "both real entries survive");
    assert_eq!(read.quarantined.len(), 1, "torn fragment quarantined");
    let bad = seg.parent().unwrap().join("quarantine").join(format!(
        "{}.bad",
        seg.file_name().unwrap().to_string_lossy()
    ));
    assert!(bad.exists(), "quarantine copy written");
}

#[test]
fn replayed_idem_collapses_to_one_logical_entry() {
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    let original = entry(writer(1), "2026-07-18T10:00:00Z", "op");
    ledger.append(&original).unwrap();
    // Crash-recovery replay: same idem, new id and later time.
    let mut replay = original.clone();
    replay.id = uuid::Uuid::now_v7();
    replay.time = "2026-07-18T10:00:05Z".to_string();
    ledger.append(&replay).unwrap();
    let read = ledger.read_all().unwrap();
    assert_eq!(read.entries.len(), 1);
    assert_eq!(read.entries[0].id, original.id, "smallest (time,id) wins");
}

#[test]
fn distinct_idems_with_identical_bodies_are_two_events() {
    // Two generations converging on identical output are two provenance
    // events (Codex D1#2) — distinct idem, no collapse.
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    ledger
        .append(&entry(writer(1), "2026-07-18T10:00:00Z", "same"))
        .unwrap();
    ledger
        .append(&entry(writer(1), "2026-07-18T10:00:01Z", "same"))
        .unwrap();
    assert_eq!(ledger.read_all().unwrap().entries.len(), 2);
}

#[test]
fn segments_merge_order_independently() {
    let dir = tmp();
    let ledger_dir = dir.path().join("ledger");
    let a = Ledger::new(ledger_dir.clone(), writer(1));
    let b = Ledger::new(ledger_dir.clone(), writer(2));
    // Writer B's entry is chronologically FIRST but appended after A's.
    a.append(&entry(writer(1), "2026-07-18T11:00:00Z", "second"))
        .unwrap();
    b.append(&entry(writer(2), "2026-07-18T10:00:00Z", "first"))
        .unwrap();
    let read = a.read_all().unwrap();
    assert_eq!(read.entries.len(), 2);
    assert_eq!(
        read.entries[0].writer,
        writer(2),
        "sorted by (time,id), not file order"
    );
}

#[test]
fn unknown_kind_is_preserved_not_quarantined() {
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    ledger
        .append(&Envelope::create(
            "hologram-sync",
            writer(1),
            json!({ "x": 1 }),
        ))
        .unwrap();
    let read = ledger.read_all().unwrap();
    assert_eq!(read.entries.len(), 1);
    assert!(read.quarantined.is_empty());
}

#[test]
fn malformed_known_kind_and_garbage_json_are_quarantined() {
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    // transformation with no outputs = malformed known kind
    ledger
        .append(&Envelope::create(
            "transformation",
            writer(1),
            json!({ "inputs": [] }),
        ))
        .unwrap();
    // raw garbage line injected directly
    let seg = ledger.active_segment_path_for_test();
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().append(true).open(&seg).unwrap();
    f.write_all(b"not json at all\n").unwrap();
    drop(f);
    let read = ledger.read_all().unwrap();
    assert!(read.entries.is_empty());
    assert_eq!(read.quarantined.len(), 2);
}

#[test]
fn quarantine_copy_is_not_duplicated_across_reads() {
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    let seg_dir = dir.path().join("ledger");
    std::fs::create_dir_all(&seg_dir).unwrap();
    let seg = seg_dir.join(format!("{}.jsonl", writer_file_stem(&writer(1))));
    std::fs::write(&seg, b"garbage line\n").unwrap();
    ledger.read_all().unwrap();
    ledger.read_all().unwrap();
    let bad = seg_dir.join("quarantine").join(format!(
        "{}.bad",
        seg.file_name().unwrap().to_string_lossy()
    ));
    let content = std::fs::read_to_string(&bad).unwrap();
    assert_eq!(
        content.matches("garbage line").count(),
        1,
        "one copy despite two reads"
    );
}

#[test]
fn future_format_entries_are_skipped_not_quarantined() {
    // Spec §1: readers reject newer formats but must preserve them —
    // skipping with a surfaced count, never copying to quarantine.
    let dir = tmp();
    let ledger = Ledger::new(dir.path().join("ledger"), writer(1));
    let mut e = Envelope::create("diagnostic", writer(1), diag("from the future"));
    e.format = FORMAT_VERSION + 1;
    ledger.append(&e).unwrap();
    let read = ledger.read_all().unwrap();
    assert!(read.entries.is_empty());
    assert!(
        read.quarantined.is_empty(),
        "future entries are not corruption"
    );
    assert_eq!(read.future_format, 1);
}

#[test]
fn rotation_starts_new_segment_and_reader_merges_all() {
    let dir = tmp();
    let ledger = Ledger::with_max_segment_bytes(dir.path().join("ledger"), writer(1), 256);
    for i in 0..10 {
        ledger
            .append(&entry(
                writer(1),
                &format!("2026-07-18T10:00:{i:02}Z",),
                &format!("e{i}"),
            ))
            .unwrap();
    }
    let segments: Vec<_> = std::fs::read_dir(dir.path().join("ledger"))
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .collect();
    assert!(
        segments.len() > 1,
        "rotation must have produced multiple segments"
    );
    assert_eq!(ledger.read_all().unwrap().entries.len(), 10);
}

#[test]
fn unavailable_quarantine_does_not_fail_the_read() {
    let dir = tmp();
    let ledger_dir = dir.path().join("ledger");
    let ledger = Ledger::new(ledger_dir.clone(), writer(1));
    std::fs::create_dir_all(&ledger_dir).unwrap();
    std::fs::write(
        ledger_dir.join(format!("{}.jsonl", writer_file_stem(&writer(1)))),
        b"garbage\n",
    )
    .unwrap();
    // Block the quarantine DIRECTORY by occupying its name with a file.
    std::fs::write(ledger_dir.join("quarantine"), b"occupied").unwrap();
    let read = ledger.read_all().unwrap();
    assert_eq!(read.quarantined.len(), 1, "still reported in memory");
}

#[test]
fn append_only_api_surface() {
    // I5: history is append-only. The ledger's public API must expose no
    // rewrite/delete operation — this test names every public method so a
    // future addition breaks it loudly and gets reviewed against I5.
    let allowed = [
        "new",
        "with_max_segment_bytes",
        "append",
        "read_all",
        "active_segment_path_for_test",
    ];
    assert_eq!(
        PUBLIC_API, allowed,
        "new public ledger method: verify it cannot mutate history (I5)"
    );
}
