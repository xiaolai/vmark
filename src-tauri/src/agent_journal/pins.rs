//! Pin projection: which revisions and blobs GC must keep, and
//! why. Computed from the projection plus the writer's in-memory roots
//! (live window bases, external roots, the degraded queue).
//!
//! A live hunk blocked after it was created pins the revision that blocked
//! it (`barrier`), and an unlinearized observation pins its observed parent
//! (`captureBase`): the panel explains a block by its barrier, and a
//! pending capture linearizes onto its base.
//!
//! A live blocked hunk also pins its `lastCertified.at` revision: the panel
//! draws the blocked hunk there (historical placement), so that text
//! must stay readable for as long as the hunk is live.
//!
//! A pinned revision keeps its postimage and both of its before-texts:
//! the attributed one (`preimage`, which differs from the parent's text for
//! concurrent observations and gaps) and the linear one (the parent's
//! postimage). Export writes a collected run as one synthetic commit whose
//! tree is the next retained revision's before-text, so that text must
//! outlive its own revision. Only blob hashes are kept, never the parent
//! revision: nothing pins an ancestor chain, and identical texts share one
//! blob.
//!
//! An `open`, `addressed` or `reopened` comment pins its creation revision
//! (ADR-AL13); a resolved one does not, so its creation text may be
//! collected and a reopen then resolves against the head with no hint.

use std::collections::{BTreeMap, BTreeSet};

use crate::agent_journal::comment::ids::{CommentId, ThreadState};
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::projection::{Projection, TxnStatus};
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::review::HunkState;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum PinReason {
    Head,
    HunkBase(HunkId),
    HunkTarget(HunkId),
    /// Only the latest `hunkRevert` attached to a non-settled hunk.
    LatestRevert(HunkId),
    /// A live blocked hunk's `lastCertified.at`: the revision its historical
    /// highlight is drawn in, so its text must outlive GC.
    LastCertified(HunkId),
    /// The barrier revision that blocked a live hunk (its sticky block's
    /// cause), so the break stays on record while the hunk can be reviewed.
    Barrier(HunkId),
    /// The `observedParent` of an unlinearized `pendingObservation`: the
    /// capture's base, which its linearization and export still name.
    CaptureBase,
    /// The creation revision of an undeleted `open`, `addressed` or
    /// `reopened` comment.
    Comment(CommentId),
    /// A window's live editor base; in memory only, gone at restart.
    WindowBase(String),
    External,
}

impl PinReason {
    /// The reason's wire name, for warnings that say what pins a cap.
    pub fn name(&self) -> &'static str {
        match self {
            PinReason::Head => "head",
            PinReason::HunkBase(_) => "hunkBase",
            PinReason::HunkTarget(_) => "hunkTarget",
            PinReason::LatestRevert(_) => "latestRevert",
            PinReason::LastCertified(_) => "lastCertified",
            PinReason::Barrier(_) => "barrier",
            PinReason::CaptureBase => "captureBase",
            PinReason::Comment(_) => "comment",
            PinReason::WindowBase(_) => "windowBase",
            PinReason::External => "external",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PinSet {
    pub revisions: BTreeMap<RevisionId, Vec<PinReason>>,
    pub blobs: BTreeSet<BlobHash>,
    /// Unresolved transactions (`prepared`, `uncommitted`).
    pub txns: BTreeSet<TxnId>,
}

impl PinSet {
    /// True when `txn` is held unresolved. A test seam: production reads
    /// `txns` directly.
    #[cfg(test)]
    pub fn reasons_for_txn(&self, txn: TxnId) -> bool {
        self.txns.contains(&txn)
    }

    fn pin(&mut self, rev: RevisionId, why: PinReason) {
        self.revisions.entry(rev).or_default().push(why);
    }
}

/// In-memory roots owned by the writer.
pub struct Roots<'a> {
    pub window_bases: &'a BTreeMap<String, (DocId, ObservedRef)>,
    pub external: &'a BTreeSet<RevisionId>,
    pub queued_blobs: Vec<BlobHash>,
}

/// Every root, then the blobs the pinned revisions need.
pub fn compute(p: &Projection, roots: Roots<'_>) -> PinSet {
    let mut s = PinSet::default();
    pin_heads_and_live_hunks(p, &mut s);
    pin_pending_observations(p, &mut s);
    pin_unresolved_comments(p, &mut s);
    pin_writer_roots(p, &roots, &mut s);
    expand_revision_blobs(p, &mut s);
    pin_unresolved_txns(p, &mut s);
    for l in p.legacy.values() {
        s.blobs.insert(l.preimage.clone());
        s.blobs.extend(l.postimage.clone());
    }
    s.blobs.extend(roots.queued_blobs);
    s
}

/// Each document's head, and the revisions every non-settled hunk names.
fn pin_heads_and_live_hunks(p: &Projection, s: &mut PinSet) {
    for d in p.docs.values() {
        if let Some(h) = d.head {
            s.pin(h, PinReason::Head);
        }
        for (id, h) in d
            .hunks
            .iter()
            .filter(|(_, h)| h.state != HunkState::Settled)
        {
            if let Some(b) = h.hunk.base {
                s.pin(b, PinReason::HunkBase(id.clone()));
            }
            s.pin(h.hunk.target, PinReason::HunkTarget(id.clone()));
            if let Some(r) = h.attached_revert {
                s.pin(r, PinReason::LatestRevert(id.clone()));
            }
            if let Some(lc) = h.span.last_certified {
                s.pin(lc.at, PinReason::LastCertified(id.clone()));
            }
            if let Some(b) = h.blocked_at {
                s.pin(b, PinReason::Barrier(id.clone()));
            }
        }
    }
}

/// An unlinearized observation keeps its base revision and both of its
/// texts, in one pass so the two rules cannot drift apart.
fn pin_pending_observations(p: &Projection, s: &mut PinSet) {
    for o in p.observations.values().filter(|o| o.linearized.is_none()) {
        if let Some(base) = observed_revision(p, &o.observed_parent) {
            s.pin(base, PinReason::CaptureBase);
        }
        s.blobs.insert(o.postimage.clone());
        s.blobs.insert(o.observed_preimage.clone());
    }
}

/// Every undeleted thread not resolved keeps the revision it was created
/// on, while that revision is still retained.
fn pin_unresolved_comments(p: &Projection, s: &mut PinSet) {
    for (id, t) in &p.comments.threads {
        let unresolved = t.state != ThreadState::Resolved && !t.deleted;
        let retained = p.revisions.get(&t.revision).is_some_and(|m| !m.collected);
        if unresolved && retained {
            s.pin(t.revision, PinReason::Comment(*id));
        }
    }
}

/// Live window bases and external roots, held by the writer in memory.
fn pin_writer_roots(p: &Projection, roots: &Roots<'_>, s: &mut PinSet) {
    for (name, (_, base)) in roots.window_bases {
        if let Some(revision) = observed_revision(p, base) {
            s.pin(revision, PinReason::WindowBase(name.clone()));
        }
    }
    for r in roots
        .external
        .iter()
        .filter(|r| p.revisions.contains_key(r))
    {
        s.pin(*r, PinReason::External);
    }
}

/// A pinned revision keeps its postimage and both before-texts.
fn expand_revision_blobs(p: &Projection, s: &mut PinSet) {
    for rev in s.revisions.keys() {
        let Some(m) = p.revisions.get(rev).filter(|m| !m.collected) else {
            continue;
        };
        s.blobs.insert(m.postimage.clone());
        // Both before-texts, by hash only — the predecessor revision is
        // not pinned, so a chain never pins its ancestors.
        s.blobs.extend(m.preimage.clone());
        s.blobs.extend(p.postimage_of(m.parent));
    }
}

/// `prepared` and `uncommitted` transactions and their preimages.
fn pin_unresolved_txns(p: &Projection, s: &mut PinSet) {
    for (id, t) in &p.txns {
        if matches!(t.status, TxnStatus::Prepared | TxnStatus::Uncommitted) {
            s.txns.insert(*id);
            s.blobs.insert(t.preimage.clone());
        }
    }
}

/// The journaled revision a base names. A base naming an observation
/// already linearized needs the revision it became: that revision's text
/// is the frozen save's `pre`, and compaction drops the observation once
/// its revision is collected. An unjournaled base is pinned once its
/// commit lands; an unlinearized observation is itself retained.
fn observed_revision(p: &Projection, base: &ObservedRef) -> Option<RevisionId> {
    let revision = match base {
        ObservedRef::Revision { revision } | ObservedRef::Unjournaled { revision } => {
            Some(*revision)
        }
        ObservedRef::Pending { observation } => {
            p.observations.get(observation).and_then(|o| o.linearized)
        }
        ObservedRef::Genesis => None,
    };
    revision.filter(|r| p.revisions.contains_key(r))
}
