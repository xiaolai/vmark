//! The command-side entry for controlled writes, save captures, editing
//! epochs and window releases: decodes
//! IPC strings, resolves the document, calls `controlled` or `capture`,
//! maps refusals onto `CommandError`, linearizes the saves a settled
//! reservation was holding, and starts the background drainer whenever the
//! touched document is left degraded (a failed `committed`, `aborted`,
//! baseline or capture append) or a save failed to linearize, so neither
//! waits for a restart. The review panel's decisions live in `review`.
//! The unframed `prepare`, `commit`, `abort` (and `restore_prepare`) are
//! test-only: a window reaches the framed, page-owned entries
//! (`admission::framed`), which carry request receipts and page ownership.
//!
//! @module agent_journal/controller

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;

#[cfg(test)]
use crate::agent_journal::admission::receipt::PayloadDigest;
use crate::agent_journal::capture::{
    capture_save, decode_capture, linearize_pending, CaptureReply, WINDOW_MAX_BYTES,
};
#[cfg(test)]
use crate::agent_journal::controlled::{
    abort_controlled, commit_controlled, decode_prepare, prepare_controlled_with, txn_doc,
    AbortReason, ControlledCommitted, ControlledPrepared,
};
use crate::agent_journal::degraded_drain::DrainScheduler;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::writer::Writer;
use crate::command_error::CommandError;

#[path = "controller_review.rs"]
pub mod review;

/// Reply to an abort: `durable: false` means the `aborted` record is queued
/// and the document stays reserved until the drainer lands it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortReply {
    pub durable: bool,
}

#[derive(Clone)]
pub struct Controller {
    pub(crate) writer: Arc<Writer>,
    pub(crate) docs: Arc<DocRegistry>,
    drains: Arc<DrainScheduler>,
}

impl Controller {
    pub fn new(writer: Arc<Writer>, docs: Arc<DocRegistry>, drains: Arc<DrainScheduler>) -> Self {
        Self {
            writer,
            docs,
            drains,
        }
    }

    /// Prepare a controlled write from a JSON payload.
    ///
    /// # Errors
    /// The journal refusal, with `detail.journalCode`.
    #[cfg(test)]
    pub fn prepare(&self, payload: &str) -> Result<ControlledPrepared, CommandError> {
        let digest = PayloadDigest::of(payload);
        let req = decode_prepare(payload.as_bytes()).map_err(|e| refusal(&e))?;
        let doc = self.docs.resolve(&req.doc_key).map_err(|e| refusal(&e))?;
        let out = prepare_controlled_with(&self.writer, doc, req, Some(digest));
        self.settle_prepare(doc, out.is_ok());
        out.map_err(|e| refusal(&e))
    }

    /// After a prepare: a prepared document is settled as after any call;
    /// a refused one is left exactly as it was (its pending captures stay
    /// pending, for the retry's frame to linearize), with only the drainer
    /// started if the document is degraded.
    pub(crate) fn settle_prepare(&self, doc: DocId, prepared: bool) {
        if prepared {
            self.settle(doc);
        } else if self.writer.is_degraded(doc) {
            self.drains.ensure(self.writer.clone(), doc);
        }
    }

    /// Commit an open transaction with the applied text.
    ///
    /// # Errors
    /// The journal refusal; an I/O failure is not an error but
    /// `durable: false`.
    #[cfg(test)]
    pub fn commit(&self, txn: &str, payload: &str) -> Result<ControlledCommitted, CommandError> {
        let txn = parse_txn(txn)?;
        let doc = txn_doc(&self.writer, txn);
        let out = commit_controlled(&self.writer, txn, payload.as_bytes());
        doc.inspect(|&d| self.settle(d));
        out.map_err(|e| refusal(&e))
    }

    /// Abort an open transaction because re-verification failed.
    ///
    /// # Errors
    /// An unknown reason or transaction is `invalid-input`.
    #[cfg(test)]
    pub fn abort(&self, txn: &str, reason: &str) -> Result<AbortReply, CommandError> {
        let txn = parse_txn(txn)?;
        let reason: AbortReason = serde_json::from_value(json!(reason)).map_err(|_| {
            CommandError::invalid_input(format!("INVALID_REQUEST: unknown abort reason {reason:?}"))
                .with_detail(json!({ "journalCode": "INVALID_REQUEST" }))
        })?;
        let doc = txn_doc(&self.writer, txn);
        let out = abort_controlled(&self.writer, txn, reason);
        doc.inspect(|&d| self.settle(d));
        out.map(|d| AbortReply { durable: d.durable })
            .map_err(|e| refusal(&e))
    }

    /// Record a save of a document (`capture`).
    ///
    /// # Errors
    /// The journal refusal; a failed append is `journaled: no`, not an
    /// error.
    pub fn capture(&self, payload: &str) -> Result<CaptureReply, CommandError> {
        let req = decode_capture(payload.as_bytes()).map_err(|e| refusal(&e))?;
        let doc = self.docs.resolve(&req.doc_key).map_err(|e| refusal(&e))?;
        let key = req.doc_key.clone();
        let out = capture_save(&self.writer, doc, req);
        // A capture follows VMark's own write: the identity it left is trusted.
        self.docs.note_saved(&key);
        self.settle(doc);
        out.map_err(|e| refusal(&e))
    }

    /// Arm the next editing epoch of a document (`payload`: `{docKey}`).
    ///
    /// # Errors
    /// `INVALID_REQUEST` while one is armed; a write refusal otherwise.
    pub fn arm_epoch(&self, payload: &str) -> Result<EpochReply, CommandError> {
        let req: EpochRequest = decode(payload)?;
        if req.epoch.is_some() || req.doc.is_some() {
            return Err(invalid("arming names no epoch and no document"));
        }
        let doc = self.docs.resolve(&req.doc_key).map_err(|e| refusal(&e))?;
        let epoch = self.writer.arm_epoch(doc).map_err(|e| refusal(&e))?;
        let head = self.writer.head(doc);
        let head_hash = head.and_then(|h| self.writer.lock().proj.postimage_of(Some(h)));
        let head = head.filter(|_| head_hash.is_some());
        Ok(EpochReply {
            doc,
            epoch,
            head,
            head_hash: head_hash.map(|h| h.as_str().to_owned()),
        })
    }

    /// Close the armed epoch (`payload`: `{docKey, epoch, doc?}`), a CAS.
    ///
    /// # Errors
    /// `INVALID_REQUEST` when `epoch` is not the armed one.
    pub fn close_epoch(&self, payload: &str) -> Result<(), CommandError> {
        let req: EpochRequest = decode(payload)?;
        let epoch = req
            .epoch
            .ok_or_else(|| invalid("closing names its epoch"))?;
        let doc = match req.doc {
            Some(doc) => doc,
            None => self.docs.resolve(&req.doc_key).map_err(|e| refusal(&e))?,
        };
        self.writer.close_epoch(doc, epoch).map_err(|e| refusal(&e))
    }

    /// A window closed its document: drop its base root. Idempotent.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for an empty or over-long window name.
    pub fn release_window(&self, window: &str) -> Result<(), CommandError> {
        if window.is_empty() || window.len() > WINDOW_MAX_BYTES {
            return Err(invalid(&format!(
                "window must be 1..={WINDOW_MAX_BYTES} bytes"
            )));
        }
        self.writer.clear_window_base(window);
        Ok(())
    }

    /// After any call: linearize the saves a reservation was holding, and
    /// start the drainer if the document is left degraded or a save failed
    /// to linearize for a reason a retry can clear.
    pub(crate) fn settle(&self, doc: DocId) {
        let lin = linearize_pending(&self.writer, doc);
        if lin.retry || self.writer.is_degraded(doc) {
            self.drains.ensure(self.writer.clone(), doc);
        }
    }
}

/// `{docKey}` to arm, `{docKey, epoch, doc?}` to close. `doc` is the
/// document the epoch was armed on (the arm reply's), so a close that
/// arrives after a rename or Save As moved the key still closes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EpochRequest {
    doc_key: String,
    #[serde(default)]
    doc: Option<DocId>,
    #[serde(default, with = "opt_u64_wire")]
    epoch: Option<u64>,
}

mod opt_u64_wire {
    use serde::{de::Error as _, Deserialize, Deserializer};

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
        let s = String::deserialize(d)?;
        crate::agent_journal::u64_wire::parse(&s)
            .map(Some)
            .ok_or_else(|| D::Error::custom(format!("not a canonical u64 decimal string: {s:?}")))
    }
}

/// The epoch a window armed; `epoch` is a decimal string on the wire.
/// `head` and `headHash` (`sha256-<hex>` of its text) let a window whose
/// buffer hashes the same start its first map on that revision; both are
/// read after arming, so a commit landing in between is reported, never
/// missed — the window compares the hash before it trusts the revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpochReply {
    pub doc: DocId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub epoch: u64,
    pub head: Option<RevisionId>,
    pub head_hash: Option<String>,
}

pub(crate) fn invalid(msg: &str) -> CommandError {
    CommandError::invalid_input(format!("INVALID_REQUEST: {msg}"))
        .with_detail(json!({ "journalCode": "INVALID_REQUEST" }))
}

pub(crate) fn decode<T: serde::de::DeserializeOwned>(payload: &str) -> Result<T, CommandError> {
    serde_json::from_str(payload).map_err(|e| invalid(&e.to_string()))
}

pub(crate) fn parse_txn(txn: &str) -> Result<TxnId, CommandError> {
    uuid::Uuid::parse_str(txn).map(TxnId).map_err(|_| {
        CommandError::invalid_input("INVALID_REQUEST: transaction id is not a UUID")
            .with_detail(json!({ "journalCode": "INVALID_REQUEST" }))
    })
}
