//! Journal schema records, v2 to v5 (v1 histories decode through `codec`).
//!
//! One `Envelope` per framed record. `seq` is the writer's generation: it is
//! strictly increasing across appends, restarts and compactions (compaction
//! writes a `journalHeader` carrying the floor). Blobs are referenced by
//! content address and live in the blob pack, never inline. `seq` and
//! `generationFloor` are decimal strings (`u64_wire`).

use serde::{Deserialize, Serialize};

use crate::agent_journal::actor::Actor;
use crate::agent_journal::admission::receipt::Receipt;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::comment::records::{
    CommentCreated, CommentDeleted, CommentReplied, CommentState,
};
use crate::agent_journal::ids::{BlobHash, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::provenance::ProvenancePayload;
use crate::agent_journal::review::{
    Hunk, HunkTransition, ReviewAction, ReviewEffects, ReviewItem, ReviewOp,
};

/// The newest schema version this build writes. A record is labelled with
/// the lowest version that has its kind and fields (`schema_table::label`),
/// so a record that uses nothing newer than v2 is still written as v2.
pub const SCHEMA_VERSION: u32 = 5;
/// The newest schema version this build can read. A record above it turns
/// the journal off for every document before anything is repaired
/// (`JOURNAL_FUTURE_FORMAT`; see `writer_replay`).
pub const MAX_SUPPORTED_SCHEMA: u32 = SCHEMA_VERSION;
/// The first schema, decoded conservatively: no provenance, so every live
/// hunk it touches is blocked.
pub const SCHEMA_V1: u32 = 1;
/// The provenance schema: every record kind this build writes today.
pub const SCHEMA_V2: u32 = 2;
/// The selection edit schema: a `prepared` record may carry a certificate.
pub const SCHEMA_V3: u32 = 3;
/// The revert schema: a request receipt may store a revert's prepared
/// reply or the review decision a revert recorded instead.
pub const SCHEMA_V4: u32 = 4;
/// The comment schema: the four comment kinds, and receipts storing a
/// created thread or a reply.
pub const SCHEMA_V5: u32 = 5;

/// The framed unit. Unknown fields are corruption at every level: a
/// current-version record this build only half understands would otherwise
/// lose the extra data on the next rewrite or compaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub schema_version: u32,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub seq: u64,
    pub txn: TxnId,
    /// Unix milliseconds.
    pub at: u64,
    pub record: Record,
    /// The request this record answers (a `prepared`, v3; a comment create
    /// or reply, v5): its id, payload digest and first reply
    /// (`admission::receipt`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
}

/// What an observation was built on. Decoded through [`ObservedRefWire`],
/// so an unknown key is refused on every variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "ref",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    from = "ObservedRefWire"
)]
pub enum ObservedRef {
    /// A linearized revision.
    Revision { revision: RevisionId },
    /// This window's own earlier, still-pending observation.
    Pending { observation: TxnId },
    /// Text that is not in the journal at capture time — the postimage of a
    /// commit still waiting in the degraded queue. Linearizes as `gap`.
    Unjournaled { revision: RevisionId },
    /// The document had no revision yet.
    Genesis,
}

/// `ObservedRef` as read. `deny_unknown_fields` cannot see keys beside the
/// tag of a unit variant, so `genesis` decodes as an empty struct variant
/// here; the written shape (`{"ref":"genesis"}`) is unchanged.
#[derive(Deserialize)]
#[serde(
    tag = "ref",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ObservedRefWire {
    Revision { revision: RevisionId },
    Pending { observation: TxnId },
    Unjournaled { revision: RevisionId },
    Genesis {},
}

impl From<ObservedRefWire> for ObservedRef {
    fn from(w: ObservedRefWire) -> Self {
        match w {
            ObservedRefWire::Revision { revision } => Self::Revision { revision },
            ObservedRefWire::Pending { observation } => Self::Pending { observation },
            ObservedRefWire::Unjournaled { revision } => Self::Unjournaled { revision },
            ObservedRefWire::Genesis {} => Self::Genesis,
        }
    }
}

/// Why a `gap` record exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GapReason {
    /// The edit was built on a postimage whose `committed` was not durable
    /// when the edit was captured.
    UnjournaledBase,
}

/// Where a legacy checkpoint was anchored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "anchor",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LegacyAnchor {
    FilePath { path: String },
    Tab { tab_id: String },
}

/// Every record kind of schema v2 (v1 kinds plus the epoch records).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Record {
    /// First frame of a compacted journal: generations never repeat.
    JournalHeader {
        #[serde(with = "crate::agent_journal::u64_wire")]
        generation_floor: u64,
    },
    /// Controlled mutation step 1: takes the per-document reservation.
    Prepared {
        doc: DocId,
        parent: Option<RevisionId>,
        /// Minted at prepare so the worker can compute hunk ids before commit.
        revision: RevisionId,
        preimage: BlobHash,
        actor: Actor,
        initiator: Actor,
        tool: String,
        review_op: ReviewOp,
        /// A selection edit's certificate, bound to `parent` (v3).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        certificate: Option<ProvenancePayload>,
    },
    Aborted {
        reason: String,
    },
    Committed {
        postimage: BlobHash,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resolves: Option<TxnId>,
        /// The map preimage → postimage. Required in v2; absent only in
        /// a decoded v1 record, which then blocks every live hunk.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<ProvenancePayload>,
        effects: ReviewEffects,
        /// The comments the write says it addresses (v5): a claim only.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        addresses: Vec<CommentId>,
    },
    /// Appended at startup for every `prepared` without a terminal record.
    Uncommitted,
    /// Resolves an `uncommitted` transaction without restoring it.
    Discarded {
        resolves: TxnId,
    },
    /// A human save, durable before it can be linearized.
    PendingObservation {
        doc: DocId,
        actor: Actor,
        initiator: Actor,
        postimage: BlobHash,
        observed_parent: ObservedRef,
        observed_preimage: BlobHash,
        /// The frozen map observed preimage → postimage. Absent: a
        /// snapshot-only save, a whole-document barrier when linearized.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<ProvenancePayload>,
    },
    /// Linearization whose `observedParent` was the head.
    ObservedRevision {
        revision: RevisionId,
        parent: Option<RevisionId>,
        effects: ReviewEffects,
    },
    /// Linearization whose `observedParent` was not the head: both bases.
    ConcurrentObservation {
        revision: RevisionId,
        parent: Option<RevisionId>,
        observed_parent: ObservedRef,
        observed_preimage: BlobHash,
        effects: ReviewEffects,
    },
    /// Linearization of an edit built on unjournaled text.
    Gap {
        revision: RevisionId,
        parent: Option<RevisionId>,
        observed_preimage: BlobHash,
        reason: GapReason,
        effects: ReviewEffects,
    },
    /// Review-only decision, CAS on head and on every item's `reviewGen`.
    ReviewDecision {
        doc: DocId,
        expected_head: Option<RevisionId>,
        action: ReviewAction,
        items: Vec<ReviewItem>,
    },
    /// What GC leaves of a collected revision: metadata, no
    /// blobs, no spans. Replaces the revision record in place (same `seq`).
    Tombstone {
        doc: DocId,
        revision: RevisionId,
        parent: Option<RevisionId>,
        actor: Actor,
        preimage: Option<BlobHash>,
        postimage: BlobHash,
        review_op: ReviewOp,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        hunks: Vec<Hunk>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transitions: Vec<HunkTransition>,
        /// The hunk a collected `hunkRevert` revision was attached to.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attached_to: Option<HunkId>,
        /// The collected `committed`'s addresses (v5).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        addresses: Vec<CommentId>,
    },
    /// An editing epoch is durably armed before its maps are eligible.
    EpochArmed {
        doc: DocId,
        #[serde(with = "crate::agent_journal::u64_wire")]
        epoch: u64,
    },
    /// The epoch ended cleanly: every operation it saw was captured.
    EpochClosed {
        doc: DocId,
        #[serde(with = "crate::agent_journal::u64_wire")]
        epoch: u64,
    },
    /// Appended at startup for an epoch left armed: operations may have been
    /// lost in memory, so every non-settled hunk of the document is blocked
    /// (`unclosedEpoch`), even when the recovered text equals the saved one.
    EpochUnclosed {
        doc: DocId,
        #[serde(with = "crate::agent_journal::u64_wire")]
        epoch: u64,
    },
    /// One multi-record write as one frame (v3): complete child envelopes
    /// with contiguous `seq` from this envelope's, one `at`, one document
    /// (`admission::shape`). Durable whole or not at all.
    Admission {
        items: Vec<Envelope>,
    },
    /// Comment threads (v5, `comment::records`); never a content head.
    CommentCreated(CommentCreated),
    CommentReplied(CommentReplied),
    CommentState(CommentState),
    CommentDeleted(CommentDeleted),
    /// Immutable migrated checkpoint; outside revision chains.
    LegacyCheckpoint {
        legacy_id: String,
        preimage: BlobHash,
        postimage: Option<BlobHash>,
        anchor: LegacyAnchor,
        tool: String,
        description: String,
        timestamp: u64,
    },
}

#[cfg(test)]
#[path = "record_shape.test.rs"]
mod shape_tests;
