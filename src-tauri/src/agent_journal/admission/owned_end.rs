//! How the sweep ends a transaction whose page is gone: `uncommitted`
//! through the writer's terminal path, or, for a prepared transaction that
//! lost its reservation, by a plain append. See `admission::owned`.
//!
//! @module agent_journal/admission/owned_end

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::record::Record;
use crate::agent_journal::writer::{Inner, Writer};

/// How the sweep left a transaction whose page is gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnedEnd {
    /// `uncommitted` appended.
    Recorded,
    /// `uncommitted` queued behind a failed append.
    Queued,
    /// It had already ended.
    AlreadyTerminal,
    /// Its terminal record was already queued.
    AlreadyQueued,
    /// The writer is corrupt; the owner is kept for after a reopen.
    WriterStopped,
    /// A writer bug: the owner names something the writer cannot end.
    Invariant(OwnedBreak),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnedBreak {
    UnknownTxn,
    NoReservation,
    Refused(&'static str),
}

/// End a prepared `txn` that holds no reservation (a writer bug, already
/// counted) `uncommitted` by a plain append, so no other transaction's
/// reservation is released. Behind a non-empty queue, or when the append
/// fails, the owner is kept and the next sweep tries again.
fn end_unreserved(w: &Writer, g: &mut Inner, doc: DocId, txn: TxnId) -> OwnedEnd {
    if g.degraded.get(&doc).is_some_and(|q| !q.is_empty()) {
        return OwnedEnd::Invariant(OwnedBreak::NoReservation);
    }
    match w.append(g, txn, Record::Uncommitted, &[]) {
        Ok(_) => {
            g.requests.owners.remove(&txn);
            g.addresses.remove(&txn);
            OwnedEnd::Recorded
        }
        Err(TxnError::Corrupt(_)) => OwnedEnd::WriterStopped,
        Err(e) => OwnedEnd::Invariant(OwnedBreak::Refused(e.code())),
    }
}

/// End `txn`, whose owner is gone, `uncommitted`. See the module docs.
pub(crate) fn end_owned_in(w: &Writer, g: &mut Inner, txn: TxnId) -> OwnedEnd {
    let broken = |g: &mut Inner, why: OwnedBreak, drop_owner: bool| {
        log::error!(
            "agent journal: cannot end owned transaction {} ({why:?})",
            txn.0
        );
        g.requests.owner_invariant_breaks += 1;
        if drop_owner {
            g.requests.owners.remove(&txn);
        }
        OwnedEnd::Invariant(why)
    };
    let Some(t) = g.proj.txns.get(&txn).cloned() else {
        return broken(g, OwnedBreak::UnknownTxn, true);
    };
    if t.status != TxnStatus::Prepared {
        g.requests.owners.remove(&txn);
        return OwnedEnd::AlreadyTerminal;
    }
    if g.degraded
        .get(&t.doc)
        .is_some_and(|q| q.iter().any(|q| q.txn == txn))
    {
        g.requests.owners.remove(&txn);
        return OwnedEnd::AlreadyQueued;
    }
    if !g.reservations.get(&t.doc).is_some_and(|r| r.txn == txn) {
        broken(g, OwnedBreak::NoReservation, false);
        return end_unreserved(w, g, t.doc, txn);
    }
    match w.terminal(g, t.doc, txn, Record::Uncommitted, vec![]) {
        Ok(true) => OwnedEnd::Recorded,
        Ok(false) => OwnedEnd::Queued,
        Err(e) => match &e {
            TxnError::Corrupt(_) => OwnedEnd::WriterStopped,
            TxnError::JournalBusy { .. }
            | TxnError::StaleParent { .. }
            | TxnError::JournalDegraded
            | TxnError::StaleReview { .. }
            | TxnError::ReviewBacklogFull { .. }
            | TxnError::ReviewStateExhausted { .. }
            | TxnError::AmbiguousRevert { .. }
            | TxnError::RevertRefused { .. }
            | TxnError::Saturated(_)
            | TxnError::StalePage(_)
            | TxnError::StaleRegistration(_)
            | TxnError::Request(_)
            | TxnError::InvalidRequest(_)
            | TxnError::InvalidProvenance(_)
            | TxnError::InvalidAddresses(_)
            | TxnError::InvalidText(_)
            | TxnError::CommentAnchorTooLong { .. }
            | TxnError::StaleComment { .. }
            | TxnError::CommentStateExhausted { .. }
            | TxnError::CommentStorageFull { .. }
            | TxnError::CommentLimit { .. }
            | TxnError::CommentNotAllowed { .. }
            | TxnError::Io(_)
            | TxnError::Indeterminate(_)
            | TxnError::Invariant(_)
            | TxnError::FutureFormat { .. } => broken(g, OwnedBreak::Refused(e.code()), false),
        },
    }
}
