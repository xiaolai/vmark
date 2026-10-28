//! The history panel's journal entry points on the `Controller`: restore an
//! earlier text as a controlled mutation, and list, restore or discard a
//! document's `uncommitted` transactions.
//!
//! Key decisions:
//!   - A restore commits and aborts through the controlled write's own
//!     `commit` / `abort`; only its prepare differs (`controlled_restore`).
//!   - Restoring an uncommitted entry is a restore of its preimage, which
//!     resolves it; discarding appends `discarded`. Either terminal record
//!     drops the entry's pin, so the panel lists it no more.
//!   - Every call names the document by its key and the transaction must
//!     belong to it: a window acts only on the document it shows. Listing
//!     and the ownership check never mint an id for a key the journal has
//!     not seen (it lists nothing, and owns no transaction).
//!
//! @module agent_journal/controller_history

use serde::{Deserialize, Serialize};

use crate::agent_journal::actor::Actor;
#[cfg(test)]
use crate::agent_journal::admission::receipt::PayloadDigest;
#[cfg(test)]
use crate::agent_journal::controlled_restore::{
    decode_restore_prepare, prepare_restore_with, RestorePrepared,
};
use crate::agent_journal::controller::{decode, invalid, parse_txn, AbortReply, Controller};
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::refusal::refusal;
use crate::command_error::CommandError;

/// Longest preview of an uncommitted entry's text, in `char`s.
pub const PREVIEW_CHARS: usize = 120;

/// One `uncommitted` transaction of a document: a write that was prepared
/// and never committed (a crash, or a commit refused after the apply).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UncommittedEntry {
    pub txn: TxnId,
    pub actor: Actor,
    pub tool: String,
    /// Journal order, decimal string.
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub seq: u64,
    /// The start of the text the write found (its preimage).
    pub preview: String,
    /// Whether `preview` is the whole preimage.
    pub complete: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocRequest {
    doc_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TxnRequest {
    doc_key: String,
    txn: String,
}

impl Controller {
    /// Prepare a restore from a JSON payload (`RestorePrepareRequest`).
    ///
    /// # Errors
    /// The journal refusal, with `detail.journalCode`.
    #[cfg(test)]
    pub fn restore_prepare(&self, payload: &str) -> Result<RestorePrepared, CommandError> {
        let digest = PayloadDigest::of(payload);
        let req = decode_restore_prepare(payload.as_bytes()).map_err(|e| refusal(&e))?;
        let doc = self.docs.resolve(&req.doc_key).map_err(|e| refusal(&e))?;
        let out = prepare_restore_with(&self.writer, doc, req, Some(digest));
        self.settle_prepare(doc, out.is_ok());
        out.map_err(|e| refusal(&e))
    }

    /// The `uncommitted` transactions of a document (`{docKey}`), oldest
    /// first.
    ///
    /// # Errors
    /// An invalid payload or document key.
    pub fn uncommitted(&self, payload: &str) -> Result<Vec<UncommittedEntry>, CommandError> {
        let req: DocRequest = decode(payload)?;
        let Some(doc) = self.docs.find(&req.doc_key).map_err(|e| refusal(&e))? else {
            return Ok(Vec::new());
        };
        // One critical section: a discard and a collection between the
        // selection and the reads could drop a preimage already selected.
        let mut g = self.writer.lock();
        let inner = &mut *g;
        let (txns, blobs) = (&inner.proj.txns, &mut inner.blobs);
        let mut out = Vec::new();
        for (txn, t) in txns
            .iter()
            .filter(|(_, t)| t.doc == doc && t.status == TxnStatus::Uncommitted)
        {
            let text = blobs.get(&t.preimage).map_err(|e| refusal(&e))?;
            let preview: String = text.chars().take(PREVIEW_CHARS).collect();
            out.push(UncommittedEntry {
                txn: *txn,
                actor: t.actor.clone(),
                tool: t.tool.clone(),
                seq: t.seq,
                complete: preview.len() == text.len(),
                preview,
            });
        }
        drop(g);
        out.sort_by_key(|e| e.seq);
        Ok(out)
    }

    /// Discard an `uncommitted` transaction of a document (`{docKey, txn}`).
    ///
    /// # Errors
    /// `INVALID_REQUEST` when the transaction is not an uncommitted one of
    /// that document; a journal refusal otherwise. A failed append is
    /// `durable: false`, not an error.
    pub fn discard(&self, payload: &str) -> Result<AbortReply, CommandError> {
        let req: TxnRequest = decode(payload)?;
        let (doc, txn) = self.owned_txn(&req.doc_key, &req.txn)?;
        let out = self.writer.discard(txn);
        self.settle(doc);
        out.map(|d| AbortReply { durable: d.durable })
            .map_err(|e| refusal(&e))
    }

    fn owned_txn(&self, doc_key: &str, txn: &str) -> Result<(DocId, TxnId), CommandError> {
        let doc = self.docs.find(doc_key).map_err(|e| refusal(&e))?;
        let txn = parse_txn(txn)?;
        let owner = self.writer.lock().proj.txns.get(&txn).map(|t| t.doc);
        match doc {
            Some(doc) if owner == Some(doc) => Ok((doc, txn)),
            _ => Err(invalid("the transaction is not one of this document's")),
        }
    }
}
