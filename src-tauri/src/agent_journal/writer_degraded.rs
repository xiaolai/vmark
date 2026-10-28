//! The per-document degraded queue: records whose append failed after the
//! caller was told the change happened (a terminal record) or after a
//! capture (an observation, `journaled: no`). While non-empty the document
//! refuses new prepares, decisions and linearization with
//! `JOURNAL_DEGRADED`. `retry_degraded` drains it in order, without a
//! restart; queued text is a GC root until it lands. A drained capture
//! moves its window's base root to the observation, as a durable capture
//! does at once, unless the window was released or moved on meanwhile.

use std::collections::VecDeque;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, TxnId};
use crate::agent_journal::record::{ObservedRef, Record};
use crate::agent_journal::writer::Writer;

#[derive(Debug, Clone)]
pub(crate) struct Queued {
    pub txn: TxnId,
    pub record: Record,
    pub blobs: Vec<(BlobHash, String)>,
    /// Draining it releases the document's reservation.
    pub releases: bool,
    /// The window base root a capture moves once it lands; cleared when
    /// the window is released or registers a newer base.
    pub window: Option<String>,
}

impl Queued {
    /// Blob hashes this entry needs kept (its own text and what it names,
    /// stored already or not).
    pub fn roots(&self) -> Vec<BlobHash> {
        let mut out: Vec<BlobHash> = self.blobs.iter().map(|(h, _)| h.clone()).collect();
        if let Record::PendingObservation {
            postimage,
            observed_preimage,
            ..
        } = &self.record
        {
            out.extend([postimage.clone(), observed_preimage.clone()]);
        }
        out
    }
}

impl Writer {
    pub fn is_degraded(&self, doc: DocId) -> bool {
        self.lock()
            .degraded
            .get(&doc)
            .is_some_and(|q| !q.is_empty())
    }

    /// Drain the queue in order. `Ok(true)` once empty; `Ok(false)` if an
    /// append failed again (nothing lost, order kept).
    pub fn retry_degraded(&self, doc: DocId) -> Result<bool, TxnError> {
        let mut g = self.lock();
        while let Some(q) = g.degraded.get_mut(&doc).and_then(VecDeque::pop_front) {
            let refs: Vec<(&BlobHash, &str)> =
                q.blobs.iter().map(|(h, t)| (h, t.as_str())).collect();
            match self.append(&mut g, q.txn, q.record.clone(), &refs) {
                Ok(_) => {
                    if q.releases {
                        g.reservations.remove(&doc);
                    }
                    if let Some(window) = q.window.filter(|w| g.admits_window(w)) {
                        let base = ObservedRef::Pending { observation: q.txn };
                        g.window_bases.insert(window, (doc, base));
                    }
                }
                Err(e) => {
                    g.degraded.entry(doc).or_default().push_front(q);
                    return match e {
                        TxnError::Io(_) | TxnError::Indeterminate(_) => Ok(false),
                        other => Err(other),
                    };
                }
            }
        }
        g.degraded.remove(&doc);
        Ok(true)
    }
}

#[cfg(test)]
#[path = "persistence_boundary.test.rs"]
mod persistence_boundary_tests;
