//! A framed request (an agent write, a restore, a revert, a comment create
//! or reply; `run_framed_with`) whose payload names the writer incarnation
//! and the page (generation and identity) it was frozen for, answered by
//! the request protocol.
//!
//! Order, in the first critical section: the payload's incarnation is the
//! writer's; its generation is live for the invoking label with that
//! identity; the receipt lookup (an executable identical retry gets its
//! stored reply); then the in-flight, sealed, fenced and bound checks of
//! `requests`, which take the attempt's in-flight entry. The document is
//! resolved outside the lock. The second critical section re-checks the
//! generation and that the entry is still the attempt's (an abandon takes
//! it), runs the prepare, and on success swaps the entry for the
//! transaction's owner in the same step (a revert's recorded decision
//! opens no transaction, so it has no owner).
//!
//! Key decisions:
//!   - The identity fields are decoded by `payload` before anything is
//!     read, and record nothing when malformed.
//!   - A refusal after the entry was taken fences the id (`notAdmitted`),
//!     except a request answer (the receipt's) and a failure that left the
//!     writer unhealthy (`unavailable`: the attempt's fate is not known).
//!   - An answer read from the receipt restarts its document's drain when
//!     degraded (`reconcile`); a refusal from the prepare does the same
//!     through `settle_prepare`.
//!
//! @module agent_journal/admission/framed

use std::collections::HashSet;

use crate::agent_journal::admission::answer::RequestState;
use crate::agent_journal::admission::bound::{Bound, RequestBind};
use crate::agent_journal::admission::page_table::{Liveness, PageTable};
use crate::agent_journal::admission::payload::{admit_identity, Frame};
use crate::agent_journal::admission::prepare::{prepare_admitted, Request};
use crate::agent_journal::admission::receipt::{Outcome, PreparedResponse, RequestId};
use crate::agent_journal::admission::reconcile::{lookup, receipt_doc};
use crate::agent_journal::admission::requests::{Owner, RequestGuard};
use crate::agent_journal::controlled::{controlled_prep, decode_prepare, reused_id, Prep};
use crate::agent_journal::controlled_restore::{
    decode_restore_prepare, restore_prep, RestorePrepared,
};
use crate::agent_journal::controlled_revert::{decode_revert_prepare, revert_prep, RevertReply};
use crate::agent_journal::controlled_wire::ControlledPrepared;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::writer::{Inner, Writer};
use crate::command_error::CommandError;

enum Begun {
    /// Answered from the request's own receipt, about this document.
    Stored(Outcome, Option<DocId>),
    Refused(TxnError, Option<DocId>),
    Held(u64),
}

/// What a framed prepare reads from its decoded body: the request id, the
/// document key, and the prepare (or why the body cannot be one).
type Body = (Option<RequestId>, String, Result<Prep, TxnError>);

impl Controller {
    /// Prepare an agent write from a framed payload.
    ///
    /// # Errors
    /// The journal refusal; once the payload decodes, a request answer.
    pub fn prepare_framed(
        &self,
        pages: &PageTable,
        label: &str,
        payload: &str,
    ) -> Result<Bound<RequestBind, ControlledPrepared>, CommandError> {
        let (bind, out) = self.prepare_body(pages, label, payload, |b| {
            let req = decode_prepare(b)?;
            Ok((req.request_id, req.doc_key.clone(), controlled_prep(req)))
        })?;
        match out {
            Outcome::Prepared(PreparedResponse::Controlled(reply)) => Ok(Bound { bind, reply }),
            _ => Err(refusal(&reused_id())),
        }
    }

    /// Prepare a restore from a framed payload.
    ///
    /// # Errors
    /// As `prepare_framed`.
    pub fn restore_prepare_framed(
        &self,
        pages: &PageTable,
        label: &str,
        payload: &str,
    ) -> Result<Bound<RequestBind, RestorePrepared>, CommandError> {
        let (bind, out) = self.prepare_body(pages, label, payload, |b| {
            let req = decode_restore_prepare(b)?;
            Ok((req.request_id, req.doc_key.clone(), restore_prep(req)))
        })?;
        match out {
            Outcome::Prepared(PreparedResponse::Restore(reply)) => Ok(Bound { bind, reply }),
            _ => Err(refusal(&reused_id())),
        }
    }

    /// Prepare a revert from a framed payload: the patch, or the review
    /// decision a revert that does not apply records instead.
    ///
    /// # Errors
    /// As `prepare_framed`.
    pub fn revert_prepare_framed(
        &self,
        pages: &PageTable,
        label: &str,
        payload: &str,
    ) -> Result<Bound<RequestBind, RevertReply>, CommandError> {
        let (bind, out) = self.prepare_body(pages, label, payload, |b| {
            let req = decode_revert_prepare(b)?;
            Ok((req.request_id, req.doc_key.clone(), revert_prep(req)))
        })?;
        let reply = match out {
            Outcome::Prepared(PreparedResponse::Revert(p)) => RevertReply::Prepared(p),
            Outcome::Decision(d) => RevertReply::Decided(d),
            _ => return Err(refusal(&reused_id())),
        };
        Ok(Bound { bind, reply })
    }

    /// The pipeline every framed prepare shares: the frame, the body
    /// `decode` reads from it, the request id, the prepare, then the
    /// request protocol. Each step refuses before the next runs.
    fn prepare_body(
        &self,
        pages: &PageTable,
        label: &str,
        payload: &str,
        decode: impl FnOnce(&[u8]) -> Result<Body, TxnError>,
    ) -> Result<(RequestBind, Outcome), CommandError> {
        let frame = Frame::decode(payload)?;
        let (id, key, prep) = decode(frame.body().as_bytes()).map_err(|e| refusal(&e))?;
        let request = frame.request(id)?;
        let prep = prep.map_err(|e| refusal(&e))?;
        let work = |w: &Writer, g: &mut Inner, doc, r| prepare_admitted(w, g, doc, prep, Some(r));
        let out = self.run_framed_with(pages, label, &frame, &request, &key, work)?;
        Ok((frame.bind(&request), out))
    }

    /// The request protocol around `work`, which runs in the second
    /// critical section on the resolved document (a prepare, a comment
    /// create or reply).
    pub(crate) fn run_framed_with(
        &self,
        pages: &PageTable,
        label: &str,
        frame: &Frame,
        request: &Request,
        key: &str,
        work: impl FnOnce(&Writer, &mut Inner, DocId, Request) -> Result<Outcome, TxnError>,
    ) -> Result<Outcome, CommandError> {
        let w = &*self.writer;
        let owner = Owner {
            label: label.into(),
            generation: frame.generation,
        };
        let begun = begin(w, &mut w.lock(), pages, frame, request, owner.clone());
        let mut guard = match begun.map_err(|e| refusal(&e))? {
            Begun::Stored(reply, doc) => {
                self.restart_drain(doc);
                return Ok(reply);
            }
            Begun::Refused(e, doc) => {
                self.restart_drain(doc);
                return Err(refusal(&e));
            }
            Begun::Held(invocation) => RequestGuard {
                writer: w,
                id: request.id,
                invocation,
                generation: frame.generation,
                settled: false,
            },
        };
        let doc = match self.docs.resolve(key) {
            Ok(doc) => doc,
            Err(e) => {
                let mut g = w.lock();
                guard.settled = true;
                g.requests.end(request.id, guard.invocation);
                g.requests.fence(request.id, frame.generation);
                return Err(refusal(&request.refused(RequestState::NotAdmitted(e))));
            }
        };
        let out = {
            let mut g = w.lock();
            guard.settled = true;
            let attempt = Attempt {
                owner: &owner,
                frame,
                request,
                invocation: guard.invocation,
            };
            admit(w, &mut g, pages, &attempt, doc, work)
        };
        self.settle_prepare(doc, out.is_ok());
        out.map_err(|e| refusal(&e))
    }
}

impl Controller {
    /// After an answer read from a receipt: restart the drain of its
    /// document if degraded, changing nothing else.
    pub(crate) fn restart_drain(&self, doc: Option<DocId>) {
        if let Some(doc) = doc {
            self.settle_prepare(doc, false);
        }
    }
}

/// The first critical section. See the module docs.
fn begin(
    w: &Writer,
    g: &mut Inner,
    pages: &PageTable,
    frame: &Frame,
    request: &Request,
    owner: Owner,
) -> Result<Begun, TxnError> {
    let live = || -> HashSet<u64> { pages.live_generations() };
    admit_identity(w, pages, &owner.label, frame).map_err(|s| request.refused(s))?;
    match lookup(g, request) {
        Ok(Some(stored)) => return Ok(Begun::Stored(stored, receipt_doc(g, request))),
        Err(e) => return Ok(Begun::Refused(e, receipt_doc(g, request))),
        Ok(None) => {}
    }
    g.requests
        .begin(request.id, &request.digest, owner, live)
        .map(Begun::Held)
        .map_err(|s| request.refused(s))
}

/// One attempt of a request, between its two critical sections.
struct Attempt<'a> {
    owner: &'a Owner,
    frame: &'a Frame,
    request: &'a Request,
    invocation: u64,
}

/// The second critical section: re-check, prepare, and settle the entry.
fn admit(
    w: &Writer,
    g: &mut Inner,
    pages: &PageTable,
    attempt: &Attempt<'_>,
    doc: DocId,
    work: impl FnOnce(&Writer, &mut Inner, DocId, Request) -> Result<Outcome, TxnError>,
) -> Result<Outcome, TxnError> {
    let Attempt {
        owner,
        frame,
        request,
        invocation,
    } = *attempt;
    let id = request.id;
    if pages.liveness(&owner.label, owner.generation, &frame.identity) != Liveness::Own {
        if g.requests.holds(id, invocation) {
            g.requests.end(id, invocation);
            g.requests.fence(id, owner.generation);
        }
        return Err(request.refused(RequestState::StaleGeneration));
    }
    if !g.requests.holds(id, invocation) {
        return Err(request.refused(RequestState::Abandoned));
    }
    let out = work(w, g, doc, request.clone());
    g.requests.end(id, invocation);
    match out {
        Ok(reply) => {
            if let Some(txn) = reply.txn() {
                g.requests.owners.insert(txn, owner.clone());
            }
            Ok(reply)
        }
        Err(e @ TxnError::Request(_)) => Err(e),
        Err(e) if g.healthy().is_err() => {
            log::error!("agent journal: request {id} failed on an unhealthy writer ({e})");
            Err(request.refused(RequestState::Unavailable))
        }
        Err(e) => {
            g.requests.fence(id, owner.generation);
            Err(request.refused(RequestState::NotAdmitted(e)))
        }
    }
}
