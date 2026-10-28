// WI-AL1.2 — schema v2 migration: v1 histories decode conservatively, a newer schema turns the journal off untouched, blocks and payloads survive hydration and reopen
//! WI-AL0.1 (R23) — schema v2 persistence of provenance. v1 histories
//! decode conservatively (no map → every live hunk of a v1 revision is
//! blocked `snapshotOnly`/`schemaV1`); a v1 record carrying a v2 field is
//! corrupt; a v1-only build opening a v2 journal leaves it off and untouched.
//! Blocks, `lastCertified`, epochs and payload bytes survive replay and
//! hydration (compaction is tested with the collector).

use super::test_review_helpers::{decide, revert_planned, two_hunks};
use super::test_support::*;
use crate::agent_journal::codec::decode;
use crate::agent_journal::hydration::HydratedView;
use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::journal_file::{SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::provenance::{Block, BreakReason};
use crate::agent_journal::record::{
    Envelope, Record, MAX_SUPPORTED_SCHEMA, SCHEMA_V2, SCHEMA_VERSION,
};
use crate::agent_journal::review::{HunkState, ReviewAction, ReviewOp};
use crate::agent_journal::writer::Writer;
use serde_json::{json, Value};

fn reopen(dir: &std::path::Path) -> (Writer, crate::agent_journal::writer::OpenReport) {
    Writer::open(config(dir, SyncPolicy::Full).0).expect("reopen")
}

/// `env` as the v1 spike wrote it: no provenance, no epochs, R16 span and
/// hunk fields, no block. `None` for a record kind v1 did not have.
fn to_v1(env: &Envelope, seq: u64) -> Option<Value> {
    let mut v = serde_json::to_value(env).unwrap();
    let kind = v["record"]["kind"].as_str().unwrap().to_string();
    if kind.starts_with("epoch") {
        return None;
    }
    v["schemaVersion"] = json!(1);
    v["seq"] = json!(seq.to_string());
    let record = v["record"].as_object_mut().unwrap();
    record.remove("provenance");
    let hunks = |h: &mut Value| {
        h.as_array_mut()
            .into_iter()
            .flatten()
            .for_each(|h| h["doubt"] = Value::Null)
    };
    if let Some(h) = record.get_mut("hunks") {
        hunks(h);
    }
    if let Some(effects) = record.get_mut("effects") {
        if let Some(h) = effects.get_mut("newHunks") {
            hunks(h);
        }
        for span in effects
            .get_mut("spans")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            let s = span.as_object_mut().unwrap();
            s.remove("block");
            s.remove("lastCertified");
            s.insert("textHash".into(), json!(BlobHash::of_text("x")));
            s.insert("hull".into(), Value::Null);
            s.insert("doubt".into(), Value::Null);
            s.insert("woken".into(), json!(false));
        }
    }
    Some(v)
}

/// Rewrite the journal in `dir` as a v1 journal (blobs kept).
fn downgrade_journal(dir: &std::path::Path) {
    let records = reopen(dir).0.debug_records();
    std::fs::remove_file(dir.join(JOURNAL_FILE)).unwrap();
    let (w, _) = open(dir);
    let mut seq = 0;
    for env in &records {
        if let Some(v) = to_v1(env, seq + 1) {
            seq += 1;
            w.debug_append_raw(&serde_json::to_vec(&v).unwrap())
                .unwrap();
        }
    }
}

#[test]
fn a_v1_history_decodes_with_every_live_hunk_blocked_and_stays_writable() {
    let dir = tmp();
    let doc = DocId::new();
    let (a, b) = {
        let (w, _) = open(dir.path());
        let (a, b) = two_hunks(&w, doc);
        decide(&w, doc, ReviewAction::Keep, &[(&a, 0)]).unwrap();
        human_edit(&w, doc, "xx", &[]); // a revision restating both spans
        w.close_epoch(doc, w.epoch(doc).unwrap()).unwrap();
        (a, b)
    };
    downgrade_journal(dir.path());
    let (w, report) = reopen(dir.path());
    assert!(report.unclosed_epochs.is_empty());
    assert!(
        w.debug_records().iter().all(|e| e.schema_version == 1),
        "a pure v1 journal"
    );
    let v1_spans = w
        .debug_records()
        .iter()
        .filter_map(|e| match &e.record {
            Record::ObservedRevision { effects, .. } => Some(effects.spans.len()),
            _ => None,
        })
        .sum::<usize>();
    assert_eq!(
        v1_spans, 2,
        "v1 spans (textHash/hull/doubt/woken) were upgraded"
    );
    let s = w.snapshot().state;
    let v1 = Some(Block::new(BreakReason::SnapshotOnly, "schemaV1").unwrap());
    for id in [&a, &b] {
        let span = &s.docs[&doc].hunks[id].span;
        assert_eq!(
            (span.block.clone(), span.last_certified),
            (v1.clone(), None),
            "absent provenance is unknown, never exact"
        );
    }
    assert_eq!(
        (s.docs[&doc].hunks[&a].state, s.docs[&doc].hunks[&b].state),
        (HunkState::Kept, HunkState::Pending),
        "review state is kept"
    );
    assert_eq!(
        w.plan_revert(doc, &b).unwrap_err().code(),
        "AMBIGUOUS_REVERT"
    );
    // Writable: new work is v2 and certified; the v1 blocks stay.
    let (_, h) = agent_change(
        &w,
        doc,
        "xx",
        "xxz",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    let id = w.snapshot().state.docs[&doc]
        .hunks
        .iter()
        .find(|(_, e)| e.hunk.target == h)
        .map(|(id, _)| id.clone())
        .unwrap();
    assert_eq!(revert_planned(&w, doc, &id).unwrap(), "xx");
    assert_eq!(w.snapshot().state.docs[&doc].hunks[&b].span.block, v1);
    assert_eq!(
        w.debug_records().last().unwrap().schema_version,
        SCHEMA_V2,
        "a new record of a v2 kind is labelled v2"
    );
}

#[test]
fn a_v1_record_carrying_a_v2_field_or_kind_is_corrupt() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    two_hunks(&w, doc);
    let records = w.debug_records();
    let committed = records
        .iter()
        .find(|e| matches!(e.record, Record::Committed { .. }))
        .unwrap();
    let mut with_provenance = to_v1(committed, 1).unwrap();
    with_provenance["record"]["provenance"] =
        serde_json::to_value(&committed.record).unwrap()["provenance"].clone();
    let mut with_block = to_v1(committed, 1).unwrap();
    with_block["record"]["effects"]["spans"] = json!([{"hunkId": "h", "range": {"from": 0, "to": 1}, "growing": false, "editedSince": false, "block": null}]);
    let mut epoch = serde_json::to_value(
        records
            .iter()
            .find(|e| matches!(e.record, Record::EpochArmed { .. }))
            .unwrap(),
    )
    .unwrap();
    epoch["schemaVersion"] = json!(1);
    for (what, v) in [
        ("provenance", with_provenance),
        ("block", with_block),
        ("epoch record", epoch),
    ] {
        assert_eq!(
            decode(&serde_json::to_vec(&v).unwrap()).unwrap_err().code(),
            "JOURNAL_CORRUPT",
            "{what}"
        );
    }
}

#[test]
fn a_v1_only_build_leaves_a_v2_journal_off_and_untouched() {
    assert_eq!((SCHEMA_VERSION, MAX_SUPPORTED_SCHEMA), (5, 5));
    let dir = tmp();
    let doc = DocId::new();
    // A transaction left open by the newer build: its reservation died with
    // it, and an older reader must not end it either.
    {
        let (w, _) = open(dir.path());
        two_hunks(&w, doc);
        let other = DocId::new();
        w.prepare(prepare_req(other, None, "", ReviewOp::None))
            .unwrap();
    }
    let path = dir.path().join(JOURNAL_FILE);
    let before = std::fs::read(&path).unwrap();
    let err = Writer::open_with_max_schema(config(dir.path(), SyncPolicy::Full).0, 1)
        .err()
        .expect("a v1-only build cannot open a v2 journal");
    assert_eq!(err.code(), "JOURNAL_FUTURE_FORMAT");
    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "the journal is untouched"
    );
    let (w, report) = reopen(dir.path());
    assert_eq!(report.uncommitted.len(), 1, "the v2 writer reads it all");
    assert!(w.snapshot().state.docs[&doc].hunks.len() == 2);
}

/// Blocks, lastCertified, epochs and every retained payload, byte for byte.
fn provenance_view(w: &Writer) -> (String, Vec<(String, Value)>) {
    let docs = format!(
        "{:?}",
        w.snapshot()
            .state
            .docs
            .values()
            .map(|d| (&d.hunks, d.epoch, d.head))
            .collect::<Vec<_>>()
    );
    let payloads = w
        .debug_records()
        .iter()
        .filter_map(|e| {
            let v = serde_json::to_value(&e.record).unwrap();
            (!v["provenance"].is_null()).then(|| (e.txn.to_string(), v["provenance"].clone()))
        })
        .collect();
    (docs, payloads)
}

#[test]
fn blocks_epochs_and_payloads_survive_hydration_and_reopen() {
    let dir = tmp();
    let doc = DocId::new();
    let (before, payloads_before) = {
        let (w, _) = open(dir.path());
        let (a, _) = two_hunks(&w, doc);
        let mut view = HydratedView::hydrate(&w);
        snapshot_save(&w, doc, "xx"); // blocks both, lastCertified set
        for t in ["xx!", "xx!!", "xx!!!"] {
            human_save(&w, doc, t);
        }
        view.pump(&w).unwrap();
        assert_eq!(
            view.state,
            w.snapshot().state,
            "hydration carries blocks and epochs"
        );
        assert!(w.snapshot().state.docs[&doc].hunks[&a].span.block.is_some());
        w.close_epoch(doc, w.epoch(doc).unwrap()).unwrap();
        provenance_view(&w)
    };
    let (w, _) = reopen(dir.path());
    let (docs, payloads) = provenance_view(&w);
    assert_eq!(docs, before, "replay restores spans, blocks and epochs");
    assert_eq!(payloads, payloads_before, "payloads are byte-identical");
}

#[test]
fn a_mapped_span_without_its_block_field_is_malformed() {
    use crate::agent_journal::review::MappedSpan;
    let span = json!({"hunkId": "a".repeat(64), "range": {"from": 0, "to": 1}, "growing": false, "editedSince": false});
    assert!(
        serde_json::from_value::<MappedSpan>(span.clone()).is_err(),
        "an absent block is not 'certified'"
    );
    let mut certified = span;
    certified["block"] = Value::Null;
    assert_eq!(
        serde_json::from_value::<MappedSpan>(certified)
            .unwrap()
            .block,
        None
    );
}
