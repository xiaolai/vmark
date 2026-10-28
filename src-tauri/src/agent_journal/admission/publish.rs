//! Publishing a staged prepare: the one place its outcome is decided.
//!
//! | Event | Outcome |
//! |---|---|
//! | the writer cannot persist, a blob put fails, a write error the file truncates back | refused: journal, projection, reservations and events unchanged |
//! | an fsync or truncate-back failure that poisons the journal | indeterminate (`JOURNAL_IO`, `indeterminate`): the frame may or may not be durable; the live state is unchanged and the writer refuses writes until reopen, which replays the whole frame or none of it |
//! | the frame is durable | the staged projection (or the record applied) becomes live, the reservation is taken (a `prepared` outcome only; a review decision holds none), one `Appended` per record |
//!
//! Staged blobs are stored before the frame, so a durable frame never
//! names a missing text; a refused frame may leave unreferenced blobs,
//! which collection drops.
//!
//! @module agent_journal/admission/publish

use crate::agent_journal::admission::receipt::Outcome;
use crate::agent_journal::codec;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, TxnId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::{Envelope, Record};
use crate::agent_journal::writer::certificate::FallbackReason;
use crate::agent_journal::writer::{Inner, JournalEvent, Reservation, Writer};

/// A prepare built in full, waiting to be written.
pub(crate) struct Staging {
    /// The top-level record, or the `admission` frame.
    pub(crate) env: Envelope,
    /// Texts the envelope names that the pack does not hold yet.
    pub(crate) blobs: Vec<(BlobHash, String)>,
    /// The clone every item was applied to; `None` for a single record,
    /// applied to the live projection once durable.
    pub(crate) staged: Option<Projection>,
    pub(crate) doc: DocId,
    /// The transaction a `prepared` opens, or the decision record's.
    pub(crate) txn: TxnId,
    pub(crate) response: Outcome,
    pub(crate) fallback: Option<FallbackReason>,
}

impl Writer {
    /// Write `s` and make it live. See the module docs for the outcomes.
    pub(crate) fn publish(&self, g: &mut Inner, s: Staging) -> Result<(), TxnError> {
        let reserve = matches!(s.response, Outcome::Prepared(_)).then_some((s.doc, s.txn));
        self.announce(g, s.env, s.blobs, s.staged, reserve)
    }

    /// Write one record that names no new text and holds no reservation
    /// (a comment state change or deletion), preflighted by the caller.
    pub(crate) fn publish_record(&self, g: &mut Inner, env: Envelope) -> Result<(), TxnError> {
        self.announce(g, env, Vec::new(), None, None)
    }

    fn announce(
        &self,
        g: &mut Inner,
        env: Envelope,
        blobs: Vec<(BlobHash, String)>,
        staged: Option<Projection>,
        reserve: Option<(DocId, TxnId)>,
    ) -> Result<(), TxnError> {
        let out = self.publish_unannounced(g, env, &blobs, staged, reserve);
        if out.is_err() {
            self.broadcast(JournalEvent::HealthChanged);
        }
        out
    }

    fn publish_unannounced(
        &self,
        g: &mut Inner,
        env: Envelope,
        blobs: &[(BlobHash, String)],
        staged: Option<Projection>,
        reserve: Option<(DocId, TxnId)>,
    ) -> Result<(), TxnError> {
        if staged.is_none() && matches!(env.record, Record::Admission { .. }) {
            // Its items apply one by one, so applied live a failing item
            // would leave the earlier ones behind (`admission::reduce`).
            return Err(TxnError::Invariant(
                "an admission is published only with its staged projection".into(),
            ));
        }
        g.persistable()?;
        for (hash, text) in blobs {
            g.blobs.put(hash, text)?;
        }
        self.faults.run_hook(&env);
        g.journal.append_record(&codec::encode(&env))?;
        match staged {
            Some(proj) => g.proj = proj,
            None => {
                if let Err(e) = g.proj.apply(&env) {
                    // Preflighted before the write, so this is a writer bug.
                    g.journal.poison();
                    return Err(TxnError::Corrupt(format!(
                        "appended record failed to apply: {e}"
                    )));
                }
            }
        }
        if let Some((doc, txn)) = reserve {
            g.reservations.insert(doc, Reservation { txn });
        }
        let records = match env.record {
            Record::Admission { items } => items,
            _ => vec![env],
        };
        for env in records {
            self.broadcast(JournalEvent::Appended(Box::new(env)));
        }
        Ok(())
    }
}
