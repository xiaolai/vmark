// WI-AL2.0s — a record newer than this build turns the journal off for every document before anything is repaired: no torn-tail truncation of `journal.alj` or `blobs.pack`, no replay completion, no history; a v2 journal still opens, and a v3-labelled record of a v2 kind is read
//! Future-format stop at open (schema v3; R35, R46, R54).
//!
//! Each case runs twice: as a v2-only build meeting a v3 record (maximum
//! schema 2), and as this build meeting a record one version past its own.
//! "Off" is checked as the open's typed refusal plus the SHA-256 of both
//! files before and after, so a truncation, a recovery append or a blob-pack
//! repair would all show as a changed hash.
//!
//! Edge cases: the future record in the middle and at the tail; a torn
//! journal tail and a torn blob-pack tail behind it; a future content record
//! followed by a v2 record that depends on it (must be `FUTURE_FORMAT`, not
//! `JOURNAL_CORRUPT`); two documents, with an open transaction and an armed
//! epoch that a writable open would close. WI-AL2.2a adds the deferred
//! receipt kinds (R103 rule 8): a `decision` receipt and, since WI-AL3.1b
//! (R107 rule 1), every real schema-5 comment carrier, under a newer
//! schema behind torn tails, are `FUTURE_FORMAT`; labelled schema 3 they
//! are `Corrupt`. A schema-4 reader meeting a real schema-5 journal is
//! `FUTURE_FORMAT` with both files unchanged.
//! Every journal command, through
//! IPC dispatch, is in `future_format_dispatch.test.rs`.

use std::io::Write;
use std::path::Path;

use sha2_v011::{Digest, Sha256};

use crate::agent_journal::blob_store::BLOB_PACK;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::frame;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::record::{MAX_SUPPORTED_SCHEMA, SCHEMA_V2};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::{OpenReport, Writer};

/// (reader's maximum schema, the record version it cannot read).
const CASES: [(u32, u32); 2] = [
    (SCHEMA_V2, SCHEMA_V2 + 1),
    (MAX_SUPPORTED_SCHEMA, MAX_SUPPORTED_SCHEMA + 1),
];

fn sha(path: &Path) -> Vec<u8> {
    Sha256::digest(std::fs::read(path).expect("file exists")).to_vec()
}

/// The SHA-256 of `journal.alj` and `blobs.pack`.
fn hashes(dir: &Path) -> (Vec<u8>, Vec<u8>) {
    (sha(&dir.join(JOURNAL_FILE)), sha(&dir.join(BLOB_PACK)))
}

fn future_record(version: u32) -> Vec<u8> {
    let v = serde_json::json!({"schemaVersion": version, "seq": "999", "txn": TxnId::new(), "at": 0, "record": {"kind": "fromTheFuture"}});
    serde_json::to_vec(&v).unwrap()
}

/// Append `bytes` to `file` as raw bytes (a torn frame).
fn append_raw(file: &Path, bytes: &[u8]) {
    let mut f = std::fs::OpenOptions::new().append(true).open(file).unwrap();
    f.write_all(bytes).unwrap();
}

/// The first `n` bytes of a whole frame: what a crash mid-append leaves.
fn torn_frame(n: usize) -> Vec<u8> {
    frame::encode(b"{\"schemaVersion\":2}")[..n].to_vec()
}

/// Rewrite the journal with the first record of `kind` labelled `version`.
fn relabel_first(dir: &Path, kind: &str, version: u32) {
    let path = dir.join(JOURNAL_FILE);
    let scan = frame::scan(&std::fs::read(&path).unwrap()).unwrap();
    let mut done = false;
    let mut out = Vec::new();
    for f in scan.frames {
        let mut v: serde_json::Value = serde_json::from_slice(&f.payload).unwrap();
        if !done && v["record"]["kind"] == kind {
            v["schemaVersion"] = version.into();
            done = true;
        }
        out.extend(frame::encode(&serde_json::to_vec(&v).unwrap()));
    }
    assert!(done, "the journal has a {kind} record");
    std::fs::write(&path, out).unwrap();
}

fn reopen(dir: &Path) -> (Writer, OpenReport) {
    Writer::open(config(dir, SyncPolicy::Full).0).expect("reopen")
}

fn open_max(dir: &Path, max: u32) -> Result<(Writer, OpenReport), TxnError> {
    Writer::open_with_max_schema(config(dir, SyncPolicy::Full).0, max)
}

/// The open is refused as `FUTURE_FORMAT` and neither file changed a byte.
#[track_caller]
fn assert_off_and_untouched(dir: &Path, max: u32) {
    let before = hashes(dir);
    match open_max(dir, max) {
        Err(e) => assert_eq!(e.code(), "JOURNAL_FUTURE_FORMAT", "max {max}: {e}"),
        Ok(_) => panic!("max {max}: a future record must turn the journal off"),
    }
    assert_eq!(
        hashes(dir),
        before,
        "max {max}: both files unchanged byte for byte"
    );
}

#[test]
fn future_format_in_the_middle_leaves_unchanged_bytes_and_journal_off() {
    for (max, version) in CASES {
        let dir = tmp();
        let doc = DocId::new();
        {
            let (w, _) = open(dir.path());
            human_save(&w, doc, "a");
            w.debug_append_raw(&future_record(version)).unwrap();
            human_save(&w, doc, "ab");
        }
        assert_off_and_untouched(dir.path(), max);
    }
}

#[test]
fn future_format_at_the_tail_leaves_unchanged_bytes_and_journal_off() {
    for (max, version) in CASES {
        let dir = tmp();
        {
            let (w, _) = open(dir.path());
            human_save(&w, DocId::new(), "a");
            w.debug_append_raw(&future_record(version)).unwrap();
        }
        assert_off_and_untouched(dir.path(), max);
    }
}

#[test]
fn future_format_before_a_torn_tail_truncates_nothing() {
    for (max, version) in CASES {
        let dir = tmp();
        {
            let (w, _) = open(dir.path());
            human_save(&w, DocId::new(), "a");
            w.debug_append_raw(&future_record(version)).unwrap();
        }
        append_raw(&dir.path().join(JOURNAL_FILE), &torn_frame(10));
        assert_off_and_untouched(dir.path(), max);
    }
}

#[test]
fn future_format_with_a_torn_blob_pack_tail_leaves_both_files_unchanged_bytes() {
    for (max, version) in CASES {
        let dir = tmp();
        {
            let (w, _) = open(dir.path());
            human_save(&w, DocId::new(), "a");
            w.debug_append_raw(&future_record(version)).unwrap();
        }
        append_raw(&dir.path().join(JOURNAL_FILE), &torn_frame(20));
        append_raw(&dir.path().join(BLOB_PACK), &torn_frame(6));
        assert_off_and_untouched(dir.path(), max);
    }
}

#[test]
fn future_format_content_record_before_a_v2_dependent_is_future_not_corrupt() {
    let dir = tmp();
    let doc = DocId::new();
    {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "a");
        human_save(&w, doc, "ab");
    }
    relabel_first(dir.path(), "observedRevision", SCHEMA_V2 + 1);
    assert_off_and_untouched(dir.path(), SCHEMA_V2);
}

#[test]
fn future_format_two_document_journal_is_off_for_every_document() {
    let dir = tmp();
    let (a, b) = (DocId::new(), DocId::new());
    {
        let (w, _) = open(dir.path());
        human_save(&w, a, "a");
        human_save(&w, b, "b");
        human_save(&w, b, "bb");
        // What a writable open would close by appending.
        ensure_epoch(&w, b);
        w.prepare(prepare_req(b, w.head(b), "bb", ReviewOp::None))
            .unwrap();
    }
    relabel_first(dir.path(), "observedRevision", SCHEMA_V2 + 1);
    assert_off_and_untouched(dir.path(), SCHEMA_V2);
}

#[test]
fn a_v3_labelled_record_of_a_v2_kind_opens_under_schema_v3() {
    const { assert!(MAX_SUPPORTED_SCHEMA >= 3, "this build reads schema v3") };
    let dir = tmp();
    let doc = DocId::new();
    let live = {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "a");
        human_save(&w, doc, "ab");
        w.snapshot()
    };
    relabel_first(dir.path(), "observedRevision", 3);
    let (w, _) = reopen(dir.path());
    let now = w.snapshot().state;
    assert_eq!(now.docs[&doc].head, live.state.docs[&doc].head);
    assert_eq!(now.revisions, live.state.revisions);
}

#[test]
fn a_v2_journal_still_opens_and_new_records_stay_v2() {
    let dir = tmp();
    let doc = DocId::new();
    let live = {
        let (w, _) = open(dir.path());
        human_save(&w, doc, "a");
        human_save(&w, doc, "ab");
        let records = w.debug_records();
        assert!(!records.is_empty());
        assert!(
            records.iter().all(|e| e.schema_version == SCHEMA_V2),
            "no v3 kind or field is used, so every record is labelled 2"
        );
        w.snapshot()
    };
    let (w, report) = reopen(dir.path());
    assert_eq!(report.truncated_tail_bytes, 0);
    let now = w.snapshot().state;
    assert_eq!(now.docs[&doc].head, live.state.docs[&doc].head);
    assert_eq!(now.revisions, live.state.revisions);
}

/// A real receipted `prepared` (top level, schema 3) from `dir`'s journal,
/// written through the controller with a request id.
fn receipted_prepared(dir: &Path) -> serde_json::Value {
    use crate::agent_journal::admission::admission_support::{body, controller, request_id};
    let (c, _) = controller(dir);
    c.prepare(&body(None, "", Some(&request_id())).to_string())
        .expect("prepare");
    let raw = c.writer.lock().journal.read_all().expect("journal");
    raw.iter()
        .map(|p| serde_json::from_slice::<serde_json::Value>(p).unwrap())
        .find(|v| v["receipt"].is_object())
        .expect("a receipted prepared")
}

/// The receipt kinds and comment carriers, labelled `version`: a
/// `prepared` answered by a `decision` receipt, and every real schema-5
/// comment carrier (a create's `admission` frame, a receipted top-level
/// create and reply, a resolve and a delete) written through the handles.
fn deferred_kinds(prepared: &serde_json::Value, version: u32) -> Vec<serde_json::Value> {
    use crate::agent_journal::comment::comment_support::{carrier_journal, relabel, v5_records};
    let mut decision = prepared.clone();
    decision["schemaVersion"] = version.into();
    // The frozen revert decision (fixtures/receipts.json), so the case is
    // refused for its label and not for a malformed outcome.
    let fixtures: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/receipts.json")).expect("fixtures");
    let decided = fixtures["receipts"]
        .as_array()
        .expect("receipts")
        .iter()
        .find(|f| f["name"] == "revertDecided")
        .expect("the revert decision fixture");
    let receipt: serde_json::Value =
        serde_json::from_str(decided["receipt"].as_str().expect("receipt")).expect("receipt");
    decision["receipt"]["outcome"] = receipt["outcome"].clone();
    let (r, _) = carrier_journal();
    let carriers = v5_records(&r);
    let kinds: Vec<_> = carriers
        .iter()
        .map(|v| v["record"]["kind"].clone())
        .collect();
    assert_eq!(
        kinds,
        [
            "admission",
            "commentCreated",
            "commentReplied",
            "commentState",
            "commentDeleted"
        ],
        "every schema-5 carrier is real"
    );
    let mut out = vec![decision];
    out.extend(carriers.iter().map(|v| relabel(v, version)));
    out
}

#[test]
fn deferred_receipt_kinds_under_a_newer_schema_are_future_format_with_torn_tails() {
    let source = tmp();
    let prepared = receipted_prepared(source.path());
    for (case, future) in deferred_kinds(&prepared, MAX_SUPPORTED_SCHEMA + 1)
        .into_iter()
        .enumerate()
    {
        let dir = tmp();
        {
            let (w, _) = open(dir.path());
            human_save(&w, DocId::new(), "a");
            w.debug_append_raw(&serde_json::to_vec(&future).unwrap())
                .unwrap();
        }
        append_raw(&dir.path().join(JOURNAL_FILE), &torn_frame(9 + case));
        append_raw(&dir.path().join(BLOB_PACK), &torn_frame(5));
        assert_off_and_untouched(dir.path(), MAX_SUPPORTED_SCHEMA);
    }
}

#[test]
fn a_schema_4_reader_meeting_real_comment_records_is_future_format_with_torn_tails() {
    use crate::agent_journal::comment::comment_support::carrier_journal;
    let (r, _) = carrier_journal();
    let dir = r.dir.path().to_path_buf();
    let _keep = {
        let crate::agent_journal::admission::request_support::Rig { dir: d, c, .. } = r;
        drop(c);
        d
    };
    append_raw(&dir.join(JOURNAL_FILE), &torn_frame(9));
    append_raw(&dir.join(BLOB_PACK), &torn_frame(5));
    assert_off_and_untouched(&dir, 4);
}

#[test]
fn deferred_receipt_kinds_labelled_schema_3_are_corrupt() {
    use crate::agent_journal::codec;
    let source = tmp();
    let prepared = receipted_prepared(source.path());
    assert!(
        matches!(
            codec::decode(&serde_json::to_vec(&prepared).unwrap()),
            Ok(codec::Decoded::Known(_))
        ),
        "the unmodified receipted prepared decodes"
    );
    for (case, v3) in deferred_kinds(&prepared, 3).into_iter().enumerate() {
        let err = codec::decode(&serde_json::to_vec(&v3).unwrap())
            .err()
            .unwrap_or_else(|| panic!("case {case}: decoded a deferred kind inside schema 3"));
        assert_eq!(err.code(), "JOURNAL_CORRUPT", "case {case}: {err}");
        assert!(
            err.to_string().contains("labelled schemaVersion 3"),
            "case {case} is refused for its label, not another defect: {err}"
        );
    }
}
