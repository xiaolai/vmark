//! The predecessor a prepare's baseline is recorded on (R32): the
//! observed parent the window froze its buffer on, resolved against the
//! staged projection, never the head relabelled. A baseline map must
//! name it; a snapshot that names none is recorded on the head, a whole
//! barrier either way.
//!
//! @module agent_journal/admission/observed_base

use crate::agent_journal::controlled::Prep;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::ObservedRef;

/// The baseline's observed parent and that parent's text hash.
pub(crate) fn observed_base(
    p: &Projection,
    doc: DocId,
    head: Option<RevisionId>,
    prep: &Prep,
) -> Result<(ObservedRef, BlobHash), TxnError> {
    match &prep.observed_parent {
        Some(base) => Ok((base.clone(), staged_base(p, doc, base)?)),
        None if prep.baseline_provenance.is_some() => Err(TxnError::InvalidRequest(
            "a baseline map needs the observed parent it was built on".into(),
        )),
        None => match head {
            Some(revision) => Ok((
                ObservedRef::Revision { revision },
                p.postimage_of(head)
                    .ok_or_else(|| TxnError::Invariant("head has no text".into()))?,
            )),
            None => Ok((ObservedRef::Genesis, BlobHash::of_text(""))),
        },
    }
}

/// The text hash of `base`, a predecessor the window froze: a live
/// revision or an observation of `doc` in the staged projection, or
/// genesis. A queued (unjournaled) base never reaches a prepare, which
/// is refused while the document is degraded.
fn staged_base(p: &Projection, doc: DocId, base: &ObservedRef) -> Result<BlobHash, TxnError> {
    let found = match base {
        ObservedRef::Revision { revision } => p
            .revisions
            .get(revision)
            .filter(|m| m.doc == doc && !m.collected)
            .map(|m| m.postimage.clone()),
        ObservedRef::Pending { observation } => p
            .observations
            .get(observation)
            .filter(|o| o.doc == doc)
            .map(|o| o.postimage.clone()),
        ObservedRef::Genesis => Some(BlobHash::of_text("")),
        ObservedRef::Unjournaled { .. } => None,
    };
    found.ok_or_else(|| {
        TxnError::InvalidRequest("observed parent is unknown for this document".into())
    })
}
