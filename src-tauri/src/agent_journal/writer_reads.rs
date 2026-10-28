//! The writer's read accessors: snapshots, heads, health and blob text for
//! commands, plus reservations and counters only tests read. Each takes the
//! writer lock once and copies what it returns, so no caller holds the lock;
//! the incarnation, fixed at open, takes none. Also the next generation.

use crate::agent_journal::admission::identity::Incarnation;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::writer::{Inner, Snapshot, Writer};

impl Inner {
    /// The generation the next record (or a rewrite's header floor) takes.
    /// `u64::MAX` is reserved — replay refuses it — so at the cap this
    /// refuses before anything is written, instead of producing a journal
    /// the next open reads as corrupt.
    pub(crate) fn next_generation(&self) -> Result<u64, TxnError> {
        self.proj
            .generation
            .checked_add(1)
            .filter(|g| *g < u64::MAX)
            .ok_or_else(|| TxnError::Io("journal generation exhausted".into()))
    }
}

impl Writer {
    pub fn snapshot(&self) -> Snapshot {
        let g = self.lock();
        Snapshot {
            generation: g.proj.generation,
            state: g.proj.clone(),
        }
    }

    /// This open's incarnation. Takes no lock: it never changes.
    pub fn incarnation(&self) -> &Incarnation {
        &self.incarnation
    }

    pub fn head(&self, doc: DocId) -> Option<RevisionId> {
        self.lock().proj.head(doc)
    }

    #[cfg(test)]
    pub fn reservation(&self, doc: DocId) -> Option<crate::agent_journal::writer::Reservation> {
        self.lock().reservations.get(&doc).copied()
    }

    /// The generation of the last applied record (0 for an empty journal).
    pub fn generation(&self) -> u64 {
        self.lock().proj.generation
    }

    /// `Ok` while the writer accepts controlled mutations; otherwise the
    /// refusal every one of them would get (corrupt or degraded).
    pub fn health(&self) -> Result<(), TxnError> {
        self.lock().healthy()
    }

    #[cfg(test)]
    pub fn journal_len(&self) -> u64 {
        self.lock().journal.len()
    }

    /// What a status reports of the writer, read in one critical section:
    /// the generation, whether it is degraded (unhealthy, or a queued record
    /// not durable yet) and the uncertified-fallback count.
    pub fn status_facts(&self) -> (u64, bool, u64) {
        let g = self.lock();
        let degraded = g.healthy().is_err() || g.degraded.values().any(|q| !q.is_empty());
        (g.proj.generation, degraded, g.uncertified_fallbacks)
    }

    pub fn blob_text(&self, hash: &BlobHash) -> Result<String, TxnError> {
        self.lock().blobs.get(hash)
    }

    #[cfg(test)]
    pub fn pending_observations(&self, doc: DocId) -> Vec<crate::agent_journal::ids::TxnId> {
        self.lock()
            .proj
            .docs
            .get(&doc)
            .map(|d| d.pending.clone())
            .unwrap_or_default()
    }
}
