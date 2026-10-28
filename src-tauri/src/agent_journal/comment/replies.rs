//! What a comment call answers. A create's and a reply's answers are also
//! their receipts' stored outcomes, so their bytes are frozen: an identical
//! retry gets them back exactly. `generation` is the carrier envelope's
//! sequence and `commentGen` the thread's generation after the record; both
//! are canonical decimal strings.
//!
//! @module agent_journal/comment/replies

use serde::{Deserialize, Serialize};

use crate::agent_journal::comment::ids::{CommentId, ReplyId, ThreadState};
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};

/// A created thread, as stored in its receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentCreatedReply {
    pub doc: DocId,
    pub comment: CommentId,
    pub revision: RevisionId,
    pub text_hash: BlobHash,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub comment_gen: u64,
}

/// A reply, as stored in its receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentRepliedReply {
    pub doc: DocId,
    pub comment: CommentId,
    pub reply: ReplyId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub comment_gen: u64,
}

/// A state transition's answer. Not receipted: after an uncertain answer
/// the caller rereads the thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentStateReply {
    pub doc: DocId,
    pub comment: CommentId,
    pub state: ThreadState,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub comment_gen: u64,
}

/// A deletion's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentDeletedReply {
    pub doc: DocId,
    pub comment: CommentId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub generation: u64,
}
