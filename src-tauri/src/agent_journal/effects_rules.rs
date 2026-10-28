//! Validation of worker-computed review effects for one revision record.
//! The worker sends spans and transitions; the writer
//! derives both from the record's provenance window (`span_map`) and
//! refuses any difference, so a span can only move through certified
//! provenance and no capture transition crosses a break.

use std::collections::BTreeSet;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, HunkId, RevisionId};
use crate::agent_journal::projection::DocState;
use crate::agent_journal::provenance::Provenance;
use crate::agent_journal::review::{HunkState, Range, ReviewEffects, ReviewOp};
use crate::agent_journal::review_rules::{
    capture_target, check_gen_ceiling, hunk_at, invalid, new_hunks_fit, GenClass,
};
use crate::agent_journal::span_map::{derive, DeriveCtx};
use crate::agent_journal::text::utf16_slices;

/// What a revision's effects are checked against.
pub struct EffectsCtx<'a> {
    pub doc: Option<&'a DocState>,
    pub op: &'a ReviewOp,
    pub revision: RevisionId,
    pub parent: Option<RevisionId>,
    /// Controlled mutations only: new hunks' base ranges are hashed here.
    pub preimage: Option<&'a str>,
    pub postimage: &'a str,
    /// The map from the parent's text to `postimage`.
    pub window: &'a Provenance,
    /// An applied `hunkRevert`: the hunk and its restored range.
    pub reverted: Option<(&'a HunkId, Range)>,
}

/// Admit a revision's effects: transitions first, then the new hunks, the
/// span coverage, the comparison with the derived mapping, and the hashes.
pub fn check_effects(c: &EffectsCtx<'_>, e: &ReviewEffects) -> Result<(), TxnError> {
    let empty = DocState::default();
    let d = c.doc.unwrap_or(&empty);
    check_transitions(c, d, e)?;
    check_new_hunks(c, d, e)?;
    check_span_coverage(d, e)?;
    check_derived(c, d, e)?;
    check_hashes(c, e)
}

/// Each transition names a distinct hunk this revision kind may move, at
/// its current generation, below the generation ceiling.
fn check_transitions(c: &EffectsCtx<'_>, d: &DocState, e: &ReviewEffects) -> Result<(), TxnError> {
    let mut seen = BTreeSet::new();
    for t in &e.transitions {
        if !seen.insert(&t.hunk_id) {
            return Err(invalid("duplicate transition"));
        }
        if capture_target(c.op, HunkState::Pending) != Some(t.to) {
            return Err(invalid("this revision kind cannot cause that transition"));
        }
        let h = hunk_at(Some(d), &t.hunk_id, t.expected_review_gen)?;
        if capture_target(c.op, h.state).is_none() {
            return Err(TxnError::stale(
                &t.hunk_id,
                format!("{:?} is already decided", h.state),
            ));
        }
        check_gen_ceiling(GenClass::Capture, h.review_gen, &t.hunk_id)?;
    }
    Ok(())
}

/// Exactly one span per hunk that was non-settled before this record.
fn check_span_coverage(d: &DocState, e: &ReviewEffects) -> Result<(), TxnError> {
    let live: BTreeSet<&HunkId> = d
        .hunks
        .iter()
        .filter(|(_, h)| h.state != HunkState::Settled)
        .map(|(id, _)| id)
        .collect();
    let mut spanned = BTreeSet::new();
    if !e.spans.iter().all(|s| spanned.insert(&s.hunk_id)) {
        return Err(invalid("duplicate span"));
    }
    if spanned != live {
        return Err(TxnError::StaleReview {
            hunk: None,
            detail: "spans must cover exactly the non-settled hunks".into(),
        });
    }
    Ok(())
}

/// The spans and transitions are the ones the provenance window derives,
/// and a revert edits no live hunk but its own.
fn check_derived(c: &EffectsCtx<'_>, d: &DocState, e: &ReviewEffects) -> Result<(), TxnError> {
    let ctx = DeriveCtx {
        doc: d,
        parent: c.parent,
        op: c.op,
        window: c.window,
        postimage: c.postimage,
        new_hunks: &e.new_hunks,
        reverted: c.reverted,
    };
    let derived = derive(&ctx).map_err(|e| TxnError::Invariant(format!("span mapping: {e}")))?;
    let mut spans = e.spans.clone();
    spans.sort_by(|a, b| a.hunk_id.cmp(&b.hunk_id));
    if let Some((got, want)) = spans.iter().zip(&derived.spans).find(|(g, w)| g != w) {
        return Err(TxnError::InvalidRequest(format!(
            "span of {} is not the provenance mapping: got {got:?}, derived {want:?}",
            got.hunk_id.0
        )));
    }
    let mut transitions = e.transitions.clone();
    transitions.sort_by(|a, b| a.hunk_id.cmp(&b.hunk_id));
    if transitions != derived.transitions {
        return Err(invalid(
            "capture transitions are not the ones the provenance implies",
        ));
    }
    if let Some((reverted, _)) = c.reverted {
        if derived.hit.iter().any(|h| h != reverted) {
            return Err(invalid("the revert edits another live hunk"));
        }
    }
    Ok(())
}

fn check_hashes(c: &EffectsCtx<'_>, e: &ReviewEffects) -> Result<(), TxnError> {
    let targets: Vec<Range> = e.new_hunks.iter().map(|h| h.target_range).collect();
    let texts = utf16_slices(c.postimage, &targets).map_err(TxnError::InvalidRequest)?;
    if e.new_hunks
        .iter()
        .zip(texts)
        .any(|(h, t)| BlobHash::of_text(t) != h.target_text_hash)
    {
        return Err(invalid(
            "hunk target text hash does not match the postimage",
        ));
    }
    if let Some(pre) = c.preimage {
        let bases: Vec<Range> = e.new_hunks.iter().map(|h| h.base_range).collect();
        let texts = utf16_slices(pre, &bases).map_err(TxnError::InvalidRequest)?;
        if e.new_hunks
            .iter()
            .zip(texts)
            .any(|(h, t)| BlobHash::of_text(t) != h.base_text_hash)
        {
            return Err(invalid("hunk base text hash does not match the preimage"));
        }
    }
    Ok(())
}

fn check_new_hunks(c: &EffectsCtx<'_>, d: &DocState, e: &ReviewEffects) -> Result<(), TxnError> {
    if !new_hunks_fit(c.op, d.non_settled(), &e.new_hunks) {
        return Err(invalid("new hunks do not fit the op or the free slots"));
    }
    let mut seen = BTreeSet::new();
    for h in &e.new_hunks {
        if !h.id_is_consistent() || h.target != c.revision || h.base != c.parent {
            return Err(invalid(
                "hunk id or base/target does not match this revision",
            ));
        }
        if d.hunks.contains_key(&h.id) || !seen.insert(&h.id) {
            return Err(invalid("duplicate hunk id"));
        }
    }
    Ok(())
}
