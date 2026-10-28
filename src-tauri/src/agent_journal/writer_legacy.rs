//! Legacy checkpoint import and `#[doc(hidden)]` test seams (each one only
//! under `cfg(test)`).
//!
//! The import is idempotent by legacy id: a checkpoint already in the
//! journal is skipped, so a crash mid-import is repaired by running it
//! again, and a re-run on every startup costs no write.

use crate::agent_journal::codec::LegacyMigration;
#[cfg(test)]
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::LegacyEntry;
#[cfg(test)]
use crate::agent_journal::record::Envelope;
use crate::agent_journal::record::Record;
use crate::agent_journal::writer::Writer;

impl Writer {
    /// Import raw `mcp-checkpoints.jsonl` lines. Every line must parse; a
    /// malformed one refuses the whole call before anything is written.
    /// Returns how many records were appended. A test seam: production
    /// parses in `legacy_import` and calls [`Writer::import_legacy`].
    #[cfg(test)]
    pub fn migrate_legacy(&self, lines: &[&str]) -> Result<usize, TxnError> {
        let parsed = lines
            .iter()
            .map(|l| codec::migrate_legacy_line(l))
            .collect::<Result<Vec<_>, _>>()?;
        self.import_legacy(&parsed)
    }

    /// Append one `legacyCheckpoint` (and its preimage blob) per migration
    /// whose legacy id the journal does not hold yet, in order. Each record
    /// is durable before the next is written. Returns how many were
    /// appended.
    pub fn import_legacy(&self, migrations: &[LegacyMigration]) -> Result<usize, TxnError> {
        let mut g = self.lock();
        g.healthy()?;
        let mut appended = 0;
        for m in migrations {
            let Record::LegacyCheckpoint {
                legacy_id,
                preimage,
                ..
            } = &m.record
            else {
                return Err(TxnError::Invariant(
                    "legacy migration produced a non-legacy record".into(),
                ));
            };
            if g.proj.legacy.contains_key(legacy_id) {
                continue;
            }
            let pre = preimage.clone();
            self.append(
                &mut g,
                TxnId::new(),
                m.record.clone(),
                &[(&pre, &m.preimage_text)],
            )?;
            appended += 1;
        }
        Ok(appended)
    }

    /// The projected entry of one imported checkpoint.
    pub fn legacy_entry(&self, legacy_id: &str) -> Option<LegacyEntry> {
        self.lock().proj.legacy.get(legacy_id).cloned()
    }

    /// Test-only: absent from a default build, so production code
    /// cannot set `reviewGen` around the transition rules.
    #[cfg(test)]
    #[doc(hidden)]
    pub fn debug_set_review_gen(
        &self,
        doc: crate::agent_journal::ids::DocId,
        hunk: &crate::agent_journal::ids::HunkId,
        gen: u64,
    ) {
        let mut g = self.lock();
        let h = g
            .proj
            .docs
            .get_mut(&doc)
            .and_then(|d| d.hunks.get_mut(hunk))
            .expect("hunk exists");
        h.review_gen = gen;
    }

    #[cfg(test)]
    #[doc(hidden)]
    pub fn debug_append_raw(&self, payload: &[u8]) -> Result<(), TxnError> {
        self.lock().journal.append(payload).map(|_| ())
    }

    #[cfg(test)]
    #[doc(hidden)]
    pub fn debug_records(&self) -> Vec<Envelope> {
        let payloads = self.lock().journal.read_all().expect("readable journal");
        payloads
            .iter()
            .filter_map(|p| match codec::decode(p) {
                Ok(Decoded::Known(env)) => Some(*env),
                _ => None,
            })
            .collect()
    }
}
