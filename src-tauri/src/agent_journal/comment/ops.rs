//! Replying to a thread and changing its state, each inside one critical
//! section of the writer lock.
//!
//! A reply is framed (its receipt answers an identical retry) and appends
//! one top-level `commentReplied` with that receipt. A state change or a
//! deletion is not framed: `expectedCommentGen` is its only guard, so a
//! retry after success is `STALE_COMMENT`, never a second record. Neither
//! names text, so neither waits on the document's transactions; both need
//! a healthy writer.
//!
//! Refusal order: the thread exists (`INVALID_REQUEST` otherwise: an id
//! never minted, or pruned with its deleted thread at startup), is
//! undeleted (`STALE_COMMENT`), is on the document (`INVALID_REQUEST`) and
//! is at the expected generation (`STALE_COMMENT`); the caller
//! may take the action from the thread's state (`COMMENT_NOT_ALLOWED`);
//! `commentGen` is not exhausted (`COMMENT_STATE_EXHAUSTED`); the caps
//! (`comment::book`). A refusal appends nothing.
//!
//! @module agent_journal/comment/ops

use crate::agent_journal::admission::prepare::{Request, Responder};
use crate::agent_journal::admission::publish::Staging;
use crate::agent_journal::admission::receipt::Outcome;
use crate::agent_journal::admission::reconcile::lookup;
use crate::agent_journal::admission::reduce::preflight;
use crate::agent_journal::comment::bounds::check_body;
use crate::agent_journal::comment::create::admit;
use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ReplyId};
use crate::agent_journal::comment::records::{CommentDeleted, CommentReplied, CommentState};
use crate::agent_journal::comment::replies::{
    CommentDeletedReply, CommentRepliedReply, CommentStateReply,
};
use crate::agent_journal::comment::rules::{allowed, Action};
use crate::agent_journal::comment::wire::ReplyRequest;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V5};
use crate::agent_journal::writer::{Inner, Writer};
use crate::agent_journal::writer_types::now_ms;
use crate::command_error::CommandError;

/// A decoded reply and the route it came by.
pub(crate) struct ReplyPrep {
    pub(crate) req: ReplyRequest,
    pub(crate) caller: CommentCaller,
}

/// Check a reply's body before any request state is taken.
pub(crate) fn reply_prep(req: ReplyRequest, caller: CommentCaller) -> Result<ReplyPrep, TxnError> {
    check_body(&req.body)?;
    Ok(ReplyPrep { req, caller })
}

fn envelope(
    seq: u64,
    record: Record,
    receipt: Option<crate::agent_journal::admission::receipt::Receipt>,
) -> Envelope {
    Envelope {
        schema_version: SCHEMA_V5,
        seq,
        txn: TxnId::new(),
        at: now_ms(),
        record,
        receipt,
    }
}

/// Reply to a thread on `doc`. See the module docs.
pub(crate) fn reply_admitted(
    w: &Writer,
    g: &mut Inner,
    doc: DocId,
    p: ReplyPrep,
    request: &Request,
) -> Result<Outcome, TxnError> {
    if let Some(stored) = lookup(g, request)? {
        return Ok(stored);
    }
    g.healthy()?;
    let seq = g.next_generation()?;
    let r = p.req;
    let expected = r.expected_comment_gen;
    let reply = ReplyId::at(seq);
    let response = Outcome::CommentReplied(CommentRepliedReply {
        doc,
        comment: r.comment,
        reply,
        generation: seq,
        comment_gen: expected.saturating_add(1),
    });
    let record = Record::CommentReplied(CommentReplied {
        doc,
        comment: r.comment,
        reply,
        body: r.body,
        author: r.author,
        caller: p.caller,
        expected_comment_gen: expected,
    });
    let env = envelope(seq, record, Responder::receipt(Some(request), &response));
    admit(&g.proj, &env)?;
    preflight(&g.proj, &env).map_err(|e| TxnError::Invariant(format!("comment reply: {e}")))?;
    let txn = env.txn;
    w.publish(
        g,
        Staging {
            env,
            blobs: Vec::new(),
            staged: None,
            doc,
            txn,
            response: response.clone(),
            fallback: None,
        },
    )?;
    Ok(response)
}

/// What a state change or deletion answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Transitioned {
    State(CommentStateReply),
    Deleted(CommentDeletedReply),
}

impl Transitioned {
    /// The state reply of a state change.
    ///
    /// # Errors
    /// An internal error when the change was a deletion.
    pub fn into_state(self) -> Result<CommentStateReply, CommandError> {
        match self {
            Self::State(r) => Ok(r),
            Self::Deleted(_) => Err(CommandError::internal("a state change answered a deletion")),
        }
    }

    /// The deletion reply of a deletion.
    ///
    /// # Errors
    /// An internal error when the change was not a deletion.
    pub fn into_deleted(self) -> Result<CommentDeletedReply, CommandError> {
        match self {
            Self::Deleted(r) => Ok(r),
            Self::State(_) => Err(CommandError::internal("a deletion answered a state change")),
        }
    }
}

/// Take `action` (not a reply) on `comment` of `doc` for `caller`. See the
/// module docs.
pub(crate) fn transition(
    w: &Writer,
    doc: DocId,
    comment: CommentId,
    expected: u64,
    caller: CommentCaller,
    action: Action,
) -> Result<Transitioned, TxnError> {
    debug_assert!(action != Action::Reply, "a reply is framed");
    let mut g = w.lock();
    g.healthy()?;
    let t = g.proj.comments.thread_at(comment, doc, expected)?;
    let from = t.state;
    let to = allowed(action, caller, from).ok_or(TxnError::CommentNotAllowed {
        action: action.name(),
        caller,
        state: from,
    })?;
    let seq = g.next_generation()?;
    let record = if action == Action::Delete {
        Record::CommentDeleted(CommentDeleted {
            doc,
            comment,
            caller,
            expected_comment_gen: expected,
        })
    } else {
        Record::CommentState(CommentState {
            doc,
            comment,
            from,
            to,
            caller,
            expected_comment_gen: expected,
        })
    };
    let env = envelope(seq, record, None);
    admit(&g.proj, &env)?;
    preflight(&g.proj, &env)
        .map_err(|e| TxnError::Invariant(format!("comment {}: {e}", action.name())))?;
    w.publish_record(&mut g, env)?;
    let after = g
        .proj
        .comments
        .threads
        .get(&comment)
        .ok_or_else(|| TxnError::Invariant(format!("{comment} vanished on append")))?;
    Ok(if action == Action::Delete {
        Transitioned::Deleted(CommentDeletedReply {
            doc,
            comment,
            generation: seq,
        })
    } else {
        Transitioned::State(CommentStateReply {
            doc,
            comment,
            state: after.state,
            generation: seq,
            comment_gen: after.comment_gen,
        })
    })
}
