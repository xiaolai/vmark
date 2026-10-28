//! Selection edit certificates: a `selection.set` window's map from the
//! text it edited to the text it produced, so the writer can move older
//! hunks through the edit instead of blocking them all.
//!
//! A Source window knows its exact change before it applies, so its
//! certificate arrives with the prepare; it names no basis and is bound to
//! its preimage hash. Once the writer has minted the parent (a baseline
//! for unsaved text, else the head) the certificate must map that parent's
//! text: `bind_to_parent` checks the hash and length, the absence of a
//! whole break and that no changed run splits a character, then binds it
//! with basis = parent and the prepare persists it. A WYSIWYG window
//! certifies after the apply, so its certificate arrives with the commit.
//!
//! `check_commit_certificate` checks either one against the commit: basis
//! = parent, preimage and postimage hashes, the map reproduces the
//! postimage in O(n), the changed runs fall on character boundaries and
//! their hunks fit the free slots; a whole-text write's declared script
//! then gains its rotation breaks within the cap (`rotation`). It does
//! not apply the editing-epoch rule: a certificate is a consistency
//! check, never trusted input. The
//! writer derives one `change` hunk per maximal changed run; the window
//! never sends hunks.
//!
//! Admission split: a malformed certificate fails the request decode
//! (`INVALID_REQUEST`). A certificate that fails a check is not an error:
//! a prepare is admitted uncertified, a commit commits the applied text
//! with the barrier's effects. Either way `certified` is false, the reason
//! is returned, a warning is logged and `uncertified_fallbacks` counts it.

use serde::{Deserialize, Serialize};

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::projection::{Projection, TxnEntry};
use crate::agent_journal::provenance::{Certificate, ChangedRun, Provenance, ProvenancePayload};
use crate::agent_journal::review::{Hunk, HunkKind, Range, ReviewOp};
use crate::agent_journal::review_slots::new_hunks_fit;
use crate::agent_journal::text::{utf16_len, utf16_slices};
use crate::agent_journal::writer::{Inner, Writer};
use crate::agent_journal::writer_epoch::basis_of;
use rotation::{add_rotation_breaks, declares_script};

/// Why a certificate was not used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FallbackReason {
    /// It does not map the minted parent's text (or names another basis).
    NotTheParent,
    /// It does not map the preimage to the applied postimage.
    NotThePostimage,
    /// It holds a whole-document break: nothing is mapped.
    WholeBreak,
    /// A changed run starts or ends inside a surrogate pair.
    SplitsACharacter,
    /// Its hunks do not fit the document's free slots.
    NoFreeSlots,
    /// Its rotation breaks take the window over its entry cap.
    OverCap,
}

/// A prepare's certificate once the parent is minted.
pub(crate) enum Bound {
    Absent,
    Certified(Box<ProvenancePayload>),
    Fallback(FallbackReason),
}

impl Bound {
    /// The payload to persist, and why a sent certificate was not used.
    pub(crate) fn split(self) -> (Option<ProvenancePayload>, Option<FallbackReason>) {
        match self {
            Self::Absent => (None, None),
            Self::Certified(c) => (Some(*c), None),
            Self::Fallback(r) => (None, Some(r)),
        }
    }
}

/// A checked certificate's window and hunks, or why it falls back.
pub(crate) type Checked = Result<(Provenance, Vec<Hunk>), FallbackReason>;

/// What a commit's effects were derived from, as far as certificates go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Certification {
    Absent,
    Certified(Vec<Hunk>),
    Fallback(FallbackReason),
}

impl Certification {
    /// `(certified, fallbackReason)` as the answer reports them.
    pub(crate) fn outcome(&self) -> (bool, Option<FallbackReason>) {
        match self {
            Self::Absent => (false, None),
            Self::Certified(_) => (true, None),
            Self::Fallback(r) => (false, Some(*r)),
        }
    }
}

fn units(text: &str) -> Result<i64, TxnError> {
    i64::try_from(utf16_len(text)).map_err(|_| TxnError::InvalidRequest("text too long".into()))
}

fn range((start, end): (i64, i64)) -> Range {
    // Runs lie inside [0, len], which `units` bounded to i64.
    Range {
        start: start as u64,
        end: end as u64,
    }
}

fn epoch_of(p: &Projection, doc: DocId) -> String {
    let open = p.docs.get(&doc).and_then(|d| d.epoch.open);
    open.unwrap_or(0).to_string()
}

/// Bind a prepare's certificate to `parent`, the revision the writer just
/// minted (or the head), whose text is `preimage`.
pub(crate) fn bind_to_parent(
    p: &Projection,
    doc: DocId,
    parent: Option<RevisionId>,
    preimage: &str,
    certificate: Option<Certificate>,
) -> Result<Bound, TxnError> {
    let Some(c) = certificate else {
        return Ok(Bound::Absent);
    };
    let parent_hash = p.postimage_of(parent);
    let len_a = u64::try_from(units(preimage)?).unwrap_or(u64::MAX);
    if parent_hash.as_ref().map(BlobHash::digest_hex) != Some(c.pre_hash()) || c.len_a() != len_a {
        return Ok(Bound::Fallback(FallbackReason::NotTheParent));
    }
    let bound = c
        .bind(&doc.to_string(), &epoch_of(p, doc), &basis_of(parent))
        .map_err(TxnError::Invariant)?;
    let window = bound.accumulator().map_err(TxnError::Invariant)?;
    if window.whole_block().is_some() {
        return Ok(Bound::Fallback(FallbackReason::WholeBreak));
    }
    let bases: Vec<Range> = window.changed_runs().iter().map(|r| range(r.a)).collect();
    if utf16_slices(preimage, &bases).is_err() {
        return Ok(Bound::Fallback(FallbackReason::SplitsACharacter));
    }
    Ok(Bound::Certified(Box::new(bound)))
}

/// The certificate a commit is checked against: the one sent with the
/// commit (bound here), else the one the prepare persisted.
fn effective(
    p: &Projection,
    t: &TxnEntry,
    sent: Option<&Certificate>,
) -> Result<Option<ProvenancePayload>, TxnError> {
    match sent {
        Some(c) => c
            .clone()
            .bind(&t.doc.to_string(), &epoch_of(p, t.doc), &basis_of(t.parent))
            .map(Some)
            .map_err(TxnError::Invariant),
        None => Ok(t.certificate.clone()),
    }
}

/// Check the effective certificate of `t` against `preimage → postimage`:
/// `None` without one, else its window and writer-derived hunks, or why
/// it falls back to the barrier.
pub(crate) fn certify_commit(
    g: &Inner,
    t: &TxnEntry,
    preimage: &str,
    postimage: &str,
    sent: Option<&Certificate>,
) -> Result<Option<Checked>, TxnError> {
    match effective(&g.proj, t, sent)? {
        None => Ok(None),
        Some(c) => check_commit_certificate(g, t, preimage, postimage, &c).map(Some),
    }
}

/// See the module docs for the checks, in order.
pub(crate) fn check_commit_certificate(
    g: &Inner,
    t: &TxnEntry,
    preimage: &str,
    postimage: &str,
    c: &ProvenancePayload,
) -> Result<Checked, TxnError> {
    use FallbackReason::*;
    if c.basis() != basis_of(t.parent) {
        return Ok(Err(NotTheParent));
    }
    let Ok(mut window) = c.checked_accumulator(preimage, postimage) else {
        return Ok(Err(NotThePostimage));
    };
    if window.whole_block().is_some() {
        return Ok(Err(WholeBreak));
    }
    let runs = window.changed_runs();
    let Some(hunks) = hunks_of(t, preimage, postimage, &runs)? else {
        return Ok(Err(SplitsACharacter));
    };
    let non_settled = g.proj.docs.get(&t.doc).map_or(0, |d| d.non_settled());
    if !new_hunks_fit(&ReviewOp::Review, non_settled, &hunks) {
        return Ok(Err(NoFreeSlots));
    }
    if declares_script(&t.tool) {
        if let Err(r) = add_rotation_breaks(&mut window, preimage, postimage, &runs)? {
            return Ok(Err(r));
        }
    }
    Ok(Ok((window, hunks)))
}

/// One `change` hunk per run; `None` when a run splits a character.
fn hunks_of(
    t: &TxnEntry,
    preimage: &str,
    postimage: &str,
    runs: &[ChangedRun],
) -> Result<Option<Vec<Hunk>>, TxnError> {
    let bases: Vec<Range> = runs.iter().map(|r| range(r.a)).collect();
    let targets: Vec<Range> = runs.iter().map(|r| range(r.b)).collect();
    let (Ok(pre), Ok(post)) = (
        utf16_slices(preimage, &bases),
        utf16_slices(postimage, &targets),
    ) else {
        return Ok(None);
    };
    let mut hunks = Vec::with_capacity(runs.len());
    for (i, (b, a)) in pre.iter().zip(&post).enumerate() {
        let (base_text_hash, target_text_hash) = (BlobHash::of_text(b), BlobHash::of_text(a));
        let id = Hunk::compute_id(
            t.parent,
            t.revision,
            bases[i],
            targets[i],
            &base_text_hash,
            &target_text_hash,
        )
        .map_err(TxnError::Invariant)?;
        hunks.push(Hunk {
            id,
            kind: HunkKind::Change,
            base: t.parent,
            target: t.revision,
            base_range: bases[i],
            target_range: targets[i],
            base_text_hash,
            target_text_hash,
        });
    }
    Ok(Some(hunks))
}

/// Count and log one uncertified fallback.
pub(crate) fn note_fallback(g: &mut Inner, doc: DocId, reason: FallbackReason) {
    g.uncertified_fallbacks += 1;
    log::warn!("agent journal: certificate for {doc} not used ({reason:?}); recorded as a barrier");
}

impl Writer {
    /// Certificates that fell back to a barrier since the writer opened.
    #[cfg(test)]
    pub fn uncertified_fallbacks(&self) -> u64 {
        self.lock().uncertified_fallbacks
    }

    /// A commit's `(certified, fallbackReason)`, counting a fallback.
    pub(crate) fn report_certification(
        &self,
        doc: DocId,
        c: &Certification,
    ) -> (bool, Option<FallbackReason>) {
        let outcome = c.outcome();
        if let Some(r) = outcome.1 {
            note_fallback(&mut self.lock(), doc, r);
        }
        outcome
    }
}

#[path = "rotation.rs"]
mod rotation;

#[cfg(test)]
#[path = "certificate_fallback.test.rs"]
mod fallback_tests;
#[cfg(test)]
#[path = "certificate_parent.test.rs"]
mod parent_tests;
#[cfg(test)]
#[path = "certificate_remount.test.rs"]
mod remount_tests;
#[cfg(test)]
#[path = "certificate_support.test.rs"]
pub(crate) mod support;
