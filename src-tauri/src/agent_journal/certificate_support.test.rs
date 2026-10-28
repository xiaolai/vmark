// WI-AL2.1c — shared harness for the certificate suites: a selection edit's certificate built from explicit edits, and the controlled prepare and commit driven through the JSON payloads the webview sends
//! A certificate is a provenance payload without the document, epoch and
//! basis: the webview's observer cannot know the parent the writer mints,
//! so the writer binds it.
#![allow(dead_code)]

use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::controlled::{
    commit_controlled, decode_prepare, prepare_controlled, ControlledCommitted, ControlledPrepared,
};
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::hunk_id::text_hash;
use crate::agent_journal::ids::{ConnectionId, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::provenance::{Block, BreakReason, Provenance, ProvenancePayload};
use crate::agent_journal::review::MappedSpan;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

pub const KEY: &str = "doc";

pub fn mcp_actor() -> Actor {
    Actor::Mcp {
        principal: Principal::Provider {
            provider: "claude-code".into(),
        },
        connection_id: ConnectionId::new(),
        session_label: None,
        display_name: None,
    }
}

/// The certificate wire of `p`, mapping `pre` → `post`.
pub fn cert_of(pre: &str, post: &str, p: &Provenance) -> serde_json::Value {
    let bound = ProvenancePayload::encode("unbound", "0", "unbound", pre, post, p).expect("cert");
    let mut v = serde_json::to_value(bound).unwrap();
    let o = v.as_object_mut().unwrap();
    for key in ["document", "epoch", "basis"] {
        o.remove(key);
    }
    v
}

/// A Source certificate: `edits` applied in order to `pre` give `post`.
pub fn cert(pre: &str, post: &str, edits: &[Edit]) -> serde_json::Value {
    cert_of(pre, post, &window(pre, edits))
}

/// `c` with its preimage hash replaced by the hash of `text`.
pub fn with_pre_hash(mut c: serde_json::Value, text: &str) -> serde_json::Value {
    c["preHash"] = serde_json::Value::String(text_hash(text));
    c
}

/// One prepare as the webview sends it.
pub struct Req<'a> {
    pub parent: Option<RevisionId>,
    pub preimage: &'a str,
    pub flushed: Option<&'a ProvenancePayload>,
    pub touched: bool,
    pub certificate: Option<serde_json::Value>,
    /// The MCP tool: a whole-text write (`document.write`, …) declares its script.
    pub tool: &'a str,
}

impl<'a> Req<'a> {
    pub fn new(parent: Option<RevisionId>, preimage: &'a str) -> Self {
        Self {
            parent,
            preimage,
            flushed: None,
            touched: false,
            certificate: None,
            tool: "selection.set",
        }
    }
}

pub fn prepare(w: &Writer, docs: &DocRegistry, r: Req<'_>) -> Result<ControlledPrepared, TxnError> {
    let mut body = serde_json::json!({
        "docKey": KEY,
        "parent": r.parent,
        "preimage": r.preimage,
        "actor": mcp_actor(),
        "tool": r.tool,
        "baselineProvenance": r.flushed,
        "observedParent": observed_on(r.parent),
        "baselineTouched": r.touched,
    });
    if let Some(c) = r.certificate {
        body["certificate"] = c;
    }
    let req = decode_prepare(&serde_json::to_vec(&body).unwrap())?;
    let doc = docs.resolve(&req.doc_key)?;
    prepare_controlled(w, doc, req)
}

pub fn commit(
    w: &Writer,
    txn: TxnId,
    postimage: &str,
    certificate: Option<serde_json::Value>,
) -> Result<ControlledCommitted, TxnError> {
    let mut body = serde_json::json!({ "postimage": postimage });
    if let Some(c) = certificate {
        body["certificate"] = c;
    }
    commit_controlled(w, txn, &serde_json::to_vec(&body).unwrap())
}

/// One live agent hunk: "abc" → "abXc", the hunk spanning `X` at 2..3.
pub fn one_hunk(w: &Writer, docs: &DocRegistry) -> (DocId, HunkId, RevisionId) {
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

/// The unsaved buffer after a person typed `--` before the hunk of
/// `one_hunk`: its flushed map "abXc" → "--abXc".
pub fn unsaved_prefix(w: &Writer, doc: DocId, head: RevisionId) -> ProvenancePayload {
    payload(
        w,
        doc,
        &basis(Some(head)),
        "abXc",
        "--abXc",
        &[Edit {
            at: 0,
            delete: 0,
            insert: 2,
        }],
    )
}

pub fn span(w: &Writer, doc: DocId, id: &HunkId) -> MappedSpan {
    w.snapshot().state.docs[&doc].hunks[id].span.clone()
}

pub fn block(reason: BreakReason, origin: &str) -> Option<Block> {
    Some(Block {
        reason,
        origin: origin.into(),
    })
}
