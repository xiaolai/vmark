//! Restore as a controlled mutation: the history panel puts an earlier
//! text back — a revision, the preimage of an `uncommitted` transaction, or
//! a legacy checkpoint — through the same protocol as an agent write.
//!
//! Prepare, in order (`admission::prepare`): a request id already
//! receipted is answered from its receipt; parent CAS; capture seq; the
//! source resolved and checked (an unknown, collected or foreign source,
//! or full restore slots, refuses with nothing appended); admission; then
//! pending captures, the overwritten buffer recorded as a human baseline,
//! the writer's prepare with `reviewOp: restore`. The whole of it holds the
//! writer lock, so the source read is the source reserved. The reply hands
//! the window the source text to apply.
//!
//! Key decisions:
//!   - Attributed to the person (`human` actor and initiator): a restore is
//!     the user's own action from the history panel.
//!   - The window never names what the restore resolves or how it is
//!     reviewed: the commit reads `resolves` from the prepared source and
//!     the writer derives the single `restore` hunk (whole parent text →
//!     whole restored text), so reverting it gives the overwritten text
//!     back, and a `restore` barrier blocks every older live hunk without
//!     superseding it.
//!   - Commit and abort are the controlled write's own (`commit_controlled`,
//!     `abort_controlled`): a refused commit ends the transaction
//!     `uncommitted`.
//!
//! @module agent_journal/controlled_restore

use serde::{Deserialize, Serialize};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::receipt::{
    Outcome, PayloadDigest, PreparedResponse, RequestId,
};
use crate::agent_journal::capture_seq::CaptureId;
use crate::agent_journal::controlled::{prepare_kind, Prep};
use crate::agent_journal::controlled_wire::decode;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::provenance_field::{decode_field, ProvenanceField};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::{RestoreSource, ReviewOp};
use crate::agent_journal::review_rules::{check_prepare, restore_resolves, restore_text};
use crate::agent_journal::writer::{Inner, Writer};
use crate::agent_journal::writer_revert::referenced_blob;

/// The tool name a restore's transaction records.
pub const RESTORE_TOOL: &str = "history.restore";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestorePrepareRequest {
    pub doc_key: String,
    /// The head the window expects (strict CAS); `null` means genesis.
    #[serde(deserialize_with = "crate::agent_journal::wire::required")]
    pub parent: Option<RevisionId>,
    /// The predecessor the frozen buffer was built on (`observedParent`).
    #[serde(default)]
    pub observed_parent: Option<ObservedRef>,
    /// The window's current buffer: the text the restore overwrites.
    pub preimage: String,
    pub source: RestoreSource,
    #[serde(default)]
    pub baseline_provenance: Option<ProvenanceField>,
    #[serde(default)]
    pub baseline_touched: bool,
    /// Window-minted once per logical restore, reused on retry.
    #[serde(default)]
    pub request_id: Option<RequestId>,
    /// The provenance capture the window froze for the overwritten buffer.
    #[serde(default)]
    pub capture: Option<CaptureId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestorePrepared {
    pub doc: DocId,
    pub txn: TxnId,
    pub revision: RevisionId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    /// The human revision recorded for the overwritten buffer, if any.
    pub baseline: Option<RevisionId>,
    /// The text to apply.
    pub text: String,
    /// The `uncommitted` transaction this restore resolves, if any.
    pub resolves: Option<TxnId>,
}

/// Decode a restore prepare payload (`INVALID_TEXT`, then the shape).
pub fn decode_restore_prepare(payload: &[u8]) -> Result<RestorePrepareRequest, TxnError> {
    decode(payload)
}

/// The text `source` holds for `doc`, after the prepare-time checks.
pub(crate) fn source_text(
    g: &mut Inner,
    doc: DocId,
    op: &ReviewOp,
    source: &RestoreSource,
) -> Result<(String, Option<TxnId>), TxnError> {
    check_prepare(&g.proj, doc, op)?;
    let hash = restore_text(&g.proj, doc, source)
        .cloned()
        .ok_or_else(|| TxnError::InvalidRequest("restore source does not exist".into()))?;
    let text = referenced_blob(&mut g.blobs, &hash)?;
    Ok((text, restore_resolves(source)))
}

/// Prepare a restore of `doc` sent with no request id. See the module
/// docs for the order.
pub fn prepare_restore(
    w: &Writer,
    doc: DocId,
    req: RestorePrepareRequest,
) -> Result<RestorePrepared, TxnError> {
    prepare_restore_with(w, doc, req, None)
}

/// `prepare_restore` with the digest of the raw payload, which a request
/// id's receipt stores. The source is read in the same critical section
/// as the reservation: a collection or discard cannot invalidate it in
/// between.
pub fn prepare_restore_with(
    w: &Writer,
    doc: DocId,
    req: RestorePrepareRequest,
    digest: Option<PayloadDigest>,
) -> Result<RestorePrepared, TxnError> {
    let id = req.request_id;
    prepare_kind(
        w,
        doc,
        id,
        digest,
        || restore_prep(req),
        |o| match o {
            Outcome::Prepared(PreparedResponse::Restore(p)) => Some(p),
            _ => None,
        },
    )
}

/// What `req` asks the writer to prepare: the person's restore of its
/// source, its baseline map decoded.
pub(crate) fn restore_prep(req: RestorePrepareRequest) -> Result<Prep, TxnError> {
    Ok(Prep {
        parent: req.parent,
        observed_parent: req.observed_parent,
        preimage: req.preimage,
        actor: Actor::Human,
        initiator: Actor::Human,
        tool: RESTORE_TOOL.into(),
        review_op: ReviewOp::Restore { source: req.source },
        baseline_provenance: decode_field(req.baseline_provenance)?,
        baseline_touched: req.baseline_touched,
        certificate: None,
        capture: req.capture,
        addresses: Vec::new(),
    })
}

/// The uncommitted transaction a prepared restore of its preimage resolves.
pub(crate) fn restored_uncommitted(w: &Writer, txn: TxnId) -> Option<TxnId> {
    let g = w.lock();
    match &g.proj.txns.get(&txn)?.review_op {
        ReviewOp::Restore {
            source: RestoreSource::UncommittedPreimage { txn },
        } => Some(*txn),
        _ => None,
    }
}
