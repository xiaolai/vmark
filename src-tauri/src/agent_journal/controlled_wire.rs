//! The wire shapes of `document.write`'s controlled-mutation protocol: the
//! prepare and commit requests a window sends, the answers it receives, and
//! the reasons its re-verification may abort with. Decoding checks the text
//! first (`INVALID_TEXT`), then the shape, an MCP actor and a bounded tool
//! name (`INVALID_REQUEST`). The protocol itself lives in `controlled`.
//!
//! @module agent_journal/controlled_wire

use serde::{Deserialize, Serialize};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::receipt::RequestId;
use crate::agent_journal::capture_seq::CaptureId;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::provenance::Certificate;
use crate::agent_journal::provenance_field::ProvenanceField;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::writer::certificate::FallbackReason;

/// Longest accepted tool name, in bytes.
pub const TOOL_MAX_BYTES: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlledPrepareRequest {
    pub doc_key: String,
    /// The head the window expects (strict CAS). Required on the wire;
    /// `null` means genesis, never "skip the check".
    #[serde(deserialize_with = "crate::agent_journal::wire::required")]
    pub parent: Option<RevisionId>,
    /// The predecessor the window's frozen buffer was built on: a
    /// revision, its own pending observation, or genesis. Required with a
    /// `baselineProvenance`; the baseline is recorded on it, never on the
    /// head relabelled.
    #[serde(default)]
    pub observed_parent: Option<ObservedRef>,
    /// The window's current buffer text.
    pub preimage: String,
    pub actor: Actor,
    pub tool: String,
    /// The certified map from the head text to `preimage`, flushed from
    /// the window's unsaved edits. `None`: the baseline is snapshot-only.
    #[serde(default)]
    pub baseline_provenance: Option<ProvenanceField>,
    /// The window says a person touched the buffer since its journaled
    /// text, even if the text is equal again: an equal-text baseline is
    /// then still recorded (as a `snapshotOnly` barrier without a map).
    #[serde(default)]
    pub baseline_touched: bool,
    /// A Source `selection.set`'s exact change, certified before the
    /// apply and bound to the parent the writer mints (`certificate`).
    #[serde(default)]
    pub certificate: Option<Certificate>,
    /// Window-minted once per logical prepare and reused on every retry:
    /// an identical retry is answered from the journal's receipt.
    #[serde(default)]
    pub request_id: Option<RequestId>,
    /// The provenance capture the window froze for this buffer; its seq
    /// must extend the session's last recorded one (`capture_seq`).
    #[serde(default)]
    pub capture: Option<CaptureId>,
    /// The comments this write says it addresses; checked as a set before
    /// the prepare (`comment::addresses`) and kept on its `committed`.
    #[serde(default)]
    pub addresses: Vec<CommentId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlledPrepared {
    pub doc: DocId,
    pub txn: TxnId,
    pub revision: RevisionId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    /// The human revision recorded for unjournaled buffer text, if any.
    pub baseline: Option<RevisionId>,
    /// The prepare persisted a certificate bound to the minted parent.
    pub certified: bool,
    /// Why a sent certificate was not used; `None` when none was sent.
    pub fallback_reason: Option<FallbackReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ControlledCommitRequest {
    pub(crate) postimage: String,
    /// A WYSIWYG `selection.set`'s map, certified after the apply.
    #[serde(default)]
    pub(crate) certificate: Option<Certificate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlledCommitted {
    pub doc: DocId,
    pub revision: RevisionId,
    pub applied: bool,
    pub durable: bool,
    /// The effects came from a checked certificate, not the barrier.
    pub certified: bool,
    /// Why a certificate was not used at commit; `None` when none applied.
    pub fallback_reason: Option<FallbackReason>,
}

/// Why the window aborted the transaction: its re-verification refused to
/// apply, or (`TimedOut`) its prepare answered after the window gave up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AbortReason {
    /// The buffer changed after the prepare.
    Edited,
    /// The tab closed.
    Closed,
    /// An IME composition is in progress.
    Composing,
    /// The selection or target moved.
    Selection,
    /// The editor refused the apply itself.
    ApplyRefused,
    /// The prepare answered after the window's deadline; nothing was applied
    /// and the editor refused nothing.
    TimedOut,
}

impl AbortReason {
    /// The text of the `aborted` record. A re-verification refusal reads
    /// `reverify:<reason>`; a timeout carries no such prefix, because the
    /// editor refused nothing.
    pub fn record_text(self) -> String {
        let wire = serde_json::to_value(self)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        match self {
            Self::TimedOut => wire,
            _ => format!("reverify:{wire}"),
        }
    }
}

/// Text first, then shape: the one checked decoder, under its local name.
pub(crate) use crate::agent_journal::wire::decode_json as decode;

/// Decode a prepare payload: well-formed text first (`INVALID_TEXT`), then
/// shape, an MCP actor and a bounded tool name (`INVALID_REQUEST`).
pub fn decode_prepare(payload: &[u8]) -> Result<ControlledPrepareRequest, TxnError> {
    let req: ControlledPrepareRequest = decode(payload)?;
    if !matches!(req.actor, Actor::Mcp { .. }) {
        return Err(TxnError::InvalidRequest(
            "a controlled write is attributed to an MCP actor".into(),
        ));
    }
    if req.tool.is_empty() || req.tool.len() > TOOL_MAX_BYTES {
        return Err(TxnError::InvalidRequest(format!(
            "tool must be 1..={TOOL_MAX_BYTES} bytes"
        )));
    }
    Ok(req)
}
