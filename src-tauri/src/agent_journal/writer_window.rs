//! The window a pending observation is linearized through: its frozen
//! map when it was built on the head, else a whole-document barrier
//! (`snapshotOnly` for a save with no map, `parentMismatch` for a
//! concurrent observation or a gap). Split from `writer_observe`.
//!
//! @module agent_journal/writer_window

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::projection::{Projection, RevisionKind};
#[cfg(test)]
use crate::agent_journal::provenance::ProvenancePayload;
use crate::agent_journal::provenance::{BreakReason, Provenance};
use crate::agent_journal::record::ObservedRef;
#[cfg(test)]
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_epoch::whole_window;
#[cfg(test)]
use crate::agent_journal::writer_epoch::{certified_payload, observed_basis};
#[cfg(test)]
use crate::agent_journal::writer_revert::referenced_blob;

/// Whether pending observation `obs` of `doc` was built on the head (a
/// base whose observation GC dropped is not known to be).
fn on_head(
    p: &Projection,
    doc: DocId,
    obs: &crate::agent_journal::projection::ObservationEntry,
) -> bool {
    p.base_on_head(&obs.observed_parent, p.head(doc)) == Some(true)
}

/// The window linearizing pending observation `observation` maps live
/// spans through, and the revision kind it becomes. `head` / `post` are the
/// head's text and the observation's postimage.
pub fn linearization_window(
    p: &Projection,
    doc: DocId,
    observation: TxnId,
    head: &str,
    post: &str,
) -> Result<(Provenance, RevisionKind), TxnError> {
    let obs = p
        .observations
        .get(&observation)
        .filter(|o| o.doc == doc && o.linearized.is_none())
        .ok_or_else(|| {
            TxnError::InvalidRequest("not a pending observation of this document".into())
        })?;
    if on_head(p, doc, obs) {
        let w = match &obs.provenance {
            Some(payload) => payload.accumulator().map_err(TxnError::Invariant)?,
            None => whole_window(head, post, BreakReason::SnapshotOnly, "snapshot")?,
        };
        return Ok((w, RevisionKind::Observed));
    }
    let (kind, origin) = match obs.observed_parent {
        ObservedRef::Unjournaled { .. } => (RevisionKind::Gap, "gap"),
        _ => (RevisionKind::Concurrent, "concurrentObservation"),
    };
    Ok((
        whole_window(head, post, BreakReason::ParentMismatch, origin)?,
        kind,
    ))
}

#[cfg(test)]
impl Writer {
    /// Test-only: the payload the writer certifies for the oldest
    /// pending observation of `doc`, which must be built on the head — its
    /// linearization window (a whole `snapshotOnly` break when it carries no
    /// map), the open epoch (`0` when none is armed) and the basis the
    /// capture names (a revision, a pending observation, or `genesis`).
    /// Composed of the functions linearization and commit use; appends
    /// nothing. The golden `writer-none-no-map` vector is checked through it.
    #[cfg(test)]
    #[doc(hidden)]
    pub fn debug_capture_payload(&self, doc: DocId) -> Result<ProvenancePayload, TxnError> {
        let mut g = self.lock();
        let none = || TxnError::InvalidRequest("no pending observation built on the head".into());
        let id = *g
            .proj
            .docs
            .get(&doc)
            .and_then(|d| d.pending.first())
            .ok_or_else(none)?;
        let obs = g.proj.observations[&id].clone();
        if !on_head(&g.proj, doc, &obs) {
            return Err(none());
        }
        let head = g.proj.head(doc);
        let head_hash = g
            .proj
            .postimage_of(head)
            .ok_or_else(|| TxnError::Invariant("head has no text".into()))?;
        let head_text = if head.is_none() {
            String::new()
        } else {
            referenced_blob(&mut g.blobs, &head_hash)?
        };
        let post = referenced_blob(&mut g.blobs, &obs.postimage)?;
        let (window, _) = linearization_window(&g.proj, doc, id, &head_text, &post)?;
        certified_payload(
            &g.proj,
            doc,
            &observed_basis(&obs.observed_parent),
            &head_text,
            &post,
            &window,
        )
    }
}
