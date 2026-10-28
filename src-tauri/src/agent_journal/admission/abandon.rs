//! Abandoning a request: the page gives up on a request id whose reply it
//! never got, so no attempt of it is admitted later and a transaction it
//! prepared stops holding the document.
//!
//! Order, in one critical section: the payload's incarnation and its
//! generation's liveness (as a prepare's), then by what the id has:
//!   - a receipt under another digest is a conflict; an executable
//!     transaction is aborted (`aborted`, or `abortQueued` behind a failed
//!     append); an ended one, or one whose ending is queued, is reported;
//!     an unhealthy writer is `unavailable`; a revert's recorded decision
//!     is `decided` and a comment create's or reply's `answered`, ending
//!     nothing. An answer read from the
//!     receipt restarts its document's drain when degraded (`reconcile`);
//!   - an in-flight entry under another digest is a conflict; otherwise
//!     the entry is taken and the id fenced, so the running attempt
//!     answers `abandoned`;
//!   - a fenced id, or an unknown one, is (left or made) fenced. An unknown
//!     id in a sealed generation records nothing: the generation refuses
//!     every new id already.
//!
//! Key decisions:
//!   - Only `requestId` and the identity fields are read from the payload;
//!     the digest is of the whole payload, so an abandon is bound to the
//!     exact bytes the prepare sent.
//!
//! @module agent_journal/admission/abandon

use crate::agent_journal::admission::answer::RequestState;
use crate::agent_journal::admission::bound::AbandonReply;
use crate::agent_journal::admission::page_table::PageTable;
use crate::agent_journal::admission::payload::{admit_identity, Frame};
use crate::agent_journal::admission::prepare::Request;
use crate::agent_journal::admission::receipt::{Outcome, Receipt, RequestId};
use crate::agent_journal::admission::reconcile::classify_prepared;
use crate::agent_journal::controller::{invalid, Controller};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::record::Record;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::writer::{Inner, Writer};
use crate::command_error::CommandError;

/// The reason an abandoned transaction's `aborted` record carries.
pub const ABANDONED: &str = "abandoned";

impl Controller {
    /// Abandon the request a framed payload sent.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a payload that does not decode; a request
    /// answer otherwise.
    pub fn abandon(
        &self,
        pages: &PageTable,
        label: &str,
        payload: &str,
    ) -> Result<AbandonReply, CommandError> {
        let frame = Frame::decode(payload)?;
        let id: RequestId = frame
            .rest
            .get("requestId")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| invalid("an abandon names the requestId it abandons"))?;
        let request = Request {
            id,
            digest: frame.digest.clone(),
        };
        let w = &*self.writer;
        let (out, then) = abandon_in(w, &mut w.lock(), pages, label, &frame, &request);
        match then {
            Then::Nothing => {}
            Then::Settle(doc) => self.settle(doc),
            Then::Restart(doc) => self.restart_drain(Some(doc)),
        }
        out.map_err(|e| refusal(&e))
    }
}

/// What the document needs once the writer lock is released.
enum Then {
    Nothing,
    /// The abandon ended or tried to end the transaction: settle as after
    /// any call.
    Settle(DocId),
    /// The answer was read from the receipt: restart a degraded drain.
    Restart(DocId),
}

type Answered = (Result<AbandonReply, TxnError>, Then);

fn abandon_in(
    w: &Writer,
    g: &mut Inner,
    pages: &PageTable,
    label: &str,
    frame: &Frame,
    request: &Request,
) -> Answered {
    let refused = |s| (Err(request.refused(s)), Then::Nothing);
    if let Err(s) = admit_identity(w, pages, label, frame) {
        return refused(s);
    }
    let id = request.id;
    if let Some(receipt) = g.proj.requests.get(&id) {
        if receipt.digest != request.digest {
            return refused(RequestState::Conflict);
        }
        let reply = match &receipt.outcome {
            Outcome::Prepared(reply) => reply,
            Outcome::CommentCreated(_) => {
                return answered(AbandonReply::Answered("commentCreated"), receipt);
            }
            Outcome::CommentReplied(_) => {
                return answered(AbandonReply::Answered("commentReplied"), receipt);
            }
            Outcome::Decision(_) => return answered(AbandonReply::Decided, receipt),
        };
        let verdict = classify_prepared(g, reply).map(drop);
        return abandon_txn(w, g, request, reply.txn(), verdict);
    }
    if let Some(digest) = g.requests.inflight_digest(id) {
        if *digest != request.digest {
            return refused(RequestState::Conflict);
        }
        g.requests.abandon_inflight(id);
        return (Ok(AbandonReply::Fenced), Then::Nothing);
    }
    if !g.requests.is_fenced(id) && !g.requests.is_sealed(frame.generation) {
        let live = pages.live_generations();
        g.requests.fence_new(id, frame.generation, &live);
    }
    (Ok(AbandonReply::Fenced), Then::Nothing)
}

/// A request already answered by a final outcome: nothing to abandon.
fn answered(reply: AbandonReply, receipt: &Receipt) -> Answered {
    (Ok(reply), Then::Restart(receipt.outcome.doc()))
}

/// Abandon the transaction a receipted prepare opened: abort it while it
/// is open, else answer with how it ended.
fn abandon_txn(
    w: &Writer,
    g: &mut Inner,
    request: &Request,
    txn: TxnId,
    verdict: Result<(), RequestState>,
) -> Answered {
    let Some(doc) = g.proj.txns.get(&txn).map(|t| t.doc) else {
        log::error!("agent journal: receipt names unknown transaction {}", txn.0);
        return (
            Err(request.refused(RequestState::Unavailable)),
            Then::Nothing,
        );
    };
    match verdict {
        Ok(()) => {
            let aborted = Record::Aborted {
                reason: ABANDONED.into(),
            };
            match w.terminal(g, doc, txn, aborted, vec![]) {
                Ok(true) => (Ok(AbandonReply::Aborted), Then::Settle(doc)),
                Ok(false) => (Ok(AbandonReply::AbortQueued), Then::Settle(doc)),
                Err(e) => {
                    log::error!("agent journal: abandoning {} failed ({e})", txn.0);
                    let s = RequestState::Unavailable;
                    (Err(request.refused(s)), Then::Settle(doc))
                }
            }
        }
        Err(
            s @ (RequestState::TerminalPending(_)
            | RequestState::Terminal(_)
            | RequestState::Abandoned),
        ) => (Ok(AbandonReply::Ended(s)), Then::Restart(doc)),
        Err(s) => (Err(request.refused(s)), Then::Restart(doc)),
    }
}
