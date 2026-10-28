//! The record families `Projection::apply` dispatches to (transactions,
//! observations — in `projection_observations` — tombstones, legacy
//! checkpoints), each checking what it could refuse before it changes
//! anything.
//!
//! A family step is only reached for its own records (`apply_record`
//! dispatches by kind); any other record is an invariant error, not a
//! panic.

use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, TxnId};
use crate::agent_journal::projection::*;
use crate::agent_journal::projection_checks::EffectShape;
use crate::agent_journal::record::{Envelope, Record};
use crate::agent_journal::review::{ReviewEffects, ReviewOp};

fn corrupt(what: impl Into<String>) -> TxnError {
    TxnError::Corrupt(what.into())
}

#[path = "projection_observations.rs"]
mod observations;

fn misrouted(family: &str) -> TxnError {
    TxnError::Invariant(format!("not a {family} record"))
}

impl Projection {
    /// `prepared`, `aborted`, `uncommitted`, `discarded`, `committed`.
    pub(super) fn apply_txn_record(
        &mut self,
        env: &Envelope,
        seq: u64,
        txn: TxnId,
    ) -> Result<(), TxnError> {
        match &env.record {
            Record::Prepared {
                doc,
                parent,
                revision,
                preimage,
                actor,
                initiator,
                tool,
                review_op,
                certificate,
            } => {
                self.check_prepared(txn, *doc, *parent, *revision, preimage)?;
                self.docs.entry(*doc).or_default();
                self.txns.insert(
                    txn,
                    TxnEntry {
                        doc: *doc,
                        parent: *parent,
                        revision: *revision,
                        preimage: preimage.clone(),
                        actor: actor.clone(),
                        initiator: initiator.clone(),
                        tool: tool.clone(),
                        review_op: review_op.clone(),
                        certificate: certificate.clone(),
                        status: TxnStatus::Prepared,
                        seq,
                    },
                );
            }
            Record::Aborted { .. } => {
                self.set_status(txn, TxnStatus::Prepared, TxnStatus::Aborted)?
            }
            Record::Uncommitted => {
                self.set_status(txn, TxnStatus::Prepared, TxnStatus::Uncommitted)?
            }
            Record::Discarded { resolves } => {
                self.set_status(
                    *resolves,
                    TxnStatus::Uncommitted,
                    TxnStatus::Discarded { by: txn },
                )?;
            }
            Record::Committed {
                postimage,
                resolves,
                effects,
                addresses,
                ..
            } => {
                let ends = (postimage, *resolves);
                self.apply_committed(env, (seq, txn), ends, effects, addresses)?
            }
            _ => return Err(misrouted("transaction")),
        }
        Ok(())
    }

    /// A `committed` record: its open `prepared` becomes a controlled
    /// revision on the head it was prepared on (the reservation held that
    /// head still), and the `uncommitted` transaction it resolves, if any, is
    /// checked before anything changes.
    fn apply_committed(
        &mut self,
        env: &Envelope,
        (seq, txn): (u64, TxnId),
        (postimage, resolves): (&BlobHash, Option<TxnId>),
        effects: &ReviewEffects,
        addresses: &[CommentId],
    ) -> Result<(), TxnError> {
        let t = self
            .txns
            .get(&txn)
            .filter(|t| t.status == TxnStatus::Prepared)
            .cloned()
            .ok_or_else(|| corrupt("committed without an open prepared"))?;
        self.check_on_head(t.doc, t.parent, "committed")?;
        let shape = EffectShape {
            doc: t.doc,
            op: &t.review_op,
            revision: t.revision,
            parent: t.parent,
            spans: true,
        };
        self.check_effect_shape(&shape, effects)?;
        let resolved = resolves.map(|r| self.txns.get(&r));
        if resolved.is_some_and(|r| r.is_none_or(|r| r.status != TxnStatus::Uncommitted)) {
            return Err(corrupt("resolves a transaction that is not uncommitted"));
        }
        let meta = RevisionMeta {
            id: t.revision,
            doc: t.doc,
            txn,
            seq,
            parent: t.parent,
            preimage: Some(t.preimage),
            postimage: postimage.clone(),
            actor: t.actor,
            review_op: t.review_op.clone(),
            kind: RevisionKind::Controlled,
            collected: false,
            at: env.at,
            addresses: addresses.to_vec(),
        };
        self.add_revision(meta, &t.review_op, effects)?;
        if let Some(r) = resolves {
            self.set_status(r, TxnStatus::Uncommitted, TxnStatus::Resolved { by: txn })?;
        }
        self.set_status(txn, TxnStatus::Prepared, TxnStatus::Committed)?;
        Ok(())
    }

    /// A collected revision, kept as a tombstone with its hunks: on the
    /// head, as the revision it stands for was.
    pub(super) fn apply_tombstone(
        &mut self,
        env: &Envelope,
        seq: u64,
        txn: TxnId,
    ) -> Result<(), TxnError> {
        let Record::Tombstone {
            doc,
            revision,
            parent,
            actor,
            preimage,
            postimage,
            review_op,
            hunks,
            transitions,
            attached_to,
            addresses,
        } = &env.record
        else {
            return Err(misrouted("tombstone"));
        };
        // The collector names a collected `hunkRevert`'s hunk, and only that.
        let reverted = match review_op {
            ReviewOp::HunkRevert { hunk_id, .. } => Some(hunk_id),
            _ => None,
        };
        if attached_to.as_ref() != reverted {
            return Err(corrupt("a tombstone attached to a hunk it did not revert"));
        }
        self.check_on_head(*doc, *parent, "tombstone")?;
        self.check_awaiting(txn, *doc, postimage)?;
        let meta = RevisionMeta {
            id: *revision,
            doc: *doc,
            txn,
            seq,
            parent: *parent,
            preimage: preimage.clone(),
            postimage: postimage.clone(),
            actor: actor.clone(),
            review_op: review_op.clone(),
            kind: RevisionKind::Tombstone,
            collected: true,
            at: env.at,
            addresses: addresses.clone(),
        };
        let effects = ReviewEffects {
            new_hunks: hunks.clone(),
            transitions: transitions.clone(),
            ..Default::default()
        };
        let shape = EffectShape {
            doc: *doc,
            op: review_op,
            revision: *revision,
            parent: *parent,
            spans: false,
        };
        self.check_effect_shape(&shape, &effects)?;
        self.add_revision(meta, review_op, &effects)?;
        self.settle_awaiting(txn);
        Ok(())
    }

    /// A frontend checkpoint migrated into the journal. Import is
    /// first-wins, so a repeated id is corruption.
    pub(super) fn apply_legacy(&mut self, record: &Record, seq: u64) -> Result<(), TxnError> {
        let Record::LegacyCheckpoint {
            legacy_id,
            preimage,
            postimage,
            anchor,
            tool,
            description,
            timestamp,
        } = record
        else {
            return Err(misrouted("legacy checkpoint"));
        };
        if self.legacy.contains_key(legacy_id) {
            return Err(corrupt("duplicate legacy checkpoint"));
        }
        self.legacy.insert(
            legacy_id.clone(),
            LegacyEntry {
                preimage: preimage.clone(),
                postimage: postimage.clone(),
                anchor: anchor.clone(),
                tool: tool.clone(),
                description: description.clone(),
                timestamp: *timestamp,
                seq,
            },
        );
        Ok(())
    }
}
