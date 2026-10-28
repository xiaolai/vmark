// WI-AL1.2 — provenance review golden: mapped spans, lastCertified pins, revert gate (AMBIGUOUS_REVERT), epochs and barriers match the shared fixture
//! WI-AL0.8 (R21–R23) — Rust/TS parity on the review-side writer vectors of
//! the writer vectors of `src/test/fixtures/agentJournal/provenance.json`: `mappedSpans` (persisted span derivation,
//! `lastCertified`), `revertGate` (the two pre-prepare steps and the
//! refusal's `block`), `epochs` (arm/close/restart sequences, their journal
//! records, the restart block, the writer's no-epoch marker) and
//! `barriers` (the whole break each op records without a map). Every entry
//! is iterated; spans are compared byte for byte with the file's layout.
//! The two fields that once only TypeScript read are read here too:
//! `mappedSpans[].pinsLastCertified` against the real pin projection, and
//! `revertGate[].replay` driven through the real writer, restart included.

use std::collections::BTreeMap;

use super::test_golden_prov::*;
use super::test_review_helpers::state;
use super::test_support::*;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::pins::{self, PinReason, Roots};
use crate::agent_journal::projection::{DocState, EpochState, HunkEntry, Projection};
use crate::agent_journal::provenance::{Provenance, ProvenancePayload, PROVENANCE_CAP};
use crate::agent_journal::record::{Envelope, Record, SCHEMA_VERSION};
use crate::agent_journal::review::{
    Hunk, HunkKind, HunkState, MappedSpan, RestoreSource, ReviewOp,
};
use crate::agent_journal::span_map::{derive, DeriveCtx};
use crate::agent_journal::writer::{CommitRequest, Writer};
use serde_json::{json, Value};

fn entry(id: &str, state: HunkState, span: MappedSpan) -> HunkEntry {
    let empty = BlobHash::of_text("");
    let hunk = Hunk {
        id: HunkId(id.into()),
        kind: HunkKind::Change,
        base: None,
        target: RevisionId::new(),
        base_range: r(0, 0),
        target_range: r(0, 0),
        base_text_hash: empty.clone(),
        target_text_hash: empty,
    };
    HunkEntry {
        hunk,
        state,
        review_gen: 0,
        span,
        attached_revert: None,
        blocked_at: None,
    }
}

fn span(v: &Value) -> MappedSpan {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("span {v} refused: {e}"))
}

#[test]
fn every_mapped_span_is_derived_like_the_reference() {
    let (g, text) = (golden(), golden_text());
    let (mut checked, mut pinned) = (0, 0);
    for v in entries(&g, "mappedSpans") {
        let name = s(v, "name");
        let mut window = Provenance::new(utf16(s(v, "pre")), PROVENANCE_CAP).unwrap();
        apply_transactions(&mut window, &v["transactions"]);
        let parent: Option<RevisionId> =
            serde_json::from_value(v["parent"].clone()).expect("parent");
        let mut doc = DocState {
            head: parent,
            ..Default::default()
        };
        let id = s(&v["before"], "hunkId");
        doc.hunks.insert(
            HunkId(id.into()),
            entry(id, HunkState::Pending, span(&v["before"])),
        );
        let ctx = DeriveCtx {
            doc: &doc,
            parent,
            op: &ReviewOp::Review,
            window: &window,
            postimage: "",
            new_hunks: &[],
            reverted: None,
        };
        match (derive(&ctx), &v["expect"]) {
            (Err(_), e) if e == "error" => {}
            (Ok(d), e) if e != "error" => {
                assert_eq!(d.spans.len(), 1, "{name}");
                assert_eq!(&serde_json::to_value(&d.spans[0]).unwrap(), e, "{name}");
                assert_bytes(&text, name, "expect", &d.spans[0], 6);
                check_last_certified_pin(v, &d.spans[0]);
                pinned += usize::from(v["pinsLastCertified"] == true);
            }
            (got, e) => panic!("{name}: Rust {got:?}, reference {e}"),
        }
        checked += 1;
    }
    assert_eq!(checked, g["mappedSpans"].as_array().unwrap().len());
    let flagged = entries(&g, "mappedSpans")
        .iter()
        .filter(|v| v.get("pinsLastCertified").is_some())
        .count();
    assert_eq!(
        (pinned, flagged > 0),
        (flagged, true),
        "every pinsLastCertified vector checked, and there is one"
    );
}

/// `pinsLastCertified`: the real pin projection (ADR-AL13) of a live hunk
/// holding the derived span pins exactly its `lastCertified.at` as
/// `LastCertified` — the revision the panel draws a blocked hunk in.
fn check_last_certified_pin(v: &Value, derived: &MappedSpan) {
    let name = s(v, "name");
    let flag = &v["pinsLastCertified"];
    assert!(
        flag.is_null() || flag == true,
        "{name}: pinsLastCertified is true when present"
    );
    let doc = DocId::new();
    let id = HunkId(s(&v["before"], "hunkId").into());
    let mut d = DocState::default();
    d.hunks.insert(
        id.clone(),
        entry(&id.0, HunkState::Pending, derived.clone()),
    );
    let mut p = Projection::default();
    p.docs.insert(doc, d);
    let (bases, external) = (BTreeMap::new(), Default::default());
    let set = pins::compute(
        &p,
        Roots {
            window_bases: &bases,
            external: &external,
            queued_blobs: vec![],
        },
    );
    let got: Vec<RevisionId> = set
        .revisions
        .iter()
        .filter(|(_, why)| why.contains(&PinReason::LastCertified(id.clone())))
        .map(|(r, _)| *r)
        .collect();
    let want: Vec<RevisionId> = derived.last_certified.map(|lc| lc.at).into_iter().collect();
    assert_eq!(got, want, "{name}: LastCertified pins");
    if flag == true {
        assert!(
            derived.block.is_some() && !want.is_empty(),
            "{name}: the vector pins a blocked hunk's lastCertified.at"
        );
        let at: RevisionId =
            serde_json::from_value(v["expect"]["lastCertified"]["at"].clone()).unwrap();
        assert_eq!(got, vec![at], "{name}: pins expect.lastCertified.at");
    }
}

#[test]
fn every_revert_gate_vector_is_decided_like_the_reference() {
    let g = golden();
    let mut checked = 0;
    for v in entries(&g, "revertGate") {
        let name = s(v, "name");
        let mut doc = DocState::default();
        for h in std::iter::once(&v["hunk"]).chain(v["others"].as_array().unwrap()) {
            let state: HunkState = serde_json::from_value(h["state"].clone()).unwrap();
            let sp = span(
                &json!({"hunkId": h["hunkId"], "range": h["range"], "growing": h["growing"], "editedSince": false, "block": h["block"]}),
            );
            assert!(
                doc.hunks
                    .insert(
                        HunkId(s(h, "hunkId").into()),
                        entry(s(h, "hunkId"), state, sp)
                    )
                    .is_none(),
                "{name}: duplicate hunk"
            );
        }
        let got = match crate::agent_journal::revert_gate::gate(
            &doc,
            &HunkId(s(&v["hunk"], "hunkId").into()),
        ) {
            Ok(()) => Value::Null,
            Err(crate::agent_journal::errors::TxnError::AmbiguousRevert { hunk, block }) => {
                json!({"code": "AMBIGUOUS_REVERT", "hunk": hunk.0, "block": block})
            }
            Err(e) => panic!("{name}: unexpected refusal {e}"),
        };
        assert_eq!(got, v["expect"], "{name}");
        checked += 1;
    }
    assert_eq!(checked, g["revertGate"].as_array().unwrap().len());
}

/// A `replay` edit list `[[from, to, insert], …]` (UTF-16, applied in
/// order) as certified edits, and the text it makes of `pre`.
fn replay_ops(pre: &str, ops: &Value) -> (Vec<Edit>, String) {
    let mut text: Vec<u16> = pre.encode_utf16().collect();
    let mut edits = Vec::new();
    for op in ops.as_array().expect("ops") {
        let (from, to, insert) = (
            op[0].as_u64().unwrap(),
            op[1].as_u64().unwrap(),
            op[2].as_str().unwrap(),
        );
        let ins: Vec<u16> = insert.encode_utf16().collect();
        text.splice(from as usize..to as usize, ins.iter().copied());
        edits.push(Edit {
            at: from,
            delete: to - from,
            insert: ins.len() as u64,
        });
    }
    (edits, String::from_utf16(&text).unwrap())
}

/// `revertGate[].replay`: the ledger history reaching the vector's state,
/// driven through the real writer. A plan made before the restart is
/// refused at prepare with the vector's code and block; the stale plan has
/// no reservation to commit under; nothing is recorded; the text is the
/// vector's.
#[test]
fn every_revert_gate_replay_is_refused_like_the_reference() {
    let g = golden();
    let mut replayed = 0;
    for v in entries(&g, "revertGate")
        .iter()
        .filter(|v| v.get("replay").is_some())
    {
        let (name, rp, want) = (s(v, "name"), &v["replay"], &v["expect"]);
        let (dir, doc) = (tmp(), DocId::new());
        let mut w = Some(open_fast(dir.path()).0);
        human_save(w.as_ref().unwrap(), doc, s(rp, "pre"));
        let (mut id, mut plan, mut gen) = (None, None, None);
        for (i, step) in entries(rp, "steps").iter().enumerate() {
            let at = format!("{name}: step {i} ({})", s(step, "call"));
            let writer = w.as_ref().unwrap();
            match s(step, "call") {
                "agentEdit" => {
                    let pre = head_text(writer, doc);
                    let (edits, post) = replay_ops(&pre, &step["ops"]);
                    assert_eq!(edits.len(), 1, "{at}: one agent edit per step");
                    agent_change(writer, doc, &pre, &post, edits[0]);
                    let mut ids = hunk_ids(writer, doc);
                    assert_eq!(ids.len(), 1, "{at}");
                    id = ids.pop();
                }
                "humanEdit" => {
                    let (edits, post) = replay_ops(&head_text(writer, doc), &step["ops"]);
                    human_edit(writer, doc, &post, &edits);
                }
                "planRevert" => {
                    let h = id.as_ref().expect("an agent hunk to plan");
                    let p = writer
                        .plan_revert(doc, h)
                        .unwrap_or_else(|e| panic!("{at}: {e}"));
                    assert!(
                        matches!(
                            p.decision,
                            crate::agent_journal::revert_gate::RevertDecision::Apply { .. }
                        ),
                        "{at}: a ready plan"
                    );
                    gen = Some(state(writer, doc, h).1);
                    plan = Some(p);
                }
                "restart" => {
                    drop(w.take());
                    let (next, unclosed) = reopen(dir.path(), doc);
                    assert!(
                        !unclosed.is_empty(),
                        "{at}: the restart finds the open epoch"
                    );
                    w = Some(next);
                }
                "prepare" => {
                    let h = id.clone().unwrap();
                    let before = (writer.snapshot().generation, writer.debug_records().len());
                    let op = ReviewOp::HunkRevert {
                        hunk_id: h.clone(),
                        expected_review_gen: gen.unwrap(),
                    };
                    let got = match writer.prepare(prepare_req(
                        doc,
                        writer.head(doc),
                        &head_text(writer, doc),
                        op,
                    )) {
                        Err(TxnError::AmbiguousRevert { hunk, block }) => {
                            assert_eq!(hunk, h, "{at}: refusal names the planned hunk");
                            json!({"code": "AMBIGUOUS_REVERT", "block": block})
                        }
                        other => panic!("{at}: expected AMBIGUOUS_REVERT, got {other:?}"),
                    };
                    assert_eq!(
                        got,
                        json!({"code": want["code"], "block": want["block"]}),
                        "{at}"
                    );
                    assert_eq!(
                        (writer.snapshot().generation, writer.debug_records().len()),
                        before,
                        "{at}: nothing recorded"
                    );
                }
                "commitRevert" => {
                    let p = plan.take().expect("a plan to commit");
                    let before = (writer.snapshot().generation, writer.debug_records().len());
                    let req = CommitRequest {
                        postimage: s(rp, "text").into(),
                        resolves: None,
                        provenance: None,
                        effects: p.effects,
                    };
                    let err = writer
                        .commit(TxnId::new(), req)
                        .expect_err("the stale plan has no prepared transaction");
                    assert_eq!(
                        err.code(),
                        "INVALID_REQUEST",
                        "{at}: refused as a commit with no reservation: {err}"
                    );
                    assert_eq!(
                        (writer.snapshot().generation, writer.debug_records().len()),
                        before,
                        "{at}: nothing recorded"
                    );
                }
                other => panic!("{at}: unknown call {other}"),
            }
        }
        let writer = w.as_ref().unwrap();
        assert_eq!(head_text(writer, doc), s(rp, "text"), "{name}: text");
        let h = id.unwrap();
        assert_eq!(
            writer.snapshot().state.docs[&doc].hunks[&h].state,
            HunkState::Pending,
            "{name}: hunk untouched"
        );
        replayed += 1;
    }
    assert!(replayed > 0, "the golden file has a revertGate replay");
}

fn reopen(dir: &std::path::Path, doc: DocId) -> (Writer, Vec<String>) {
    let (w, report) = Writer::open(config(dir, SyncPolicy::None).0).expect("reopen");
    let unclosed = report
        .unclosed_epochs
        .iter()
        .filter(|(d, _)| *d == doc)
        .map(|(_, e)| e.to_string())
        .collect();
    (w, unclosed)
}

#[test]
fn every_epoch_sequence_runs_like_the_reference() {
    let g = golden();
    let sequences = entries(&g["epochs"], "sequences");
    for seq in sequences {
        let name = s(seq, "name");
        let (dir, doc) = (tmp(), DocId::new());
        let mut w = Some(open_fast(dir.path()).0);
        for (i, step) in entries(seq, "steps").iter().enumerate() {
            let e = &step["expect"];
            let writer = w.as_ref().unwrap();
            let got = match s(step, "call") {
                "arm" => match writer.arm_epoch(doc) {
                    Ok(epoch) => json!({"ok": true, "epoch": epoch.to_string()}),
                    Err(err) => json!({"ok": false, "code": err.code()}),
                },
                "close" => match writer.close_epoch(doc, s(step, "epoch").parse().unwrap()) {
                    Ok(()) => json!({"ok": true}),
                    Err(err) => json!({"ok": false, "code": err.code()}),
                },
                "restart" => {
                    drop(w.take());
                    let (next, unclosed) = reopen(dir.path(), doc);
                    w = Some(next);
                    json!({"unclosedEpochs": unclosed})
                }
                other => panic!("{name}: unknown call {other}"),
            };
            assert_eq!(&got, e, "{name}: step {i}");
        }
        let kinds: Vec<String> = w
            .as_ref()
            .unwrap()
            .debug_records()
            .iter()
            .map(|e| e.record.kind())
            .collect();
        let want: Vec<&str> = seq["records"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap())
            .collect();
        assert_eq!(kinds, want, "{name}: journal records");
    }
}

#[test]
fn every_restart_block_is_applied_like_the_reference() {
    let (g, text) = (golden(), golden_text());
    let doc = DocId::new();
    for v in entries(&g["epochs"], "restartBlocks") {
        let name = s(v, "name");
        let head: RevisionId = serde_json::from_value(v["head"].clone()).unwrap();
        let mut d = DocState {
            head: Some(head),
            epoch: EpochState {
                last: 1,
                open: Some(1),
            },
            ..Default::default()
        };
        // The vector's spans share one hunk id; the projection keys hunks
        // by a distinct key so each keeps its own entry, in vector order.
        for (i, b) in v["before"].as_array().unwrap().iter().enumerate() {
            d.hunks.insert(
                HunkId(format!("k{i:03}")),
                entry("k", HunkState::Pending, span(b)),
            );
        }
        let mut p = Projection::default();
        p.docs.insert(doc, d);
        let env = Envelope {
            schema_version: SCHEMA_VERSION,
            seq: 1,
            txn: TxnId::new(),
            at: 0,
            record: Record::EpochUnclosed { doc, epoch: 1 },
            receipt: None,
        };
        p.apply(&env).unwrap();
        let got: Vec<&MappedSpan> = p.docs[&doc].hunks.values().map(|h| &h.span).collect();
        assert_eq!(serde_json::to_value(&got).unwrap(), v["expect"], "{name}");
        assert_bytes(&text, name, "expect", &got, 8);
    }
}

/// The last committed payload's epoch and whole break.
fn last_barrier(w: &Writer) -> (String, Value) {
    let p: ProvenancePayload = w
        .debug_records()
        .into_iter()
        .rev()
        .find_map(|e| match e.record {
            Record::Committed { provenance, .. } => provenance,
            _ => None,
        })
        .expect("a committed payload");
    (
        p.epoch().to_string(),
        serde_json::to_value(&p).unwrap()["body"]["breaks"]["whole"].clone(),
    )
}

#[test]
fn every_op_commits_without_a_map_as_its_barrier_under_the_writer_epoch() {
    let g = golden();
    let none_armed = s(&g["epochs"]["writerEpoch"], "noneArmed");
    let barriers = g["barriers"].as_object().expect("barriers");
    assert!(!barriers.is_empty());
    for (op_name, want) in barriers {
        let (dir, doc) = (tmp(), DocId::new());
        let (w, _) = open_fast(dir.path());
        let post = "a\nb\n";
        let source = human_save(&w, doc, post);
        for armed in [false, true] {
            human_save(&w, doc, "x\n"); // arms an epoch (a certified save)
            match (armed, w.epoch(doc)) {
                (false, Some(e)) => w.close_epoch(doc, e).unwrap(),
                (true, None) => drop(w.arm_epoch(doc).unwrap()),
                _ => {}
            }
            let (op, kind) = match op_name.as_str() {
                "review" => (ReviewOp::Review, Some(HunkKind::Change)),
                "none" => (ReviewOp::None, None),
                "restore" => (
                    ReviewOp::Restore {
                        source: RestoreSource::Revision { revision: source },
                    },
                    Some(HunkKind::Restore),
                ),
                other => panic!("barriers: no op named {other}"),
            };
            let (head, pre) = (w.head(doc), head_text(&w, doc));
            let p = w.prepare(prepare_req(doc, head, &pre, op.clone())).unwrap();
            let whole = |t: &str| r(0, utf16(t) as u64);
            let hunks = kind
                .map(|k| hunk(head, p.revision, &pre, post, whole(&pre), whole(post), k))
                .into_iter()
                .collect();
            w.commit(p.txn, barrier_commit_req(&w, doc, post, hunks, &op))
                .unwrap_or_else(|e| panic!("{op_name}: {e}"));
            let (epoch, whole) = last_barrier(&w);
            assert_eq!(&whole, want, "{op_name}: barrier");
            let expected_epoch = if armed {
                w.epoch(doc).unwrap().to_string()
            } else {
                none_armed.to_string()
            };
            assert_eq!(
                epoch, expected_epoch,
                "{op_name}: writer epoch (armed: {armed})"
            );
        }
    }
}
