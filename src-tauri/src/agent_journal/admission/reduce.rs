//! The checks `Projection::apply` runs on a receipt or an `admission`
//! before anything reduces, so a refusal leaves the projection as it was.
//! The reduction itself is `apply` on each item in order — one path for
//! staging, replay and hydration — and the receipt is indexed by `apply`
//! for whichever envelope carries it.
//!
//! A revert decision's receipt reports the hunk's `reviewGen` after the
//! decision; `check_decided_gen` holds it to the hunk's live one plus one,
//! checked by `apply` just before the record reduces (an admission's
//! earlier items may move it).
//!
//! An item that fails inside its own reducer after earlier items applied
//! leaves those applied: on replay that is a corrupt journal (the writer
//! stays off), and the writer stages on a clone it then drops.
//!
//! @module agent_journal/admission/reduce

use crate::agent_journal::admission::receipt::Outcome;
use crate::agent_journal::admission::{receipt, shape};
use crate::agent_journal::comment::binding;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::{Envelope, Record};

/// Static binding (receipts, comment records), frame shape, request-id uniqueness and the document of
/// every linearization, all against `proj` as it stands.
pub(crate) fn preflight(proj: &Projection, env: &Envelope) -> Result<(), TxnError> {
    receipt::check_binding(env)?;
    binding::check(env)?;
    shape::check(env)?;
    check_unindexed(proj, env)?;
    let Record::Admission { items } = &env.record else {
        return Ok(());
    };
    let mut doc: Option<DocId> = None;
    for (i, item) in items.iter().enumerate() {
        receipt::check_binding(item)?;
        binding::check(item)?;
        check_unindexed(proj, item)?;
        let named = match &item.record {
            Record::PendingObservation { doc, .. }
            | Record::Prepared { doc, .. }
            | Record::ReviewDecision { doc, .. } => *doc,
            Record::CommentCreated(c) => c.doc,
            _ => linearized_doc(proj, &items[..i], item)?,
        };
        if doc.is_some_and(|d| d != named) {
            return Err(corrupt(env, "names more than one document"));
        }
        doc = Some(named);
    }
    Ok(())
}

/// A decision receipt's `reviewGen` is its hunk's in `proj` plus one.
pub(crate) fn check_decided_gen(proj: &Projection, env: &Envelope) -> Result<(), TxnError> {
    let Some(Outcome::Decision(d)) = env.receipt.as_ref().map(|r| &r.outcome) else {
        return Ok(());
    };
    let live = proj
        .docs
        .get(&d.doc)
        .and_then(|doc| doc.hunks.get(&d.hunk))
        .and_then(|h| h.review_gen.checked_add(1));
    if live != Some(d.review_gen) {
        return Err(TxnError::Corrupt(format!(
            "seq {}: the receipt reports reviewGen {} for {}",
            env.seq, d.review_gen, d.hunk.0
        )));
    }
    Ok(())
}

fn check_unindexed(proj: &Projection, env: &Envelope) -> Result<(), TxnError> {
    match &env.receipt {
        Some(r) if proj.requests.contains_key(&r.request_id) => Err(TxnError::Corrupt(format!(
            "seq {}: request {} already has a receipt",
            env.seq, r.request_id
        ))),
        _ => Ok(()),
    }
}

/// The document whose observation a linearization item names: an earlier
/// item of the same frame, else one already projected.
fn linearized_doc(
    proj: &Projection,
    earlier: &[Envelope],
    item: &Envelope,
) -> Result<DocId, TxnError> {
    let in_frame = earlier.iter().find_map(|e| match &e.record {
        Record::PendingObservation { doc, .. } if e.txn == item.txn => Some(*doc),
        _ => None,
    });
    in_frame
        .or_else(|| proj.observations.get(&item.txn).map(|o| o.doc))
        .ok_or_else(|| corrupt(item, "linearizes an observation it does not carry"))
}

fn corrupt(env: &Envelope, why: &str) -> TxnError {
    TxnError::Corrupt(format!("seq {}: admission {why}", env.seq))
}
