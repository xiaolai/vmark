//! Comment bounds and the bytes each record is charged.
//!
//! A record is charged its framed size in the journal: the frame header
//! plus its encoded envelope. An admission's comment item is charged as
//! that envelope alone, exactly what it becomes when compaction expands
//! the frame, so a thread's charge never changes across a rewrite.
//!
//! A thread's usage is its charges plus its terminal reserve: one maximal
//! resolve frame and one maximal delete frame while it is not resolved,
//! the delete frame alone once resolved, nothing once deleted. Logical
//! usage sums undeleted threads (per thread, per document, global);
//! physical usage sums every retained thread, a deleted one at its charges
//! only, until the startup compaction drops it.
//!
//! @module agent_journal/comment/bounds

use crate::agent_journal::codec;
use crate::agent_journal::comment::ids::ThreadState;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::frame;
use crate::agent_journal::record::Envelope;

pub const KIB: u64 = 1024;
pub const MIB: u64 = 1024 * KIB;

/// A comment or reply body, in UTF-8 bytes.
pub const MAX_BODY_BYTES: u64 = 16 * KIB;
/// Replies per thread.
pub const MAX_REPLIES: u64 = 200;
/// Undeleted threads per document.
pub const MAX_COMMENTS_PER_DOC: u64 = 1000;
/// One thread's logical usage.
pub const THREAD_BYTES: u64 = 256 * KIB;
/// The logical usage of one document's undeleted threads.
pub const DOC_BYTES: u64 = 4 * MIB;
/// The logical usage of every undeleted thread.
pub const GLOBAL_BYTES: u64 = 64 * MIB;
/// The physical usage of every retained thread, deleted ones included.
pub const PHYSICAL_BYTES: u64 = 128 * MIB;
/// The largest framed `commentState` record that resolves a thread: the
/// largest sequence, generation, timestamp and ids, the longest state
/// token and either caller (`comment_bounds.test.rs` measures it).
pub const MAX_RESOLVE_FRAME: u64 = 342;
/// The largest framed `commentDeleted` record, measured the same way.
pub const MAX_DELETE_FRAME: u64 = 310;

/// The bytes `env` occupies in the journal.
pub fn charge(env: &Envelope) -> u64 {
    (frame::HEADER_LEN + codec::encode(env).len()) as u64
}

/// The terminal reserve a thread in `state` holds (zero once deleted).
pub fn reserve(state: ThreadState, deleted: bool) -> u64 {
    match (deleted, state) {
        (true, _) => 0,
        (false, ThreadState::Resolved) => MAX_DELETE_FRAME,
        (false, _) => MAX_RESOLVE_FRAME + MAX_DELETE_FRAME,
    }
}

/// The caps a live mutation is held to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub thread: u64,
    pub doc: u64,
    pub global: u64,
    pub physical: u64,
}

impl Limits {
    pub const REAL: Self = Self {
        thread: THREAD_BYTES,
        doc: DOC_BYTES,
        global: GLOBAL_BYTES,
        physical: PHYSICAL_BYTES,
    };

    /// Totals after a non-terminal mutation: each at most its cap.
    /// `COMMENT_LIMIT` names the first logical bound passed;
    /// `COMMENT_STORAGE_FULL` the physical one.
    pub fn check(&self, thread: u64, doc: u64, global: u64, physical: u64) -> Result<(), TxnError> {
        let logical = [
            ("threadBytes", thread, self.thread),
            ("documentBytes", doc, self.doc),
            ("globalBytes", global, self.global),
        ];
        if let Some((bound, total, limit)) = logical.into_iter().find(|(_, t, l)| t > l) {
            return Err(TxnError::CommentLimit {
                bound,
                limit,
                total,
            });
        }
        if physical > self.physical {
            return Err(TxnError::CommentStorageFull {
                bytes: physical,
                limit: self.physical,
            });
        }
        Ok(())
    }
}

/// A body within `MAX_BODY_BYTES` and not empty.
pub fn check_body(body: &str) -> Result<(), TxnError> {
    let total = body.len() as u64;
    if body.is_empty() {
        return Err(TxnError::InvalidRequest("a comment body is empty".into()));
    }
    if total > MAX_BODY_BYTES {
        return Err(TxnError::CommentLimit {
            bound: "body",
            limit: MAX_BODY_BYTES,
            total,
        });
    }
    Ok(())
}

/// A count bound (`replies`, `comments`): `count` after the mutation.
pub fn check_count(bound: &'static str, count: u64, limit: u64) -> Result<(), TxnError> {
    if count > limit {
        return Err(TxnError::CommentLimit {
            bound,
            limit,
            total: count,
        });
    }
    Ok(())
}
