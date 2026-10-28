//! Both pairs of a concurrent observation on the `Controller`: a human save
//! whose observed predecessor was not the linear head ("edited in two
//! windows"). Attribution reads it as observed before-text → postimage;
//! review, revert and export read it as the parent's postimage →
//! postimage. The history panel shows both diffs from these three texts.
//!
//! Key decisions:
//!   - Read-only and additive: it changes no persisted byte and no other
//!     reply. A key the journal never saw is refused, not minted.
//!   - Only a concurrent revision of the named document answers; any other
//!     revision (an ordinary save, a controlled write, a tombstone a
//!     concurrent revision became once collected, another document's or an
//!     unknown one) is refused as invalid input, never answered with a
//!     pair that is not one.
//!   - Every text is always present: retention keeps a retained revision's
//!     postimage and both of its before-texts (`gc_plan::keep_set`), and a
//!     collected concurrent revision is a tombstone, which is refused. A
//!     text is read from the blob pack or, not durable yet, from the
//!     document's degraded queue; one in neither is `JOURNAL_CORRUPT`,
//!     never a silent gap (the same rule as `referenced_blob`).
//!
//! @module agent_journal/controller_concurrent_pair

use serde::{Deserialize, Serialize};

use crate::agent_journal::controller::{decode, invalid, Controller};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::projection::RevisionKind;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::writer::Inner;
use crate::agent_journal::writer_base::queued_text;
use crate::command_error::CommandError;

/// The three texts of a concurrent revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrentPair {
    /// What the saving window started from (the observed preimage).
    pub observed_before: String,
    /// The linear parent's postimage.
    pub linear_before: String,
    /// The revision's postimage.
    pub result: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PairRequest {
    doc_key: String,
    revision: RevisionId,
}

/// `hash`'s text, stored or still queued for `doc`.
///
/// # Errors
/// `Corrupt` when it is in neither: the revision references it.
fn text_of(g: &mut Inner, doc: DocId, hash: &BlobHash) -> Result<String, TxnError> {
    if g.blobs.readable(hash) {
        return g.blobs.get(hash);
    }
    queued_text(g, doc, hash).ok_or_else(|| {
        TxnError::Corrupt(format!(
            "blob {} is referenced but not stored",
            hash.as_str()
        ))
    })
}

impl Controller {
    /// Both pairs of a concurrent revision (`{docKey, revision}`); see the
    /// module docs.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a malformed payload or a revision that is not
    /// a concurrent revision of that document; `JOURNAL_CORRUPT` when one
    /// of its texts is missing or unreadable.
    pub fn concurrent_pair(&self, payload: &str) -> Result<ConcurrentPair, CommandError> {
        let req: PairRequest = decode(payload)?;
        let not_concurrent = || invalid("revision is not a concurrent revision of this document");
        let doc = self
            .docs
            .find(&req.doc_key)
            .map_err(|e| refusal(&e))?
            .ok_or_else(not_concurrent)?;
        let mut g = self.writer.lock();
        let meta = g
            .proj
            .revisions
            .get(&req.revision)
            .filter(|m| m.doc == doc && m.kind == RevisionKind::Concurrent)
            .ok_or_else(not_concurrent)?;
        let observed = meta.preimage.clone().ok_or_else(|| {
            refusal(&TxnError::Invariant(
                "a concurrent revision has no observed preimage".into(),
            ))
        })?;
        let parent = g.proj.postimage_of(meta.parent).ok_or_else(|| {
            refusal(&TxnError::Invariant(
                "a concurrent revision's parent is not in the projection".into(),
            ))
        })?;
        let postimage = meta.postimage.clone();
        let read = |g: &mut Inner, h: &BlobHash| text_of(g, doc, h).map_err(|e| refusal(&e));
        Ok(ConcurrentPair {
            observed_before: read(&mut g, &observed)?,
            linear_before: read(&mut g, &parent)?,
            result: read(&mut g, &postimage)?,
        })
    }
}

#[cfg(test)]
#[path = "controller_concurrent_pair.test.rs"]
mod tests;
