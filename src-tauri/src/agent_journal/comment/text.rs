//! What a thread says: its anchor, body, author and caller, and its
//! replies in order. The book (`comment::book`) keeps one per undeleted
//! thread so the comment list can be read without rescanning the journal.
//!
//! Key decisions:
//!   - Filled from the same records, by the same `apply`, live and on
//!     replay, so the live book and a replayed one stay equal.
//!   - A deleted thread's text is dropped at once (its id then reads as
//!     absent: R45's "deleted comment"); the thread's accounting stays until
//!     startup compaction, as before.
//!   - Held behind an `Arc` so cloning the projection (an admission's
//!     staging copy) copies a pointer per thread, not its bodies. Memory is
//!     bounded by the logical comment caps (`comment::bounds`).
//!
//! @module agent_journal/comment/text

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ReplyId};
use crate::agent_journal::comment::records::CommentRecord;
use crate::agent_journal::comment_anchor::StoredAnchor;

/// A thread's text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadText {
    pub anchor: StoredAnchor,
    pub body: String,
    /// Display text only; who acted is `caller`.
    pub author: String,
    pub caller: CommentCaller,
    pub replies: Vec<ReplyText>,
}

/// One reply's text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyText {
    pub reply: ReplyId,
    pub body: String,
    pub author: String,
    pub caller: CommentCaller,
}

/// Carry an applied record into `texts`. Called only after the book
/// accepted the record, so the thread a reply or deletion names exists.
pub(crate) fn record_text(
    texts: &mut BTreeMap<CommentId, Arc<ThreadText>>,
    rec: CommentRecord<'_>,
) {
    match rec {
        CommentRecord::Created(c) => {
            texts.insert(
                c.comment,
                Arc::new(ThreadText {
                    anchor: c.anchor.clone(),
                    body: c.body.clone(),
                    author: c.author.clone(),
                    caller: c.caller,
                    replies: Vec::new(),
                }),
            );
        }
        CommentRecord::Replied(r) => {
            if let Some(t) = texts.get_mut(&r.comment) {
                Arc::make_mut(t).replies.push(ReplyText {
                    reply: r.reply,
                    body: r.body.clone(),
                    author: r.author.clone(),
                    caller: r.caller,
                });
            }
        }
        CommentRecord::State(_) => {}
        CommentRecord::Deleted(d) => {
            texts.remove(&d.comment);
        }
    }
}
