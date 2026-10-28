//! The writer's half of a surgical revert: the gate before
//! anything is reserved, then the exact revert of the head text with its
//! single-change provenance and the spans every other hunk maps to.
//!
//! The hunk's base and target texts are re-read from its pinned target
//! revision and checked against the hunk's hashes. The change it computes
//! is the only map a `hunkRevert` commit may carry: the worker sends no
//! payload, and its postimage and spans must equal these.

use crate::agent_journal::admission::blobs::BlobRead;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId};
use crate::agent_journal::projection::{DocState, HunkEntry, Projection};
use crate::agent_journal::provenance::{Provenance, Section, PROVENANCE_CAP};
use crate::agent_journal::revert_gate::{decide, gate, RevertDecision};
use crate::agent_journal::review::{Hunk, HunkState, Range, ReviewEffects, ReviewOp};
use crate::agent_journal::span_map::{derive, DeriveCtx};
use crate::agent_journal::text::{utf16_len, utf16_slices};
use crate::agent_journal::writer::Writer;

/// What reverting a hunk of the head text would do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevertPlan {
    pub decision: RevertDecision,
    /// For `Apply`: the spans of every non-settled hunk after the revert.
    pub effects: ReviewEffects,
    pub(crate) window: Option<(Provenance, Range)>,
}

/// The text of a blob the journal references. The writer stores a blob
/// before the record that names it, and the empty (genesis) text needs no
/// blob, so an absent one is corruption, never a client's bad request.
pub(crate) fn referenced_blob(
    blobs: &mut dyn BlobRead,
    hash: &BlobHash,
) -> Result<String, TxnError> {
    if *hash == BlobHash::of_text("") {
        return Ok(String::new());
    }
    if !blobs.readable(hash) {
        return Err(TxnError::Corrupt(format!(
            "blob {} is referenced but not stored",
            hash.as_str()
        )));
    }
    blobs.get(hash)
}

/// The hunk's base and target texts, re-read from its pinned target
/// revision and checked against its hashes. `Err` names what is broken.
fn hunk_texts(
    p: &Projection,
    blobs: &mut dyn BlobRead,
    h: &Hunk,
    broken: &dyn Fn(&str) -> TxnError,
) -> Result<(String, String), TxnError> {
    let m = p
        .revisions
        .get(&h.target)
        .filter(|m| !m.collected)
        .ok_or_else(|| broken("target revision is gone"))?;
    let before = m
        .preimage
        .clone()
        .or_else(|| p.postimage_of(m.parent))
        .ok_or_else(|| broken("no before-text"))?;
    let (pre, post) = (
        referenced_blob(blobs, &before)?,
        referenced_blob(blobs, &m.postimage)?,
    );
    let base = utf16_slices(&pre, &[h.base_range]).map_err(|e| broken(&e))?[0];
    let target = utf16_slices(&post, &[h.target_range]).map_err(|e| broken(&e))?[0];
    if BlobHash::of_text(base) != h.base_text_hash
        || BlobHash::of_text(target) != h.target_text_hash
    {
        return Err(broken("stored texts do not match the hunk hashes"));
    }
    Ok((base.to_owned(), target.to_owned()))
}

/// The single-change map of a revert: `from..to` of `current` becomes
/// `from..restored.end`.
fn revert_window(current: &str, from: u64, to: u64, restored: Range) -> Result<Provenance, String> {
    let i64_of = |v: u64| i64::try_from(v).map_err(|_| "offset out of range".to_string());
    let mut window = Provenance::new(i64_of(utf16_len(current))?, PROVENANCE_CAP)?;
    window.compose(&[Section {
        from_a: i64_of(from)?,
        to_a: i64_of(to)?,
        from_b: i64_of(from)?,
        to_b: i64_of(restored.end)?,
    }])?;
    Ok(window)
}

/// Gate, then decide against `current` (the head text), then derive the
/// spans an applied revert leaves.
pub(crate) fn plan(
    p: &Projection,
    blobs: &mut dyn BlobRead,
    doc: DocId,
    id: &HunkId,
    current: &str,
) -> Result<RevertPlan, TxnError> {
    let broken = |what: &str| TxnError::Invariant(format!("revert of {}: {what}", id.0));
    let empty = DocState::default();
    let d = p.docs.get(&doc).unwrap_or(&empty);
    let h = gated_hunk(d, id)?;
    let decision = decide_live(p, blobs, h, current, &broken)?;
    let RevertDecision::Apply {
        from,
        to,
        restored,
        postimage,
    } = &decision
    else {
        return Ok(RevertPlan {
            decision,
            effects: ReviewEffects::default(),
            window: None,
        });
    };
    let restored = *restored;
    let window = revert_window(current, *from, *to, restored).map_err(|e| broken(&e))?;
    match revert_effects(d, id, h, &window, postimage, restored, &broken)? {
        Some(effects) => Ok(RevertPlan {
            decision,
            effects,
            window: Some((window, restored)),
        }),
        None => Ok(RevertPlan {
            decision: RevertDecision::Conflicted,
            effects: ReviewEffects::default(),
            window: None,
        }),
    }
}

/// The hunk `id` of `d`, once the gate lets a revert of it through.
fn gated_hunk<'d>(d: &'d DocState, id: &HunkId) -> Result<&'d HunkEntry, TxnError> {
    gate(d, id)?;
    d.hunks
        .get(id)
        .ok_or_else(|| TxnError::stale(id, "unknown hunk"))
}

/// The decision against `current`, from the hunk's texts in their live
/// direction (a reverted hunk re-applies its target).
fn decide_live(
    p: &Projection,
    blobs: &mut dyn BlobRead,
    h: &HunkEntry,
    current: &str,
    broken: &dyn Fn(&str) -> TxnError,
) -> Result<RevertDecision, TxnError> {
    let (base, target) = hunk_texts(p, blobs, &h.hunk, broken)?;
    let (live_base, live_target) = if h.state == HunkState::Reverted {
        (&target, &base)
    } else {
        (&base, &target)
    };
    decide(&h.span, live_base, live_target, current).map_err(|e| broken(&e))
}

/// The spans of every non-settled hunk after an applied revert; `None`
/// when the revert would edit any other live hunk, which makes it
/// conflicted.
fn revert_effects(
    d: &DocState,
    id: &HunkId,
    h: &HunkEntry,
    window: &Provenance,
    postimage: &str,
    restored: Range,
    broken: &dyn Fn(&str) -> TxnError,
) -> Result<Option<ReviewEffects>, TxnError> {
    let op = ReviewOp::HunkRevert {
        hunk_id: id.clone(),
        expected_review_gen: h.review_gen,
    };
    let ctx = DeriveCtx {
        doc: d,
        parent: d.head,
        op: &op,
        window,
        postimage,
        new_hunks: &[],
        reverted: Some((id, restored)),
    };
    let derived = derive(&ctx).map_err(|e| broken(&e))?;
    if derived.hit.iter().any(|o| o != id) {
        return Ok(None);
    }
    Ok(Some(ReviewEffects {
        spans: derived.spans,
        ..Default::default()
    }))
}

impl Writer {
    /// What a revert of `hunk` would do to the head text, or why it is
    /// refused (`AMBIGUOUS_REVERT` for a blocked span). Appends nothing.
    #[cfg(test)]
    pub fn plan_revert(&self, doc: DocId, hunk: &HunkId) -> Result<RevertPlan, TxnError> {
        let mut g = self.lock();
        let head = g
            .proj
            .postimage_of(g.proj.head(doc))
            .ok_or_else(|| TxnError::Invariant("head text".into()))?;
        let current = referenced_blob(&mut g.blobs, &head)?;
        let inner = &mut *g;
        plan(&inner.proj, &mut inner.blobs, doc, hunk, &current)
    }
}

#[cfg(test)]
#[path = "blob_integrity.test.rs"]
mod blob_tests;
