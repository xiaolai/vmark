// WI-AL1.3 — a controlled document.write records a wholeDocumentWrite barrier for every older live hunk, the unsaved buffer reaches the journal as a pre-prepare observation carrying the flushed provenance or, without one, a snapshotOnly barrier, the write's own apply is never captured as a second mutation, and a refused prepare leaves content, review state, reviewGen and generation unchanged
//! The controlled path derives its review effects in the writer; these
//! tests drive it through the same JSON payloads the webview sends.

use super::controlled::{
    commit_controlled, decode_prepare, prepare_controlled, ControlledPrepared,
};
use super::doc_registry::DocRegistry;
use super::test_support::*;
use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{ConnectionId, DocId, HunkId, RevisionId};
use crate::agent_journal::provenance::{Block, BreakReason, ProvenancePayload};
use crate::agent_journal::review::{HunkState, LastCertified, MappedSpan};
use crate::agent_journal::writer::{Snapshot, Writer};

const KEY: &str = "doc";

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

fn prepare_with(
    w: &Writer,
    docs: &DocRegistry,
    parent: Option<RevisionId>,
    preimage: &str,
    flushed: Option<&ProvenancePayload>,
) -> Result<ControlledPrepared, TxnError> {
    let payload = serde_json::to_vec(&serde_json::json!({
        "docKey": KEY,
        "parent": parent,
        "preimage": preimage,
        "actor": mcp_actor(),
        "tool": "document.write",
        "baselineProvenance": flushed,
        "observedParent": observed_on(parent),
    }))
    .unwrap();
    let req = decode_prepare(&payload)?;
    let doc = docs.resolve(&req.doc_key)?;
    prepare_controlled(w, doc, req)
}

fn commit(w: &Writer, p: &ControlledPrepared, postimage: &str) {
    let payload = serde_json::to_vec(&serde_json::json!({ "postimage": postimage })).unwrap();
    let out = commit_controlled(w, p.txn, &payload).expect("commit");
    assert!(out.applied && out.durable);
}

/// One live agent hunk: "abc" → "abXc", the hunk spanning `X` at 2..3.
fn one_hunk(w: &Writer, docs: &DocRegistry) -> (DocId, HunkId, RevisionId) {
    let doc = docs.resolve(KEY).unwrap();
    human_save(w, doc, "abc");
    let (_, rev) = agent_change(
        w,
        doc,
        "abc",
        "abXc",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    (doc, hunk_ids(w, doc)[0].clone(), rev)
}

fn span(w: &Writer, doc: DocId, id: &HunkId) -> MappedSpan {
    w.snapshot().state.docs[&doc].hunks[id].span.clone()
}

fn review(w: &Writer, doc: DocId, id: &HunkId) -> (HunkState, u64) {
    let s = w.snapshot().state;
    let h = &s.docs[&doc].hunks[id];
    (h.state, h.review_gen)
}

fn block(reason: BreakReason, origin: &str) -> Option<Block> {
    Some(Block {
        reason,
        origin: origin.into(),
    })
}

#[test]
fn a_controlled_write_blocks_every_older_live_hunk_as_a_whole_document_write() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, id, agent_rev) = one_hunk(&w, &docs);
    let before = review(&w, doc, &id);
    let p = prepare_with(&w, &docs, Some(agent_rev), "abXc", None).unwrap();
    assert_eq!(p.baseline, None, "the buffer is the head");
    commit(&w, &p, "rewritten");
    let s = span(&w, doc, &id);
    assert_eq!(s.block, block(BreakReason::WholeDocumentWrite, "agent"));
    assert_eq!(
        s.last_certified,
        Some(LastCertified {
            at: agent_rev,
            range: r(2, 3),
        }),
        "where the span last was before the barrier"
    );
    assert_eq!(review(&w, doc, &id), before, "the barrier decides nothing");
    let err = w.plan_revert(doc, &id).unwrap_err();
    assert_eq!(
        err.code(),
        "AMBIGUOUS_REVERT",
        "no revert is guessed across it"
    );
}

#[test]
fn an_unsaved_buffer_without_flushed_provenance_is_a_snapshot_only_baseline() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, id, agent_rev) = one_hunk(&w, &docs);
    let p = prepare_with(&w, &docs, Some(agent_rev), "abXc tail", None).unwrap();
    let baseline = p.baseline.expect("the buffer delta is recorded");
    assert_eq!(w.head(doc), Some(baseline));
    let s = span(&w, doc, &id);
    assert_eq!(s.block, block(BreakReason::SnapshotOnly, "snapshot"));
    assert_eq!(s.last_certified.map(|l| l.at), Some(agent_rev));
    commit(&w, &p, "rewritten");
    assert_eq!(
        span(&w, doc, &id).block,
        block(BreakReason::SnapshotOnly, "snapshot"),
        "the first block is sticky"
    );
}

#[test]
fn flushed_provenance_maps_older_hunks_through_the_baseline_before_the_barrier() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, id, agent_rev) = one_hunk(&w, &docs);
    // Unsaved typing before the hunk shifts it by two.
    let flushed = payload(
        &w,
        doc,
        &basis(Some(agent_rev)),
        "abXc",
        "--abXc",
        &[Edit {
            at: 0,
            delete: 0,
            insert: 2,
        }],
    );
    let p = prepare_with(&w, &docs, Some(agent_rev), "--abXc", Some(&flushed)).unwrap();
    let baseline = p.baseline.expect("baseline");
    let s = span(&w, doc, &id);
    assert_eq!((s.range, s.block), (r(4, 5), None), "mapped, not blocked");
    commit(&w, &p, "rewritten");
    let s = span(&w, doc, &id);
    assert_eq!(s.block, block(BreakReason::WholeDocumentWrite, "agent"));
    assert_eq!(
        s.last_certified,
        Some(LastCertified {
            at: baseline,
            range: r(4, 5),
        })
    );
}

fn unchanged(w: &Writer) -> (Snapshot, u64, u64) {
    (w.snapshot(), w.generation(), w.journal_len())
}

#[test]
fn a_flushed_map_that_does_not_certify_the_buffer_is_refused_and_nothing_changes() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, _, agent_rev) = one_hunk(&w, &docs);
    let wrong = payload(
        &w,
        doc,
        &basis(Some(agent_rev)),
        "abXc",
        "abXc!",
        &[Edit {
            at: 4,
            delete: 0,
            insert: 1,
        }],
    );
    let before = unchanged(&w);
    let err = prepare_with(&w, &docs, Some(agent_rev), "abXc?", Some(&wrong)).unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST", "{err}");
    assert_eq!(unchanged(&w), before);
}

#[test]
fn a_refused_prepare_leaves_content_review_state_review_gen_and_generation_unchanged() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, id, agent_rev) = one_hunk(&w, &docs);
    let before = (unchanged(&w), review(&w, doc, &id), head_text(&w, doc));
    let stale = prepare_with(&w, &docs, Some(RevisionId::new()), "abXc tail", None);
    assert_eq!(stale.unwrap_err().code(), "STALE_PARENT");
    assert_eq!(
        (unchanged(&w), review(&w, doc, &id), head_text(&w, doc)),
        before
    );
    let held = prepare_with(&w, &docs, Some(agent_rev), "abXc", None).unwrap();
    let busy = (unchanged(&w), review(&w, doc, &id), head_text(&w, doc));
    let err = prepare_with(&w, &docs, Some(agent_rev), "abXc tail", None).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_BUSY");
    assert_eq!(
        (unchanged(&w), review(&w, doc, &id), head_text(&w, doc)),
        busy
    );
    commit(&w, &held, "done");
}

#[test]
fn the_writes_own_apply_is_not_captured_again_on_the_next_write() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, id, agent_rev) = one_hunk(&w, &docs);
    let first = prepare_with(&w, &docs, Some(agent_rev), "abXc", None).unwrap();
    commit(&w, &first, "applied by the agent");
    let revisions = w.snapshot().state.revisions.len();
    let gen = review(&w, doc, &id).1;
    // The editor echoes the applied text back as its buffer.
    let second = prepare_with(
        &w,
        &docs,
        Some(first.revision),
        "applied by the agent",
        None,
    )
    .unwrap();
    assert_eq!(
        second.baseline, None,
        "no human capture of the agent's own text"
    );
    assert_eq!(second.generation, w.generation());
    commit(&w, &second, "again");
    assert_eq!(
        w.snapshot().state.revisions.len(),
        revisions + 1,
        "each mutation counted once"
    );
    assert_eq!(review(&w, doc, &id).1, gen);
}
