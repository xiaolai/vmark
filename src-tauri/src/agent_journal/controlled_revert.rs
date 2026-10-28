//! Revert as a controlled mutation: the review panel undoes one hunk of
//! the head text through the same protocol as an agent write, and a
//! revert that does not apply records its outcome instead.
//!
//! Prepare, in order (`admission::prepare`): a request id already
//! receipted is answered from its receipt; parent CAS; capture seq;
//! admission; then, staged as one frame, pending captures and the
//! overwritten buffer recorded as a human baseline, then the hunk's
//! `reviewGen` CAS (`STALE_REVIEW`), the gate (`AMBIGUOUS_REVERT`) and the
//! exact revert of the text the baseline left:
//!
//! | Outcome | Recorded | Reply |
//! |---|---|---|
//! | applies | a `prepared` with `reviewOp: hunkRevert`, the reservation taken | `RevertPrepared`: the patch to apply |
//! | conflicted, on a pending hunk | one `conflicted` review decision | `RevertDecided` |
//! | finds its base, on a pending or conflicted hunk | one `revertFoundBase` decision | `RevertDecided` |
//! | conflicted again, or a reverted hunk that cannot be re-applied | nothing | `REVERT_REFUSED` |
//!
//! A revert that would edit another live hunk is conflicted. A request
//! id's receipt stores either reply (schema v4), so an identical retry of
//! a decision is answered with it and records nothing more.
//!
//! Key decisions:
//!   - Attributed to the person (`human` actor and initiator): a revert is
//!     the user's own action from the review panel.
//!   - The window never names the patch: the writer plans it from the
//!     hunk's pinned texts, and the commit holds the postimage to the same
//!     plan (`writer_commit_window`).
//!
//! @module agent_journal/controlled_revert

use serde::{Deserialize, Serialize};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::receipt::{
    Outcome, PayloadDigest, PreparedResponse, RequestId,
};
use crate::agent_journal::capture_seq::CaptureId;
use crate::agent_journal::controlled::{prepare_kind, Prep};
use crate::agent_journal::controlled_wire::decode;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::provenance_field::{decode_field, ProvenanceField};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{ReviewAction, ReviewOp};
use crate::agent_journal::writer::Writer;

/// The tool name a revert's transaction records.
pub const REVERT_TOOL: &str = "revert";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevertPrepareRequest {
    pub doc_key: String,
    /// The head the window expects (strict CAS); `null` means genesis.
    #[serde(deserialize_with = "crate::agent_journal::wire::required")]
    pub parent: Option<RevisionId>,
    /// The predecessor the frozen buffer was built on (`observedParent`).
    #[serde(default)]
    pub observed_parent: Option<ObservedRef>,
    /// The window's current buffer: the text the revert edits.
    pub preimage: String,
    #[serde(default)]
    pub baseline_provenance: Option<ProvenanceField>,
    #[serde(default)]
    pub baseline_touched: bool,
    /// Window-minted once per logical revert, reused on retry.
    #[serde(default)]
    pub request_id: Option<RequestId>,
    /// The provenance capture the window froze for the buffer.
    #[serde(default)]
    pub capture: Option<CaptureId>,
    pub hunk_id: HunkId,
    /// The hunk's `reviewGen` the panel rendered.
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_review_gen: u64,
}

/// An applied revert's reply: replace UTF-16 `from..to` of the buffer
/// with `insert`, which gives the text hashed `postimage_hash`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevertPrepared {
    pub doc: DocId,
    pub txn: TxnId,
    pub revision: RevisionId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    /// The human revision recorded for the overwritten buffer, if any.
    pub baseline: Option<RevisionId>,
    pub hunk: HunkId,
    /// The `reviewGen` the revert was prepared against.
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub review_gen: u64,
    pub from: u64,
    pub to: u64,
    pub insert: String,
    pub postimage_hash: BlobHash,
}

/// The reply of a revert that did not apply: the review decision it
/// recorded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevertDecided {
    pub doc: DocId,
    pub hunk: HunkId,
    pub action: ReviewAction,
    /// The hunk's `reviewGen` after the decision.
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub review_gen: u64,
    /// The decision record's seq.
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    /// The human revision recorded for the buffer, if any.
    pub baseline: Option<RevisionId>,
    /// The head the decision was recorded on.
    pub head: Option<RevisionId>,
}

/// A framed revert's reply: the patch to apply, or the decision recorded
/// instead (`{kind, response}`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "response", rename_all = "camelCase")]
pub enum RevertReply {
    Prepared(RevertPrepared),
    Decided(RevertDecided),
}

/// Decode a revert prepare payload (`INVALID_TEXT`, then the shape).
pub fn decode_revert_prepare(payload: &[u8]) -> Result<RevertPrepareRequest, TxnError> {
    decode(payload)
}

/// Prepare a revert of `doc` sent with no request id. See the module docs.
pub fn prepare_revert(
    w: &Writer,
    doc: DocId,
    req: RevertPrepareRequest,
) -> Result<Outcome, TxnError> {
    prepare_revert_with(w, doc, req, None)
}

/// `prepare_revert` with the digest of the raw payload, which a request
/// id's receipt stores.
pub fn prepare_revert_with(
    w: &Writer,
    doc: DocId,
    req: RevertPrepareRequest,
    digest: Option<PayloadDigest>,
) -> Result<Outcome, TxnError> {
    let id = req.request_id;
    prepare_kind(
        w,
        doc,
        id,
        digest,
        || revert_prep(req),
        |o| match o {
            Outcome::Prepared(PreparedResponse::Revert(_)) | Outcome::Decision(_) => Some(o),
            _ => None,
        },
    )
}

/// What `req` asks the writer to prepare: the person's revert of one
/// hunk, its baseline map decoded.
pub(crate) fn revert_prep(req: RevertPrepareRequest) -> Result<Prep, TxnError> {
    Ok(Prep {
        parent: req.parent,
        observed_parent: req.observed_parent,
        preimage: req.preimage,
        actor: Actor::Human,
        initiator: Actor::Human,
        tool: REVERT_TOOL.into(),
        review_op: ReviewOp::HunkRevert {
            hunk_id: req.hunk_id,
            expected_review_gen: req.expected_review_gen,
        },
        baseline_provenance: decode_field(req.baseline_provenance)?,
        baseline_touched: req.baseline_touched,
        certificate: None,
        capture: req.capture,
        addresses: Vec::new(),
    })
}
