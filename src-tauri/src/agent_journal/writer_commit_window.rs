//! Which map a commit's effects are derived from: a `hunkRevert`'s own
//! exact change (`writer_revert`), a selection edit's certificate once
//! checked (`certificate`; a failed one falls back to the barrier), a
//! writer-built whole-document barrier
//! (`wholeDocumentWrite` for `review`, `snapshotOnly` for `none`, `restore`
//! for a restore), or the worker's payload once `check_payload` accepts it.
//! Split from `writer_txn` to keep each file readable.
//!
//! @module agent_journal/writer_commit_window

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::HunkId;
use crate::agent_journal::projection::TxnEntry;
use crate::agent_journal::provenance::{BreakReason, Certificate, Provenance};
use crate::agent_journal::revert_gate::RevertDecision;
use crate::agent_journal::review::{Range, ReviewEffects, ReviewOp};
use crate::agent_journal::writer::certificate::{certify_commit, Certification};
use crate::agent_journal::writer::{CommitRequest, Inner, Writer};
use crate::agent_journal::writer_epoch::{basis_of, check_payload, whole_window};
use crate::agent_journal::writer_revert::plan;

/// The hunk a `hunkRevert` reverts, the range it restores, and the effects
/// its plan derived (the only effects such a commit may carry).
pub(super) type Reverted = (HunkId, Range, ReviewEffects);

/// A commit window, the revert it applies, and its certification.
type Window = (Provenance, Option<Reverted>, Certification);

impl Writer {
    /// The map a commit's effects are derived from: the revert's own
    /// change, a selection edit's certificate (`sent`, else the prepared
    /// one) once checked, a writer-built barrier, or the worker's payload.
    pub(super) fn commit_window(
        &self,
        g: &mut Inner,
        t: &TxnEntry,
        preimage: &str,
        req: &CommitRequest,
        sent: Option<&Certificate>,
    ) -> Result<Window, TxnError> {
        let Some(payload) = &req.provenance else {
            return writer_built(g, t, preimage, req, sent);
        };
        if sent.is_some() {
            return refuse(CERTIFICATE_ONLY_FOR_REVIEW);
        }
        match t.review_op {
            ReviewOp::HunkRevert { .. } | ReviewOp::Restore { .. } => {
                refuse("a hunkRevert or restore carries no worker provenance")
            }
            ReviewOp::Review | ReviewOp::None => {
                let basis = basis_of(t.parent);
                let window =
                    check_payload(&g.proj, t.doc, &basis, preimage, &req.postimage, payload)?;
                Ok(plain(window))
            }
        }
    }
}

const CERTIFICATE_ONLY_FOR_REVIEW: &str = "a certificate is for a review write without provenance";

fn refuse<T>(what: &str) -> Result<T, TxnError> {
    Err(TxnError::InvalidRequest(what.into()))
}

fn plain(w: Provenance) -> Window {
    (w, None, Certification::Absent)
}

/// A commit with no worker provenance: the writer builds its window.
fn writer_built(
    g: &mut Inner,
    t: &TxnEntry,
    preimage: &str,
    req: &CommitRequest,
    sent: Option<&Certificate>,
) -> Result<Window, TxnError> {
    let barrier = |reason, origin| whole_window(preimage, &req.postimage, reason, origin);
    match &t.review_op {
        ReviewOp::Review => certified(g, t, preimage, req, sent),
        _ if sent.is_some() => refuse(CERTIFICATE_ONLY_FOR_REVIEW),
        ReviewOp::HunkRevert { hunk_id, .. } => reverted(g, t, hunk_id, preimage, req),
        ReviewOp::Restore { .. } => Ok(plain(barrier(BreakReason::Restore, "restore")?)),
        ReviewOp::None => Ok(plain(barrier(BreakReason::SnapshotOnly, "snapshot")?)),
    }
}

/// A review write: its certificate's window once checked, else the
/// `wholeDocumentWrite` barrier (a failed certificate is a counted fallback).
fn certified(
    g: &mut Inner,
    t: &TxnEntry,
    preimage: &str,
    req: &CommitRequest,
    sent: Option<&Certificate>,
) -> Result<Window, TxnError> {
    let agent = || {
        whole_window(
            preimage,
            &req.postimage,
            BreakReason::WholeDocumentWrite,
            "agent",
        )
    };
    Ok(
        match certify_commit(g, t, preimage, &req.postimage, sent)? {
            None => plain(agent()?),
            Some(Ok((w, hunks))) => (w, None, Certification::Certified(hunks)),
            Some(Err(r)) => (agent()?, None, Certification::Fallback(r)),
        },
    )
}

/// A `hunkRevert`: the exact change its plan derives, only when the
/// postimage is that revert.
fn reverted(
    g: &mut Inner,
    t: &TxnEntry,
    hunk_id: &HunkId,
    preimage: &str,
    req: &CommitRequest,
) -> Result<Window, TxnError> {
    let inner = &mut *g;
    let p = plan(&inner.proj, &mut inner.blobs, t.doc, hunk_id, preimage)?;
    match (p.decision, p.window) {
        (RevertDecision::Apply { postimage, .. }, Some((w, r))) if postimage == req.postimage => {
            Ok((
                w,
                Some((hunk_id.clone(), r, p.effects)),
                Certification::Absent,
            ))
        }
        _ => refuse("the postimage is not the revert of the hunk"),
    }
}

#[cfg(test)]
#[path = "commit_window.test.rs"]
mod tests;
