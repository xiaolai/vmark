//! The observed base of a capture: canonicalizing the observed parent a
//! window names (a revision, a commit or capture still queued, genesis) and
//! finding its text, which may live only in the degraded queue until the
//! drainer lands it.

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::writer::Inner;

/// Postimage hash of a commit still waiting in the document's queue.
fn queued_commit(g: &Inner, doc: DocId, rev: RevisionId) -> Option<BlobHash> {
    g.degraded.get(&doc)?.iter().find_map(|q| match &q.record {
        Record::Committed { postimage, .. }
            if g.proj.txns.get(&q.txn).is_some_and(|t| t.revision == rev) =>
        {
            Some(postimage.clone())
        }
        _ => None,
    })
}

fn queued_observation(g: &Inner, doc: DocId, obs: TxnId) -> Option<BlobHash> {
    g.degraded.get(&doc)?.iter().find_map(|q| match &q.record {
        Record::PendingObservation { postimage, .. } if q.txn == obs => Some(postimage.clone()),
        _ => None,
    })
}

/// Text for `hash` that is not durable yet: genesis, or a blob carried by
/// an entry in `doc`'s degraded queue.
pub(crate) fn queued_text(g: &Inner, doc: DocId, hash: &BlobHash) -> Option<String> {
    if *hash == BlobHash::of_text("") {
        return Some(String::new());
    }
    g.degraded
        .get(&doc)?
        .iter()
        .flat_map(|q| &q.blobs)
        .find(|(h, _)| h == hash)
        .map(|(_, t)| t.clone())
}

/// Canonicalize the observed parent and derive the observed preimage.
pub(crate) fn resolve_base(
    g: &Inner,
    doc: DocId,
    base: ObservedRef,
) -> Result<(ObservedRef, BlobHash), TxnError> {
    let journaled = |r: RevisionId| {
        g.proj
            .revisions
            .get(&r)
            // A collected revision is a tombstone: its text may survive as a
            // successor's before-text, but it is no base to build on.
            .filter(|m| m.doc == doc && !m.collected)
            .map(|m| m.postimage.clone())
    };
    let found = match base {
        ObservedRef::Revision { revision } | ObservedRef::Unjournaled { revision } => {
            match (queued_commit(g, doc, revision), journaled(revision)) {
                (Some(h), _) => Some((ObservedRef::Unjournaled { revision }, h)),
                (None, Some(h)) => Some((ObservedRef::Revision { revision }, h)),
                (None, None) => None,
            }
        }
        ObservedRef::Pending { observation } => g
            .proj
            .observations
            .get(&observation)
            .filter(|o| o.doc == doc)
            .map(|o| o.postimage.clone())
            .or_else(|| queued_observation(g, doc, observation))
            .map(|h| (ObservedRef::Pending { observation }, h)),
        ObservedRef::Genesis => Some((ObservedRef::Genesis, BlobHash::of_text(""))),
    };
    found.ok_or_else(|| {
        TxnError::InvalidRequest("observed parent is unknown for this document".into())
    })
}
