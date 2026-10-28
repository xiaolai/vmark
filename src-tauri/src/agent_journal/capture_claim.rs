//! The elision of a save that claims its revision (`claimsRevision`):
//! verified, seq-checked and its window's base moved in one critical
//! section of the writer lock. See `capture` for when a claim holds.
//!
//! @module agent_journal/capture_claim

use super::{reply, CaptureReply, CaptureRequest, JournaledFlag};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::writer::{Inner, Writer};
use crate::agent_journal::writer_pins::set_window_base;

/// A verified `claimsRevision`: under the verifying lock its capture seq is
/// checked and recorded (`capture_seq`) and the base moves to the head.
pub(super) fn elide_claimed(
    w: &Writer,
    doc: DocId,
    req: &CaptureRequest,
) -> Result<Option<CaptureReply>, TxnError> {
    let Some(claimed) = req.claims_revision else {
        return Ok(None);
    };
    let mut g = w.lock();
    let Some(head) = settled_head_holding(&g, doc, claimed, &req.postimage) else {
        return Ok(None);
    };
    if let Some(id) = &req.capture {
        g.capture_seqs.check(id)?;
        g.capture_seqs.record(id);
    }
    let base = ObservedRef::Revision { revision: head };
    set_window_base(&mut g, &req.window, doc, base);
    Ok(Some(reply(doc, JournaledFlag::Yes, None, Some(head))))
}

/// `claimed` when it is the head of `doc`, holds exactly `text`, and
/// nothing is pending or queued ahead of it.
fn settled_head_holding(
    g: &Inner,
    doc: DocId,
    claimed: RevisionId,
    text: &str,
) -> Option<RevisionId> {
    let state = g.proj.docs.get(&doc)?;
    if !state.pending.is_empty() || g.degraded.get(&doc).is_some_and(|q| !q.is_empty()) {
        return None;
    }
    let head = state.head.filter(|h| *h == claimed)?;
    (g.proj.postimage_of(Some(head)) == Some(BlobHash::of_text(text))).then_some(head)
}
