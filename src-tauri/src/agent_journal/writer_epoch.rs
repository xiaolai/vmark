//! Editing epochs and the provenance payload rules shared by commit
//! and capture.
//!
//! A window arms an epoch before its maps count: `arm_epoch` appends
//! `epochArmed`; `close_epoch` appends `epochClosed` once everything the
//! epoch saw was captured. An epoch still armed at the next `open` becomes
//! `epochUnclosed`, a barrier on every live hunk of the document.
//!
//! A worker-supplied payload must name: the document (`DocId`), the open
//! epoch (a payload with no armed epoch is refused), the
//! basis (parent revision id, an observed pending observation's id, or
//! `genesis`), and map exactly the preimage to the postimage. A payload the
//! writer builds itself names the open epoch, or `0` when none is open.

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::provenance::{
    BreakReason, Provenance, ProvenancePayload, PROVENANCE_CAP,
};
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::text::utf16_len;
use crate::agent_journal::writer::Writer;

/// The basis a payload built on `parent` names.
pub fn basis_of(parent: Option<RevisionId>) -> String {
    parent.map_or_else(|| "genesis".into(), |r| r.to_string())
}

/// The basis a capture built on `observed` names.
pub fn observed_basis(observed: &ObservedRef) -> String {
    match observed {
        ObservedRef::Revision { revision } | ObservedRef::Unjournaled { revision } => {
            revision.to_string()
        }
        ObservedRef::Pending { observation } => observation.to_string(),
        ObservedRef::Genesis => "genesis".into(),
    }
}

fn open_epoch(p: &Projection, doc: DocId) -> Option<u64> {
    p.docs.get(&doc).and_then(|d| d.epoch.open)
}

/// Refuse a worker payload that is not exactly `pre → post` of `doc` under
/// its open epoch and `basis`; on acceptance, the map it decoded to check.
pub(crate) fn check_payload(
    p: &Projection,
    doc: DocId,
    basis: &str,
    pre: &str,
    post: &str,
    payload: &ProvenancePayload,
) -> Result<Provenance, TxnError> {
    check_worker_payload(
        &doc.to_string(),
        open_epoch(p, doc),
        basis,
        pre,
        post,
        payload,
    )
}

/// The worker-map rule over plain values, in the order the shared
/// fixture's `workerPayloads` pin: document, armed epoch, basis, texts.
fn check_worker_payload(
    document: &str,
    open: Option<u64>,
    basis: &str,
    pre: &str,
    post: &str,
    payload: &ProvenancePayload,
) -> Result<Provenance, TxnError> {
    let bad = |what: String| TxnError::InvalidProvenance(format!("provenance: {what}"));
    if payload.document() != document {
        return Err(bad("names another document".into()));
    }
    match open {
        None => return Err(bad("no editing epoch is armed for this document".into())),
        Some(e) if e != payload.epoch() => {
            return Err(bad(format!(
                "epoch {} is not the armed epoch {e}",
                payload.epoch()
            )))
        }
        Some(_) => {}
    }
    if payload.basis() != basis {
        return Err(bad(format!("basis {:?} is not {basis:?}", payload.basis())));
    }
    payload.checked_accumulator(pre, post).map_err(bad)
}

/// Test-only: the worker-map rule without a projection, so the golden
/// `workerPayloads` vectors (placeholder ids) can be checked directly.
#[cfg(test)]
#[doc(hidden)]
pub fn debug_check_worker_payload(
    document: &str,
    open: Option<u64>,
    basis: &str,
    pre: &str,
    post: &str,
    payload: &ProvenancePayload,
) -> Result<(), TxnError> {
    check_worker_payload(document, open, basis, pre, post, payload).map(|_| ())
}

/// Wraps a window the writer itself derived (a revert, a barrier).
pub(crate) fn certified_payload(
    p: &Projection,
    doc: DocId,
    basis: &str,
    pre: &str,
    post: &str,
    window: &Provenance,
) -> Result<ProvenancePayload, TxnError> {
    let epoch = open_epoch(p, doc).unwrap_or(0).to_string();
    ProvenancePayload::encode(&doc.to_string(), &epoch, basis, pre, post, window)
        .map_err(TxnError::Invariant)
}

/// The window of an update with no certified map.
pub fn whole_window(
    pre: &str,
    post: &str,
    reason: BreakReason,
    origin: &str,
) -> Result<Provenance, TxnError> {
    let len = |s: &str| {
        i64::try_from(utf16_len(s)).map_err(|_| TxnError::InvalidRequest("text too long".into()))
    };
    let mut w = Provenance::new(len(pre)?, PROVENANCE_CAP).map_err(TxnError::Invariant)?;
    w.break_whole(len(post)?, reason, origin)
        .map_err(TxnError::Invariant)?;
    Ok(w)
}

impl Writer {
    /// Arm the next editing epoch of `doc`. Refused while one is open.
    pub fn arm_epoch(&self, doc: DocId) -> Result<u64, TxnError> {
        let mut g = self.lock();
        g.healthy()?;
        let e = g.proj.docs.get(&doc).map(|d| d.epoch).unwrap_or_default();
        if let Some(open) = e.open {
            return Err(TxnError::InvalidRequest(format!(
                "epoch {open} is still armed"
            )));
        }
        let epoch = e
            .last
            .checked_add(1)
            .ok_or_else(|| TxnError::Invariant("epoch overflow".into()))?;
        self.append(&mut g, TxnId::new(), Record::EpochArmed { doc, epoch }, &[])?;
        Ok(epoch)
    }

    /// Close `epoch` of `doc` (CAS on the open epoch).
    pub fn close_epoch(&self, doc: DocId, epoch: u64) -> Result<(), TxnError> {
        let mut g = self.lock();
        g.healthy()?;
        if open_epoch(&g.proj, doc) != Some(epoch) {
            return Err(TxnError::InvalidRequest(format!(
                "epoch {epoch} is not armed"
            )));
        }
        self.append(
            &mut g,
            TxnId::new(),
            Record::EpochClosed { doc, epoch },
            &[],
        )?;
        Ok(())
    }

    /// The armed epoch of `doc`, if any. A test seam.
    #[cfg(test)]
    pub fn epoch(&self, doc: DocId) -> Option<u64> {
        open_epoch(&self.lock().proj, doc)
    }
}
