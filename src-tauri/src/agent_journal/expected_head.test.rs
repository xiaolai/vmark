// WI-AL2.2c — strict expectedHead (R32): every controlled prepare (agent write, restore, revert) states the head it expects, a missing parent key is a decode error and null means genesis, so a null parent on a document past genesis is STALE_PARENT with nothing appended; two windows with a stale expectedHead are both refused unchanged; the baseline records the frozen predecessor the window names (observedParent), never the head relabelled, so a payload built on a pending observation that is no longer the head linearizes as a concurrentObservation with an attributed parentMismatch break
//! R32. Drives the JSON payloads the webview sends.

use serde_json::{json, Value};

use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::controlled::{
    commit_controlled, decode_prepare, prepare_controlled, ControlledPrepared,
};
use crate::agent_journal::controlled_restore::decode_restore_prepare;
use crate::agent_journal::controlled_revert::decode_revert_prepare;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{ConnectionId, RevisionId};
use crate::agent_journal::projection::RevisionKind;
use crate::agent_journal::provenance::{Block, BreakReason};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::{ObserveRequest, Writer};

const KEY: &str = "doc";
const FIXTURE: &str = include_str!("fixtures/receipts.json");

fn mcp_actor() -> Actor {
    Actor::Mcp {
        principal: Principal::Provider {
            provider: "claude-code".into(),
        },
        connection_id: ConnectionId::new(),
        session_label: None,
        display_name: None,
    }
}

fn prepare_json(
    w: &Writer,
    docs: &DocRegistry,
    body: Value,
) -> Result<ControlledPrepared, TxnError> {
    let req = decode_prepare(&serde_json::to_vec(&body).unwrap())?;
    let doc = docs.resolve(&req.doc_key)?;
    prepare_controlled(w, doc, req)
}

fn write_body(parent: Option<RevisionId>, preimage: &str) -> Value {
    json!({
        "docKey": KEY,
        "parent": parent,
        "preimage": preimage,
        "actor": mcp_actor(),
        "tool": "document.write",
    })
}

fn commit(w: &Writer, p: &ControlledPrepared, postimage: &str) -> RevisionId {
    let body = serde_json::to_vec(&json!({ "postimage": postimage })).unwrap();
    commit_controlled(w, p.txn, &body).expect("commit").revision
}

#[test]
fn expected_head_null_means_genesis_and_is_stale_parent_past_genesis() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let first = prepare_json(&w, &docs, write_body(None, "")).expect("null is genesis");
    let r1 = commit(&w, &first, "v1");
    let generation = w.generation();
    let err = prepare_json(&w, &docs, write_body(None, "v1")).unwrap_err();
    assert_eq!(err, TxnError::StaleParent { head: Some(r1) });
    assert_eq!(err.code(), "STALE_PARENT");
    assert_eq!(w.generation(), generation, "nothing appended");
}

#[test]
fn expected_head_is_a_required_key_on_every_controlled_prepare() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    type Decode = fn(&[u8]) -> Result<(), TxnError>;
    let decoders: [(&str, Decode); 3] = [
        ("controlledPrepared", |b| decode_prepare(b).map(drop)),
        ("restorePrepared", |b| decode_restore_prepare(b).map(drop)),
        ("revertPrepared", |b| decode_revert_prepare(b).map(drop)),
    ];
    for (name, decode) in decoders {
        let case = f["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .unwrap();
        let mut body: Value = serde_json::from_str(case["payload"].as_str().unwrap()).unwrap();
        decode(&serde_json::to_vec(&body).unwrap()).expect(name);
        body.as_object_mut().unwrap().remove("parent");
        let err = decode(&serde_json::to_vec(&body).unwrap()).unwrap_err();
        assert_eq!(
            err.code(),
            "INVALID_REQUEST",
            "{name} without parent: {err}"
        );
    }
}

#[test]
fn two_windows_with_a_stale_expected_head_are_refused_and_append_nothing() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let first = prepare_json(&w, &docs, write_body(None, "")).unwrap();
    let r1 = commit(&w, &first, "v1");
    let a = prepare_json(&w, &docs, write_body(Some(r1), "v1")).unwrap();
    let r2 = commit(&w, &a, "v2");
    let generation = w.generation();
    let snapshot = w.snapshot().state;
    for stale in [None, Some(r1)] {
        let err = prepare_json(&w, &docs, write_body(stale, "v1 edited")).unwrap_err();
        assert_eq!(err, TxnError::StaleParent { head: Some(r2) }, "{stale:?}");
    }
    assert_eq!(w.generation(), generation, "nothing appended");
    assert_eq!(
        w.snapshot().state,
        snapshot,
        "no baseline, no review change"
    );
}

#[test]
fn a_payload_on_a_pending_observation_that_is_not_the_head_is_a_concurrent_observation() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "abc");
    let (_, head) = agent_change(
        &w,
        doc,
        "abc",
        "abXc",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    let hunk = hunk_ids(&w, doc)[0].clone();
    // Window A saved "abXc!" (mapped, so it breaks nothing); window B then
    // saved "abXc!?" on A's save. A's buffer "abXc!+" was frozen on its own
    // save, which is no longer the head once B's save is linearized.
    let bang = [Edit {
        at: 4,
        delete: 0,
        insert: 1,
    }];
    let on_head = payload(&w, doc, &basis(Some(head)), "abXc", "abXc!", &bang);
    let mine = observe(&w, doc, "abXc!", Some(on_head));
    let on_mine = payload(
        &w,
        doc,
        &mine.to_string(),
        "abXc!",
        "abXc!?",
        &[Edit {
            at: 5,
            delete: 0,
            insert: 1,
        }],
    );
    w.observe(ObserveRequest {
        doc,
        actor: human(),
        initiator: human(),
        postimage: "abXc!?".into(),
        observed_parent: ObservedRef::Pending { observation: mine },
        provenance: Some(on_mine),
    })
    .expect("B's save");
    let frozen = payload(
        &w,
        doc,
        &mine.to_string(),
        "abXc!",
        "abXc!+",
        &[Edit {
            at: 5,
            delete: 0,
            insert: 1,
        }],
    );
    let mut body = write_body(Some(head), "abXc!+");
    body["baselineProvenance"] = serde_json::to_value(&frozen).unwrap();
    body["observedParent"] = json!({ "ref": "pending", "observation": mine });
    let p = prepare_json(&w, &docs, body).expect("prepare");
    let baseline = p.baseline.expect("the unsaved buffer is observed");
    let s = w.snapshot().state;
    assert_eq!(s.revisions[&baseline].kind, RevisionKind::Concurrent);
    let obs = s
        .observations
        .values()
        .find(|o| o.linearized == Some(baseline))
        .expect("the baseline observation");
    assert_eq!(
        obs.observed_parent,
        ObservedRef::Pending { observation: mine },
        "the frozen predecessor, never the head relabelled"
    );
    assert_eq!(
        s.docs[&doc].hunks[&hunk].span.block,
        Some(Block::new(BreakReason::ParentMismatch, "concurrentObservation").unwrap())
    );
}

#[test]
fn a_baseline_map_without_its_observed_parent_is_refused_unchanged() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    let head = human_save(&w, doc, "abc");
    let frozen = payload(
        &w,
        doc,
        &basis(Some(head)),
        "abc",
        "abcd",
        &[Edit {
            at: 3,
            delete: 0,
            insert: 1,
        }],
    );
    let mut body = write_body(Some(head), "abcd");
    body["baselineProvenance"] = serde_json::to_value(&frozen).unwrap();
    let generation = w.generation();
    let err = prepare_json(&w, &docs, body).unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST", "{err}");
    assert_eq!(w.generation(), generation);
}

#[test]
fn an_observed_parent_the_document_never_had_is_refused_unchanged() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    let head = human_save(&w, doc, "abc");
    let mut body = write_body(Some(head), "abcd");
    body["observedParent"] = json!({ "ref": "revision", "revision": RevisionId::new() });
    let generation = w.generation();
    let err = prepare_json(&w, &docs, body).unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST", "{err}");
    assert_eq!(w.generation(), generation);
}
