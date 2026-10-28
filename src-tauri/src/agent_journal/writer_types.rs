//! The writer's request, reply and event types, split from `writer` so the
//! writer file holds only the lock, the append path and the queries.
//!
//! @module agent_journal/writer_types

use std::path::PathBuf;
use std::sync::Arc;

use crate::agent_journal::actor::Actor;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::projection::Projection;
use crate::agent_journal::provenance::ProvenancePayload;
use crate::agent_journal::record::Envelope;
use crate::agent_journal::review::{ReviewEffects, ReviewOp};

pub struct WriterConfig {
    pub dir: PathBuf,
    pub sync: SyncPolicy,
    pub faults: Arc<Faults>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OpenReport {
    pub truncated_tail_bytes: u64,
    /// Transactions turned `uncommitted` by this startup.
    pub uncommitted: Vec<TxnId>,
    pub pending_observations: usize,
    /// Epochs left armed by the last run, now recorded `epochUnclosed`.
    pub unclosed_epochs: Vec<(DocId, u64)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub generation: u64,
    pub state: Projection,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareRequest {
    pub doc: DocId,
    /// The head the caller computed against (parent CAS).
    pub parent: Option<RevisionId>,
    pub preimage: String,
    pub actor: Actor,
    pub initiator: Actor,
    pub tool: String,
    pub review_op: ReviewOp,
    /// A selection edit's certificate, already bound to `parent`.
    #[serde(default)]
    pub certificate: Option<crate::agent_journal::provenance::ProvenancePayload>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Prepared {
    pub txn: TxnId,
    /// The revision id the commit will carry (hunk ids hash it).
    pub revision: RevisionId,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitRequest {
    pub postimage: String,
    pub resolves: Option<TxnId>,
    /// The certified map preimage → postimage. `None`: the writer records a
    /// whole-document barrier (`wholeDocumentWrite` for `review`,
    /// `snapshotOnly` for `none`, `restore` for a restore). A `hunkRevert`
    /// never sends one: the writer derives its exact single-change map.
    #[serde(default)]
    pub provenance: Option<ProvenancePayload>,
    pub effects: ReviewEffects,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitOutcome {
    pub revision: RevisionId,
    /// The editor content was changed (always true once a commit is accepted).
    pub applied: bool,
    /// False: the record waits in the degraded queue.
    pub durable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Durability {
    pub durable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reservation {
    pub txn: TxnId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JournalEvent {
    Appended(Box<Envelope>),
    /// Compaction rewrote history: re-fetch the snapshot.
    Resync {
        generation: u64,
    },
    /// An append failed: nothing new to read, but the journal's health may
    /// have changed (a poisoned writer, a document's queued record).
    HealthChanged,
}

/// Unix milliseconds now, the `at` of every envelope.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}
