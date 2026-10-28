//! The observation family of `Projection::apply`: `pendingObservation`
//! and the three records that linearize one.
//!
//! A save's observed base replays as the writer resolved it
//! (`writer_base::resolve_base`): a revision or observation of the same
//! document whose postimage is the observed preimage, or genesis with the
//! empty text. A collected revision stays a base (its tombstone keeps the
//! postimage). Only a base replay cannot see passes unchecked: an
//! `unjournaled` commit not yet in the journal (it lands later, if ever).
//! An observation whose `pendingObservation` the collector dropped is
//! checked against the evidence compaction leaves — its revision's
//! tombstone under the same transaction, whose postimage is the
//! observation's. That tombstone sits at the linearization, so it can come
//! after a save built on the observation: a record below the compaction
//! floor then waits for it (`awaiting_tombstone`), the tombstone settles
//! the check, and a replay that ends still waiting is corrupt
//! (`finish_replay`).

use super::{corrupt, misrouted};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, DocId, TxnId};
use crate::agent_journal::projection::*;
use crate::agent_journal::projection_checks::EffectShape;
use crate::agent_journal::projection_steps::Linearization;
use crate::agent_journal::record::{Envelope, ObservedRef, Record};
use crate::agent_journal::review::ReviewOp;

impl Projection {
    /// `pendingObservation` and the three records that linearize one.
    pub(in crate::agent_journal) fn apply_observation_record(
        &mut self,
        env: &Envelope,
        seq: u64,
        txn: TxnId,
    ) -> Result<(), TxnError> {
        match &env.record {
            Record::PendingObservation {
                doc,
                actor,
                initiator,
                postimage,
                observed_parent,
                observed_preimage,
                provenance,
            } => {
                if self.observations.contains_key(&txn) {
                    return Err(corrupt("duplicate pendingObservation"));
                }
                if self.awaiting_tombstone.contains_key(&txn) {
                    return Err(corrupt("a save observed an observation recorded after it"));
                }
                let awaiting =
                    self.check_observed_base(*doc, seq, observed_parent, observed_preimage)?;
                if let Some(base) = awaiting {
                    self.awaiting_tombstone
                        .entry(base)
                        .or_default()
                        .push((*doc, observed_preimage.clone()));
                }
                self.docs.entry(*doc).or_default().pending.push(txn);
                self.observations.insert(
                    txn,
                    ObservationEntry {
                        doc: *doc,
                        actor: actor.clone(),
                        initiator: initiator.clone(),
                        postimage: postimage.clone(),
                        observed_parent: observed_parent.clone(),
                        observed_preimage: observed_preimage.clone(),
                        provenance: provenance.clone(),
                        seq,
                        linearized: None,
                    },
                );
            }
            Record::ObservedRevision {
                revision,
                parent,
                effects,
            } => self.linearize_checked(
                txn,
                (seq, env.at),
                Linearization {
                    revision: *revision,
                    parent: *parent,
                    preimage: None,
                    observed_parent: None,
                    kind: RevisionKind::Observed,
                    effects,
                },
            )?,
            Record::ConcurrentObservation {
                revision,
                parent,
                observed_parent,
                observed_preimage,
                effects,
            } => self.linearize_checked(
                txn,
                (seq, env.at),
                Linearization {
                    revision: *revision,
                    parent: *parent,
                    preimage: Some(observed_preimage),
                    observed_parent: Some(observed_parent),
                    kind: RevisionKind::Concurrent,
                    effects,
                },
            )?,
            Record::Gap {
                revision,
                parent,
                observed_preimage,
                effects,
                ..
            } => self.linearize_checked(
                txn,
                (seq, env.at),
                Linearization {
                    revision: *revision,
                    parent: *parent,
                    preimage: Some(observed_preimage),
                    observed_parent: None,
                    kind: RevisionKind::Gap,
                    effects,
                },
            )?,
            _ => return Err(misrouted("observation")),
        }
        Ok(())
    }

    /// `linearize`, after the record's effects pass the structural checks
    /// (`check_effect_shape`) against its observation's document.
    fn linearize_checked(
        &mut self,
        txn: TxnId,
        at: (u64, u64),
        l: Linearization<'_>,
    ) -> Result<(), TxnError> {
        if let Some(o) = self.observations.get(&txn) {
            let shape = EffectShape {
                doc: o.doc,
                op: &ReviewOp::None,
                revision: l.revision,
                parent: l.parent,
                spans: true,
            };
            self.check_effect_shape(&shape, l.effects)?;
        }
        self.linearize(txn, at, l)
    }

    /// The tombstone compaction left for `observation`'s dropped record:
    /// the collector keeps a victim's revision as a tombstone under the same
    /// transaction, with the observation's postimage. Scanned only for an
    /// absent observation.
    fn collected_observation(&self, observation: TxnId) -> Option<(DocId, BlobHash)> {
        self.revisions
            .values()
            .find(|m| m.collected && m.txn == observation)
            .map(|m| (m.doc, m.postimage.clone()))
    }

    /// Refuse a base the writer could not have resolved to
    /// `observed_preimage` for `doc`. `Some(observation)` when the base is an
    /// observation absent from a record below the compaction floor (`seq`
    /// under the generation): its tombstone may still follow, and is checked
    /// when it does.
    fn check_observed_base(
        &self,
        doc: DocId,
        seq: u64,
        base: &ObservedRef,
        observed_preimage: &BlobHash,
    ) -> Result<Option<TxnId>, TxnError> {
        let found = match base {
            ObservedRef::Genesis => Some((doc, BlobHash::of_text(""))),
            ObservedRef::Revision { revision } => Some(
                self.revisions
                    .get(revision)
                    .map(|m| (m.doc, m.postimage.clone()))
                    .ok_or_else(|| corrupt("a save observed an unknown revision"))?,
            ),
            ObservedRef::Unjournaled { revision } => self
                .revisions
                .get(revision)
                .map(|m| (m.doc, m.postimage.clone())),
            ObservedRef::Pending { observation } => match self.observations.get(observation) {
                Some(o) => Some((o.doc, o.postimage.clone())),
                None => match self.collected_observation(*observation) {
                    Some(found) => Some(found),
                    None if seq < self.generation => return Ok(Some(*observation)),
                    None => return Err(corrupt("a save observed an unknown observation")),
                },
            },
        };
        check_base_text(found, doc, observed_preimage).map(|()| None)
    }

    /// A tombstone of `txn` settles the saves that waited for it: each must
    /// have observed the tombstone's document and postimage. Checked before
    /// the tombstone applies; [`Projection::settle_awaiting`] clears them
    /// after.
    pub(super) fn check_awaiting(
        &self,
        txn: TxnId,
        doc: DocId,
        postimage: &BlobHash,
    ) -> Result<(), TxnError> {
        let waiting = self
            .awaiting_tombstone
            .get(&txn)
            .map_or(&[][..], Vec::as_slice);
        waiting
            .iter()
            .try_for_each(|(d, pre)| check_base_text(Some((doc, postimage.clone())), *d, pre))
    }

    pub(super) fn settle_awaiting(&mut self, txn: TxnId) {
        self.awaiting_tombstone.remove(&txn);
    }

    /// A whole replay leaves no save waiting for its base's tombstone:
    /// one still waiting observed an observation the journal never had.
    ///
    /// # Errors
    /// `Corrupt` when a save still waits.
    pub(crate) fn finish_replay(&self) -> Result<(), TxnError> {
        match self.awaiting_tombstone.is_empty() {
            true => Ok(()),
            false => Err(corrupt("a save observed an unknown observation")),
        }
    }
}

/// `found` (a base's document and text, if replay can see it) is `doc`'s
/// and holds `observed_preimage`.
fn check_base_text(
    found: Option<(DocId, BlobHash)>,
    doc: DocId,
    observed_preimage: &BlobHash,
) -> Result<(), TxnError> {
    match found {
        Some((d, _)) if d != doc => Err(corrupt("a save observed another document")),
        Some((_, text)) if text != *observed_preimage => {
            Err(corrupt("a save's observed preimage is not its base's text"))
        }
        _ => Ok(()),
    }
}
