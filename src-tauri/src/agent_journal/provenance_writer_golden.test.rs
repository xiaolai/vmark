// WI-AL1.2 — provenance writer golden: writer-built payloads, text checks and worker payload checks match the shared fixture
//! WI-AL0.8 (R19–R23) — Rust/TS parity on the writer vectors of
//! the writer vectors of `src/test/fixtures/agentJournal/provenance.json` that concern payloads: `writerCases`,
//! `textChecks`, `workerPayloads`. Every entry is iterated; the count
//! checked must equal the file's. A payload is compared byte for byte with
//! the file's own layout, an error message character for character.
//!
//! The vectors name placeholder ids (`doc-0001`, `r0001`), so the writer
//! is driven with real ids and its window is re-encoded under the vector's
//! ids before the byte comparison; the ids the writer chose are checked
//! separately (document, basis, epoch `0` with none armed). The no-map save
//! (`writer-none-no-map`) is driven as stated instead — its epoch armed, the
//! save built on a pending observation — and the writer's own payload bytes
//! are compared after renaming only the two generated ids.

use super::test_golden_prov::*;
use super::test_review_helpers::revert_planned;
use super::test_support::*;
use crate::agent_journal::ids::{DocId, RevisionId};
use crate::agent_journal::provenance::{Provenance, ProvenancePayload};
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::review::{HunkKind, RestoreSource, ReviewOp};
use crate::agent_journal::writer::{linearization_window, CommitRequest, ObserveRequest, Writer};
use crate::agent_journal::writer_epoch::{basis_of, debug_check_worker_payload};
use serde_json::Value;

fn close_open_epoch(w: &Writer, doc: DocId) {
    if let Some(e) = w.epoch(doc) {
        w.close_epoch(doc, e).unwrap();
    }
}

/// The payload of the last `committed` record, checked against the ids the
/// writer must have chosen: this document, the parent as basis, and the
/// no-epoch marker of the fixture.
fn committed_window(
    w: &Writer,
    doc: DocId,
    parent: Option<RevisionId>,
    none_armed: &str,
) -> Provenance {
    let p: ProvenancePayload = w
        .debug_records()
        .into_iter()
        .rev()
        .find_map(|e| match e.record {
            Record::Committed { provenance, .. } => provenance,
            _ => None,
        })
        .expect("a committed payload");
    assert_eq!(p.document(), doc.to_string());
    assert_eq!(p.basis(), basis_of(parent));
    assert_eq!(
        p.epoch().to_string(),
        none_armed,
        "writer epoch with none armed"
    );
    p.accumulator().unwrap()
}

/// A human save of `post` on `observed`, then the window the writer
/// linearizes it through.
fn observed_window(
    w: &Writer,
    doc: DocId,
    observed: ObservedRef,
    post: &str,
    gap: bool,
) -> Provenance {
    let req = ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: post.into(),
        observed_parent: observed,
        provenance: None,
    };
    let obs = w.observe(req).unwrap().observation;
    let mut state = w.snapshot().state;
    if gap {
        // A gap needs a commit still queued in a degraded writer (races.rs);
        // the window rule reads only the canonical observed parent.
        state.observations.get_mut(&obs).unwrap().observed_parent = ObservedRef::Unjournaled {
            revision: RevisionId::new(),
        };
    }
    linearization_window(&state, doc, obs, &head_text(w, doc), post)
        .unwrap()
        .0
}

/// A save with no map, driven exactly as the vector states it: its epoch
/// armed (epochs 1 … n−1 armed and closed first), and the save built on a
/// pending observation (a basis `o…`). The writer's own payload for that
/// capture is compared byte for byte; only the two generated ids (document,
/// observation) are renamed to the vector's placeholders, each found exactly
/// once. Epoch, basis kind, hashes and body are the writer's, unrenamed.
fn snapshot_on_pending(w: &Writer, doc: DocId, c: &Value, text: &str) -> Provenance {
    let (name, pre, post, g) = (s(c, "name"), s(c, "pre"), s(c, "post"), &c["payload"]);
    assert!(
        s(g, "basis").starts_with('o'),
        "{name}: a no-map save vector must be built on a pending observation"
    );
    let epoch: u64 = s(g, "epoch").parse().expect("epoch");
    assert!(epoch > 0, "{name}: the vector states an armed epoch");
    for _ in 1..epoch {
        let e = w.arm_epoch(doc).unwrap();
        w.close_epoch(doc, e).unwrap();
    }
    assert_eq!(w.arm_epoch(doc).unwrap(), epoch);
    let save = |text: &str, observed_parent| {
        let req = ObserveRequest {
            doc,
            actor: human(),
            initiator: human(),
            postimage: text.into(),
            observed_parent,
            provenance: None,
        };
        w.observe(req).unwrap().observation
    };
    let first = save(pre, ObservedRef::Genesis);
    save(post, ObservedRef::Pending { observation: first });
    linearize(w, doc); // `first`; the no-map save on it is next
    let p = w.debug_capture_payload(doc).unwrap();
    assert_eq!(
        (p.document().to_string(), p.basis().to_string(), p.epoch()),
        (doc.to_string(), first.to_string(), epoch),
        "{name}"
    );
    let live = serde_json::to_string_pretty(&p).unwrap();
    let mut renamed = live.clone();
    for (id, placeholder) in [
        (doc.to_string(), s(g, "document")),
        (first.to_string(), s(g, "basis")),
    ] {
        assert_eq!(live.matches(&id).count(), 1, "{name}: {id} named once");
        renamed = renamed.replace(&id, placeholder);
    }
    assert_pretty_bytes(text, name, "payload", &renamed, 6);
    p.accumulator().unwrap()
}

/// The window the real writer builds for a `writerCases` vector, chosen by
/// its single transaction. An unknown shape fails rather than skips.
fn writer_window(c: &Value, none_armed: &str, text: &str) -> Provenance {
    let (pre, post) = (s(c, "pre"), s(c, "post"));
    let t = &c["transactions"].as_array().unwrap()[..];
    assert_eq!(t.len(), 1, "{}: one transaction per writer case", c["name"]);
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let doc = DocId::new();
    match (s(&t[0], "kind"), t[0]["origin"].as_str()) {
        ("certified", _) if s(&c["payload"], "basis") == "genesis" => {
            assert_eq!(basis_of(None), "genesis");
            let p: ProvenancePayload = serde_json::from_value(c["payload"].clone()).unwrap();
            let open = Some(p.epoch());
            debug_check_worker_payload(p.document(), open, "genesis", pre, post, &p)
                .expect("genesis window accepted");
            p.accumulator().unwrap()
        }
        ("certified", _) => {
            // A hunk revert: the agent turned `post` into `pre`; reverting
            // its one hunk turns it back.
            human_save(&w, doc, post);
            agent_change(&w, doc, post, pre, diff_edit(post, pre));
            close_open_epoch(&w, doc);
            let parent = w.head(doc);
            let id = hunk_ids(&w, doc).pop().unwrap();
            assert_eq!(revert_planned(&w, doc, &id).unwrap(), post);
            committed_window(&w, doc, parent, none_armed)
        }
        ("breakWhole", Some("agent")) => {
            human_save(&w, doc, pre);
            close_open_epoch(&w, doc);
            let head = w.head(doc);
            let p = w
                .prepare(prepare_req(doc, head, pre, ReviewOp::Review))
                .unwrap();
            let h = hunk(
                head,
                p.revision,
                pre,
                post,
                r(0, utf16(pre) as u64),
                r(0, utf16(post) as u64),
                HunkKind::Change,
            );
            w.commit(
                p.txn,
                barrier_commit_req(&w, doc, post, vec![h], &ReviewOp::Review),
            )
            .unwrap();
            committed_window(&w, doc, head, none_armed)
        }
        ("breakWhole", Some("restore")) => {
            let source = human_save(&w, doc, post);
            human_save(&w, doc, pre);
            close_open_epoch(&w, doc);
            let (head, op) = (
                w.head(doc),
                ReviewOp::Restore {
                    source: RestoreSource::Revision { revision: source },
                },
            );
            let p = w.prepare(prepare_req(doc, head, pre, op.clone())).unwrap();
            let h = hunk(
                head,
                p.revision,
                pre,
                post,
                r(0, utf16(pre) as u64),
                r(0, utf16(post) as u64),
                HunkKind::Restore,
            );
            let req: CommitRequest = barrier_commit_req(&w, doc, post, vec![h], &op);
            w.commit(p.txn, req).unwrap();
            committed_window(&w, doc, head, none_armed)
        }
        ("breakWhole", Some("snapshot")) => snapshot_on_pending(&w, doc, c, text),
        ("breakWhole", Some(origin @ ("concurrentObservation" | "gap"))) => {
            let old = human_save(&w, doc, "x\n");
            human_save(&w, doc, pre);
            observed_window(
                &w,
                doc,
                ObservedRef::Revision { revision: old },
                post,
                origin == "gap",
            )
        }
        (kind, origin) => panic!(
            "{}: no writer path for a {kind} transaction from {origin:?}",
            c["name"]
        ),
    }
}

#[test]
fn every_writer_case_encodes_maps_and_round_trips_like_the_reference() {
    let (g, text) = (golden(), golden_text());
    let cases = entries(&g, "writerCases");
    for c in cases {
        let name = s(c, "name");
        let p = replay(c);
        let payload = encode(c, &p);
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            c["payload"],
            "{name}"
        );
        assert_bytes(&text, name, "payload", &payload, 6);
        check_spans(name, c, &p);
        let decoded: ProvenancePayload = serde_json::from_value(c["payload"].clone()).unwrap();
        decoded
            .check_texts(s(c, "pre"), s(c, "post"))
            .unwrap_or_else(|e| panic!("{name}: texts refused: {e}"));
        check_spans(name, c, &decoded.accumulator().unwrap());
    }
    assert_eq!(cases.len(), g["writerCases"].as_array().unwrap().len());
}

#[test]
fn the_writer_builds_every_writer_case_payload_itself() {
    let (g, text) = (golden(), golden_text());
    let none_armed = s(&g["epochs"]["writerEpoch"], "noneArmed");
    let mut checked = 0;
    for c in entries(&g, "writerCases") {
        let name = s(c, "name");
        let window = writer_window(c, none_armed, &text);
        assert_bytes(&text, name, "payload", &encode(c, &window), 6);
        check_spans(name, c, &window);
        checked += 1;
    }
    assert_eq!(checked, entries(&g, "writerCases").len());
}

#[test]
fn every_text_check_is_decided_like_the_reference() {
    let g = golden();
    let mut checked = 0;
    for v in entries(&g, "textChecks") {
        let name = s(v, "name");
        let payload: ProvenancePayload = serde_json::from_value(v["payload"].clone())
            .unwrap_or_else(|e| panic!("{name}: payload refused: {e}"));
        let got = payload.check_texts(s(v, "pre"), s(v, "post"));
        match v["valid"].as_bool().expect("valid") {
            true => assert_eq!(got, Ok(()), "{name}"),
            false => assert_eq!(got, Err(s(v, "error").to_string()), "{name}"),
        }
        checked += 1;
    }
    assert_eq!(checked, g["textChecks"].as_array().unwrap().len());
}

#[test]
fn every_worker_payload_is_accepted_or_refused_like_the_reference() {
    let g = golden();
    let mut checked = 0;
    for v in entries(&g, "workerPayloads") {
        let (name, win) = (s(v, "name"), &v["window"]);
        let payload: ProvenancePayload = serde_json::from_value(v["payload"].clone())
            .unwrap_or_else(|e| panic!("{name}: payload refused at decode: {e}"));
        let open = win["openEpoch"]
            .as_str()
            .map(|e| e.parse::<u64>().expect("epoch"));
        let got = debug_check_worker_payload(
            s(win, "document"),
            open,
            s(win, "basis"),
            s(win, "pre"),
            s(win, "post"),
            &payload,
        );
        let got = got.map(|()| "accept").unwrap_or_else(|e| e.code());
        assert_eq!(got, s(v, "expect"), "{name}");
        checked += 1;
    }
    assert_eq!(checked, g["workerPayloads"].as_array().unwrap().len());
}
