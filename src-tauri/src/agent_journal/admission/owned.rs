//! Transactions owned by the page that prepared them: a commit or abort
//! must name that page's live pair, and a transaction whose page is gone
//! is ended by the sweep.
//!
//! Key decisions:
//!   - The ownership check runs inside the commit's (or abort's) own
//!     critical section, after the transaction is known open and before
//!     anything changes, so it linearizes at the page-table lookup made
//!     there. The table lock is taken and released inside that lookup and
//!     never held across the append.
//!   - A pair registered under no label is `STALE_PAGE`: the page is gone
//!     and the sweep ends its transaction `uncommitted`. A live pair that
//!     is not the owner's is `INVALID_REQUEST`. Neither ends the
//!     transaction: a refused owner check changes nothing.
//!   - The sweep matches every refusal of the terminal append with no
//!     wildcard; one that means a writer bug keeps the owner (the next
//!     sweep tries again) and is counted.
//!   - An owner whose transaction the writer does not know is counted and
//!     dropped: no later sweep could succeed. One prepared with no
//!     reservation is counted and still ended `uncommitted` by a plain
//!     append that releases no reservation (`end_unreserved`); a failed
//!     append keeps the owner for the next sweep.
//!
//! @module agent_journal/admission/owned

use crate::agent_journal::admission::bound::{Bound, PairBind};
use crate::agent_journal::admission::identity::{parse_generation, PageIdentity};
use crate::agent_journal::admission::page_table::{Liveness, PageTable};
use crate::agent_journal::admission::requests::Owner;
use crate::agent_journal::controlled::{
    abort_controlled_with, commit_controlled_with, txn_doc, AbortReason, ControlledCommitted,
};
use crate::agent_journal::controller::{invalid, parse_txn, AbortReply, Controller};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::writer::Inner;
use crate::agent_journal::writer_txn::Authorize;
use crate::command_error::CommandError;

#[path = "owned_end.rs"]
mod end;
use end::end_owned_in;
pub use end::{OwnedBreak, OwnedEnd};

/// The page pair a commit or abort names.
struct Pair {
    identity: PageIdentity,
    generation: u64,
}

impl Pair {
    fn parse(identity: &str, generation: &str) -> Result<Self, CommandError> {
        let identity = PageIdentity::parse(identity).map_err(|e| refusal(&e))?;
        let generation = parse_generation(generation).map_err(|e| refusal(&e))?;
        Ok(Self {
            identity,
            generation,
        })
    }

    fn bind(&self, txn: TxnId) -> PairBind {
        PairBind {
            txn,
            page_identity: self.identity.to_string(),
            webview_generation: self.generation,
        }
    }

    /// Whether the page `label` names with this pair owns `txn`.
    fn authorize(
        &self,
        g: &Inner,
        pages: &PageTable,
        label: &str,
        txn: TxnId,
    ) -> Result<(), TxnError> {
        match pages.liveness(label, self.generation, &self.identity) {
            Liveness::Dead => Err(TxnError::StalePage(format!(
                "page generation {} is no longer registered",
                self.generation
            ))),
            Liveness::OtherIdentity | Liveness::OtherLabel => Err(TxnError::InvalidRequest(
                "the page pair is not the invoking window's".into(),
            )),
            Liveness::Own => {
                let owner = Owner {
                    label: label.into(),
                    generation: self.generation,
                };
                match g.requests.owners.get(&txn) {
                    Some(o) if *o == owner => Ok(()),
                    _ => Err(TxnError::InvalidRequest(
                        "the page does not own the transaction".into(),
                    )),
                }
            }
        }
    }
}

impl Controller {
    /// Commit `txn` for the page that owns it.
    ///
    /// # Errors
    /// `STALE_PAGE` for a page that is gone, `INVALID_REQUEST` for another
    /// page; the commit's refusals otherwise.
    #[allow(clippy::too_many_arguments)]
    pub fn commit_owned(
        &self,
        pages: &PageTable,
        label: &str,
        txn: &str,
        payload: &str,
        page_identity: &str,
        generation: &str,
    ) -> Result<Bound<PairBind, ControlledCommitted>, CommandError> {
        let txn = parse_txn(txn)?;
        let pair = Pair::parse(page_identity, generation)?;
        self.end_owned(pages, label, txn, &pair, |auth| {
            commit_controlled_with(&self.writer, txn, payload.as_bytes(), Some(auth))
        })
    }

    /// Abort `txn` for the page that owns it, because re-verification
    /// failed.
    ///
    /// # Errors
    /// As `commit_owned`; an unknown reason is `INVALID_REQUEST`.
    pub fn abort_owned(
        &self,
        pages: &PageTable,
        label: &str,
        txn: &str,
        reason: &str,
        page_identity: &str,
        generation: &str,
    ) -> Result<Bound<PairBind, AbortReply>, CommandError> {
        let txn = parse_txn(txn)?;
        let pair = Pair::parse(page_identity, generation)?;
        let reason: AbortReason = serde_json::from_value(serde_json::json!(reason))
            .map_err(|_| invalid(&format!("unknown abort reason {reason:?}")))?;
        self.end_owned(pages, label, txn, &pair, |auth| {
            abort_controlled_with(&self.writer, txn, reason, Some(auth))
                .map(|d| AbortReply { durable: d.durable })
        })
    }

    /// Run `end` on `txn` behind the pair's authorization, then settle its
    /// document whatever the outcome.
    fn end_owned<R>(
        &self,
        pages: &PageTable,
        label: &str,
        txn: TxnId,
        pair: &Pair,
        end: impl FnOnce(Authorize<'_>) -> Result<R, TxnError>,
    ) -> Result<Bound<PairBind, R>, CommandError> {
        let auth = |g: &Inner| pair.authorize(g, pages, label, txn);
        let doc = txn_doc(&self.writer, txn);
        let out = end(&auth);
        doc.inspect(|&d| self.settle(d));
        Ok(Bound {
            bind: pair.bind(txn),
            reply: out.map_err(|e| refusal(&e))?,
        })
    }

    /// End every owned transaction whose page generation no label holds,
    /// and drop the request state of dead generations.
    pub fn sweep(&self, pages: &PageTable) -> Vec<(TxnId, OwnedEnd)> {
        let w = &*self.writer;
        let (ended, docs) = {
            let mut g = w.lock();
            let live = pages.live_generations();
            g.requests.purge(&live);
            let mut dead: Vec<TxnId> = g
                .requests
                .owners
                .iter()
                .filter(|(_, o)| !live.contains(&o.generation))
                .map(|(t, _)| *t)
                .collect();
            dead.sort();
            let docs: Vec<DocId> = dead
                .iter()
                .filter_map(|t| g.proj.txns.get(t).map(|e| e.doc))
                .collect();
            let ended: Vec<_> = dead
                .into_iter()
                .map(|t| (t, end_owned_in(w, &mut g, t)))
                .collect();
            (ended, docs)
        };
        for doc in docs {
            self.settle(doc);
        }
        ended
    }
}
