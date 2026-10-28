//! The request shapes of the comment entry points. Every shape refuses
//! unknown fields, so a forged `caller` (or an `actor` where the route
//! takes none) is `INVALID_REQUEST`, never read. Counters are canonical
//! decimal strings.
//!
//! A create and a reply are framed (`admission::payload`): the identity
//! fields ride beside these and the digest covers the raw payload. A state
//! change and a deletion are bound by `expectedCommentGen` alone; after an
//! uncertain answer the caller rereads the thread.
//!
//! @module agent_journal/comment/wire

use serde::Deserialize;

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::receipt::RequestId;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::comment_anchor::AnchorSelection;
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::provenance_field::ProvenanceField;
use crate::agent_journal::record::ObservedRef;

/// Open a thread on the window's buffer text.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    pub doc_key: String,
    /// The head the window expects (strict CAS; `null` is genesis).
    #[serde(deserialize_with = "crate::agent_journal::wire::required")]
    pub parent: Option<RevisionId>,
    /// What the buffer was built on, as for a controlled prepare.
    #[serde(default)]
    pub observed_parent: Option<ObservedRef>,
    /// The buffer text the selection is in. When it differs from the
    /// head's, it is recorded as a human baseline first.
    pub text: String,
    #[serde(default)]
    pub baseline_provenance: Option<ProvenanceField>,
    #[serde(default)]
    pub baseline_touched: bool,
    pub selection: AnchorSelection,
    pub body: String,
    /// Display text only.
    pub author: String,
    /// The agent route's MCP actor (the baseline's initiator). The user
    /// route takes none.
    #[serde(default)]
    pub actor: Option<Actor>,
    pub request_id: RequestId,
}

/// Reply to a thread.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplyRequest {
    pub doc_key: String,
    pub comment: CommentId,
    pub body: String,
    pub author: String,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_comment_gen: u64,
    pub request_id: RequestId,
}

/// Change a thread's state, or delete it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateRequest {
    pub doc_key: String,
    pub comment: CommentId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_comment_gen: u64,
}
