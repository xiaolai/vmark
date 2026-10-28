//! The state every reader sees: records replayed in order. One `apply`
//! (see `projection_apply`) serves live appends, restart replay and window
//! hydration, so the live projection and the restart projection are equal
//! by construction (asserted in tests). Ordered maps keep `PartialEq`
//! meaningful.

use std::collections::BTreeMap;

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::receipt::{Receipt, RequestId};
use crate::agent_journal::comment::book::CommentBook;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::provenance::ProvenancePayload;
use crate::agent_journal::record::{LegacyAnchor, ObservedRef};
use crate::agent_journal::review::{Hunk, HunkState, MappedSpan, ReviewOp};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Projection {
    /// Highest `seq` applied (or the compaction floor).
    pub generation: u64,
    pub docs: BTreeMap<DocId, DocState>,
    /// Controlled mutations (`prepared` and what followed it).
    pub txns: BTreeMap<TxnId, TxnEntry>,
    pub revisions: BTreeMap<RevisionId, RevisionMeta>,
    /// Observations by their transaction id.
    pub observations: BTreeMap<TxnId, ObservationEntry>,
    pub legacy: BTreeMap<String, LegacyEntry>,
    /// Saves replayed ahead of the evidence for their pending base: a
    /// compaction dropped the base's `pendingObservation`, and the base's
    /// tombstone (at its linearization) comes later in the journal. Keyed
    /// by the base observation, each entry the document and preimage that
    /// tombstone must match. Empty once a replay is whole
    /// (`finish_replay`); never filled by a live append.
    pub awaiting_tombstone: BTreeMap<TxnId, Vec<(DocId, BlobHash)>>,
    /// Receipts of retained `prepared` records, by request id: a retried
    /// request is answered from here (`admission::receipt`).
    pub requests: BTreeMap<RequestId, Receipt>,
    /// Every retained comment thread and its usage (`comment::book`).
    pub comments: CommentBook,
    /// Whether any record has applied. A leading `journalHeader` may leave
    /// every other field at its default (seq 0, floor 0), so "nothing
    /// applied yet" is its own state, never inferred from the others.
    pub started: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DocState {
    pub head: Option<RevisionId>,
    pub hunks: BTreeMap<HunkId, HunkEntry>,
    /// Durable observations not yet linearized, in append order.
    pub pending: Vec<TxnId>,
    pub epoch: EpochState,
}

/// Editing epochs of one document (`epochArmed` / `epochClosed` /
/// `epochUnclosed`). Epoch numbers start at 1; `0` names "no epoch".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EpochState {
    /// The highest epoch ever armed.
    pub last: u64,
    /// The armed epoch, if one is open.
    pub open: Option<u64>,
}

impl DocState {
    /// Hunks occupying a review slot: every state except `settled`.
    pub fn non_settled(&self) -> usize {
        self.hunks
            .values()
            .filter(|h| h.state != HunkState::Settled)
            .count()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HunkEntry {
    pub hunk: Hunk,
    pub state: HunkState,
    pub review_gen: u64,
    /// Where the hunk sits in the head revision. Reset to the creation span
    /// when the hunk settles, so compaction (which drops spans of collected
    /// revisions) cannot change the projection; a settled hunk is never
    /// reverted, so the reset hides no block.
    pub span: MappedSpan,
    /// The latest `hunkRevert` revision attached to this hunk.
    pub attached_revert: Option<RevisionId>,
    /// The barrier: the revision whose record first blocked this hunk
    /// (sticky like the block). Reset with the span when the hunk settles.
    pub blocked_at: Option<RevisionId>,
}

impl HunkEntry {
    pub fn new(hunk: Hunk) -> Self {
        let span = Self::creation_span(&hunk);
        Self {
            hunk,
            state: HunkState::Pending,
            review_gen: 0,
            span,
            attached_revert: None,
            blocked_at: None,
        }
    }

    /// The span a hunk is created with, and reset to when it settles:
    /// its persisted target range, a deletion anchor iff that range is
    /// empty, certified (no block).
    pub fn creation_span(hunk: &Hunk) -> MappedSpan {
        MappedSpan {
            hunk_id: hunk.id.clone(),
            range: hunk.target_range,
            growing: hunk.target_range.start == hunk.target_range.end,
            edited_since: false,
            block: None,
            last_certified: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TxnStatus {
    Prepared,
    Aborted,
    Committed,
    /// `prepared` found without a terminal record at startup.
    Uncommitted,
    /// An `uncommitted` entry the user discarded (`by` = maintenance txn).
    Discarded {
        by: TxnId,
    },
    /// An `uncommitted` entry restored by `committed { resolves }`.
    Resolved {
        by: TxnId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxnEntry {
    pub doc: DocId,
    pub parent: Option<RevisionId>,
    pub revision: RevisionId,
    pub preimage: BlobHash,
    pub actor: Actor,
    pub initiator: Actor,
    pub tool: String,
    pub review_op: ReviewOp,
    /// A selection edit's certificate, bound to `parent`.
    pub certificate: Option<ProvenancePayload>,
    pub status: TxnStatus,
    pub seq: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RevisionKind {
    Controlled,
    Observed,
    Concurrent,
    Gap,
    Tombstone,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevisionMeta {
    pub id: RevisionId,
    pub doc: DocId,
    pub txn: TxnId,
    pub seq: u64,
    /// The linear parent (what review, revert and export use).
    pub parent: Option<RevisionId>,
    /// The attributed before-text. Differs from the parent's postimage for
    /// concurrent observations, gaps and prepares over unsaved edits.
    pub preimage: Option<BlobHash>,
    pub postimage: BlobHash,
    pub actor: Actor,
    pub review_op: ReviewOp,
    pub kind: RevisionKind,
    pub collected: bool,
    /// Unix milliseconds of the record that made the revision (a tombstone
    /// keeps its victim's).
    pub at: u64,
    /// The comments a controlled write said it addresses (a tombstone
    /// keeps its victim's).
    pub addresses: Vec<CommentId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationEntry {
    pub doc: DocId,
    pub actor: Actor,
    pub initiator: Actor,
    pub postimage: BlobHash,
    pub observed_parent: ObservedRef,
    pub observed_preimage: BlobHash,
    /// The frozen map observed preimage → postimage, if the save had one.
    pub provenance: Option<ProvenancePayload>,
    pub seq: u64,
    pub linearized: Option<RevisionId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyEntry {
    pub preimage: BlobHash,
    pub postimage: Option<BlobHash>,
    pub anchor: LegacyAnchor,
    pub tool: String,
    pub description: String,
    pub timestamp: u64,
    pub seq: u64,
}

impl Projection {
    pub fn head(&self, doc: DocId) -> Option<RevisionId> {
        self.docs.get(&doc).and_then(|d| d.head)
    }

    /// The postimage a revision's successor is built on (`""` before genesis).
    pub fn postimage_of(&self, rev: Option<RevisionId>) -> Option<BlobHash> {
        match rev {
            None => Some(BlobHash::of_text("")),
            Some(r) => self.revisions.get(&r).map(|m| m.postimage.clone()),
        }
    }
}
