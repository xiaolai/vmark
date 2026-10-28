//! One thread's state and charges, and the single checked step every
//! action takes on it: the state matrix, then `commentGen` exhaustion, then
//! the bumped generation (`comment::rules`). `comment::book` keeps one per
//! retained thread and re-exports both types.
//!
//! @module agent_journal/comment/thread

use crate::agent_journal::comment::bounds;
use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ThreadState};
use crate::agent_journal::comment::rules::{allowed, exhausted, Action};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Thread {
    pub doc: DocId,
    /// The revision the thread was created on.
    pub revision: RevisionId,
    pub state: ThreadState,
    pub comment_gen: u64,
    pub replies: u64,
    /// The framed bytes of every record of the thread.
    pub charges: u64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DocUsage {
    pub bytes: u64,
    pub comments: u64,
}

impl Thread {
    /// Bytes counted against the thread, document and global caps.
    pub fn logical(&self) -> u64 {
        if self.deleted {
            0
        } else {
            self.physical()
        }
    }

    /// Bytes counted against the physical cap until compaction.
    pub fn physical(&self) -> u64 {
        self.charges + bounds::reserve(self.state, self.deleted)
    }
}

pub(crate) fn overflow() -> TxnError {
    TxnError::Corrupt("comment accounting overflows".into())
}

/// `t` after `caller` takes `action` (to `to` for a state record): the
/// matrix, then exhaustion, then the bumped generation.
pub(crate) fn act(
    comment: CommentId,
    t: &Thread,
    action: Action,
    caller: CommentCaller,
    to: Option<ThreadState>,
) -> Result<Thread, TxnError> {
    let next = allowed(action, caller, t.state)
        .filter(|s| to.is_none_or(|to| to == *s))
        .ok_or(TxnError::CommentNotAllowed {
            action: action.name(),
            caller,
            state: t.state,
        })?;
    if exhausted(action, t.comment_gen) {
        return Err(TxnError::CommentStateExhausted { comment });
    }
    let mut after = t.clone();
    after.state = next;
    match action {
        Action::Delete => after.deleted = true,
        _ => after.comment_gen = t.comment_gen.checked_add(1).ok_or_else(overflow)?,
    }
    Ok(after)
}
