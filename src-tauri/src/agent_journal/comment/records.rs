//! The four comment record kinds (schema v5). Comments are document-scoped
//! records in the app-wide journal; they never advance a content head.
//!
//! No record carries a request id: a create's or a reply's lives only in
//! its envelope's receipt. `caller` is chosen by the controller entry point
//! the call arrived on, never decoded from a request. Every struct refuses
//! unknown fields, so a newer field is corruption rather than lost data on
//! the next rewrite.
//!
//! @module agent_journal/comment/records

use serde::{Deserialize, Serialize};

use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ReplyId, ThreadState};
use crate::agent_journal::comment_anchor::StoredAnchor;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::record::Record;

/// A thread opened on `revision`, whose text hashes to `textHash`; the
/// anchor was created against exactly that text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentCreated {
    pub doc: DocId,
    pub comment: CommentId,
    pub revision: RevisionId,
    pub text_hash: BlobHash,
    pub anchor: StoredAnchor,
    pub body: String,
    /// Display text only; who acted is `caller`.
    pub author: String,
    pub caller: CommentCaller,
}

/// A reply; it changes no state but bumps `commentGen`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentReplied {
    pub doc: DocId,
    pub comment: CommentId,
    pub reply: ReplyId,
    pub body: String,
    pub author: String,
    pub caller: CommentCaller,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_comment_gen: u64,
}

/// A state transition (`markAddressed`, `resolve`, `reopen`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentState {
    pub doc: DocId,
    pub comment: CommentId,
    pub from: ThreadState,
    pub to: ThreadState,
    pub caller: CommentCaller,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_comment_gen: u64,
}

/// A resolved thread deleted. Not a state: the thread is gone from the
/// logical budget at once and from the journal at the next startup
/// compaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentDeleted {
    pub doc: DocId,
    pub comment: CommentId,
    pub caller: CommentCaller,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_comment_gen: u64,
}

/// A comment record, borrowed from its envelope.
#[derive(Debug, Clone, Copy)]
pub enum CommentRecord<'a> {
    Created(&'a CommentCreated),
    Replied(&'a CommentReplied),
    State(&'a CommentState),
    Deleted(&'a CommentDeleted),
}

impl<'a> CommentRecord<'a> {
    pub fn of(record: &'a Record) -> Option<Self> {
        match record {
            Record::CommentCreated(c) => Some(Self::Created(c)),
            Record::CommentReplied(r) => Some(Self::Replied(r)),
            Record::CommentState(s) => Some(Self::State(s)),
            Record::CommentDeleted(d) => Some(Self::Deleted(d)),
            _ => None,
        }
    }

    /// The thread the record belongs to.
    pub fn comment(self) -> CommentId {
        match self {
            Self::Created(c) => c.comment,
            Self::Replied(r) => r.comment,
            Self::State(s) => s.comment,
            Self::Deleted(d) => d.comment,
        }
    }
}
