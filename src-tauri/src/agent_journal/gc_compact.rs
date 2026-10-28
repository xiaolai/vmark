//! Collector compaction (pure): the journal rewritten with the planned
//! victims tombstoned, and the projection that rewrite must replay to.
//!
//! A victim's revision record becomes a `tombstone` with the same `seq`,
//! `txn` and `at` (ids, parent, actor, hashes, its review op, the hunks it
//! created and the transitions it made — replay needs both). Records that
//! would reopen or orphan state once the revision is gone are dropped: a
//! collected commit's `prepared`, a collected observation's
//! `pendingObservation`, and every record of an `uncommitted` transaction
//! a collected commit resolved (the resolution is gone with the commit).
//! A dropped transaction takes its request receipt with it. An
//! `admission` frame is rewritten as its items, each a top-level record
//! mapped as above (`writer_gc`).
//! The startup pass also prunes deleted comment threads: every record of
//! a pruned thread is dropped, its receipts with it, and `expected` drops
//! the same set from the comment book and the receipt table.
//! The rewrite starts with a `journalHeader` one generation past the live
//! one, so a reader that missed the `Resync` sees a gap at its next event.
//!
//! `Rewrite` maps one record at a time, so the caller streams the journal
//! through it (twice: once to replay, once to write). The caller replays
//! the rewrite and compares it with `expected`; any difference — a victim
//! record missing included — refuses the collection before a byte is
//! written.
//!
//! @module agent_journal/gc_compact

use std::collections::{BTreeMap, BTreeSet};

use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::comment::records::CommentRecord;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{RevisionId, TxnId};
use crate::agent_journal::projection::{Projection, RevisionKind, RevisionMeta, TxnStatus};
use crate::agent_journal::record::{Envelope, Record};
use crate::agent_journal::review::{ReviewEffects, ReviewOp};
use crate::agent_journal::schema_table;

/// The revision a record creates, if it is a revision record.
pub fn revision_of(p: &Projection, env: &Envelope) -> Option<RevisionId> {
    match &env.record {
        Record::Committed { .. } => p.txns.get(&env.txn).map(|t| t.revision),
        Record::ObservedRevision { revision, .. }
        | Record::ConcurrentObservation { revision, .. }
        | Record::Gap { revision, .. } => Some(*revision),
        _ => None,
    }
}

/// The record that opens a rewritten journal: one generation past the
/// live one.
pub fn header(floor: u64) -> Envelope {
    let record = Record::JournalHeader {
        generation_floor: floor,
    };
    Envelope {
        schema_version: schema_table::label(&record),
        seq: floor,
        txn: TxnId(uuid::Uuid::nil()),
        at: 0,
        record,
        receipt: None,
    }
}

/// Transactions whose every record the rewrite drops, besides the victim
/// revision records themselves (which become tombstones). `Invariant` when
/// a victim is not a revision the projection knows.
fn dropped_txns(
    p: &Projection,
    victims: &BTreeSet<RevisionId>,
) -> Result<BTreeSet<TxnId>, TxnError> {
    let victim_txns = victims
        .iter()
        .map(|v| {
            p.revisions
                .get(v)
                .map(|m| m.txn)
                .ok_or_else(|| unknown_victim(*v))
        })
        .collect::<Result<BTreeSet<TxnId>, _>>()?;
    let resolved = p.txns.iter().filter_map(|(id, t)| match t.status {
        TxnStatus::Resolved { by } if victim_txns.contains(&by) => Some(*id),
        _ => None,
    });
    let mut out: BTreeSet<TxnId> = resolved.collect();
    out.extend(victim_txns);
    Ok(out)
}

fn unknown_victim(rev: RevisionId) -> TxnError {
    TxnError::Invariant(format!("victim {} is not a known revision", rev.0))
}

/// The live journal's records rewritten one at a time with the victims
/// collected, owning what it needs of the projection (a victim's revision
/// record is the one revision record of its transaction).
pub struct Rewrite {
    victims: BTreeMap<TxnId, RevisionMeta>,
    dropped: BTreeSet<TxnId>,
    pruned: BTreeSet<CommentId>,
}

impl Rewrite {
    /// `pruned` are deleted comment threads whose records are dropped.
    ///
    /// # Errors
    /// `Invariant` when a victim is not a revision the projection knows.
    pub fn new(
        p: &Projection,
        victims: &BTreeSet<RevisionId>,
        pruned: &BTreeSet<CommentId>,
    ) -> Result<Self, TxnError> {
        let dropped = dropped_txns(p, victims)?;
        let victims = victims
            .iter()
            .map(|v| {
                let m = p.revisions.get(v).ok_or_else(|| unknown_victim(*v))?;
                Ok((m.txn, m.clone()))
            })
            .collect::<Result<_, TxnError>>()?;
        Ok(Rewrite {
            victims,
            dropped,
            pruned: pruned.clone(),
        })
    }

    /// `env` as the rewrite keeps it: tombstoned, dropped (`None`) or as
    /// it is. A journal header is the caller's to replace.
    ///
    /// # Errors
    /// `Invariant` when a victim's transaction has a record that is not
    /// one the collector drops or tombstones, or when a revert's receipted
    /// decision (its own transaction, kept by `expected`) would be dropped.
    pub fn map(&self, env: Envelope) -> Result<Option<Envelope>, TxnError> {
        if CommentRecord::of(&env.record).is_some_and(|r| self.pruned.contains(&r.comment())) {
            return Ok(None);
        }
        let collected = self.victims.contains_key(&env.txn) || self.dropped.contains(&env.txn);
        if collected && env.receipt.is_some() && matches!(env.record, Record::ReviewDecision { .. })
        {
            return Err(TxnError::Invariant(
                "a revert's decision shares a collected transaction".into(),
            ));
        }
        let Some(m) = self.victims.get(&env.txn) else {
            return Ok((!self.dropped.contains(&env.txn)).then_some(env));
        };
        let effects: &ReviewEffects = match &env.record {
            Record::Committed { effects, .. } => effects,
            Record::ObservedRevision {
                revision, effects, ..
            }
            | Record::ConcurrentObservation {
                revision, effects, ..
            }
            | Record::Gap {
                revision, effects, ..
            } if *revision == m.id => effects,
            Record::Prepared { .. } | Record::PendingObservation { .. } => return Ok(None),
            _ => {
                return Err(TxnError::Invariant(
                    "victim is not a revision record".into(),
                ))
            }
        };
        Ok(Some(tombstone(m, &env, effects)))
    }
}

fn tombstone(m: &RevisionMeta, env: &Envelope, effects: &ReviewEffects) -> Envelope {
    let attached_to = match &m.review_op {
        ReviewOp::HunkRevert { hunk_id, .. } => Some(hunk_id.clone()),
        _ => None,
    };
    let record = Record::Tombstone {
        doc: m.doc,
        revision: m.id,
        parent: m.parent,
        actor: m.actor.clone(),
        preimage: m.preimage.clone(),
        postimage: m.postimage.clone(),
        review_op: m.review_op.clone(),
        hunks: effects.new_hunks.clone(),
        transitions: effects.transitions.clone(),
        attached_to,
        addresses: m.addresses.clone(),
    };
    Envelope {
        schema_version: schema_table::label(&record),
        seq: env.seq,
        txn: env.txn,
        at: env.at,
        record,
        // Receipts ride only on `prepared` and a revert's decision
        // (`admission::receipt`), never on the revision records a
        // tombstone replaces.
        receipt: None,
    }
}

/// The projection the rewrite must replay to: the live one with the
/// victims tombstoned, the dropped transactions and observations gone, and
/// the `pruned` comment threads gone with their receipts.
///
/// # Errors
/// `Invariant` when a victim is not a revision the projection knows;
/// `Corrupt` when the pruned threads exceed the comment physical usage.
pub fn expected(
    p: &Projection,
    victims: &BTreeSet<RevisionId>,
    pruned: &BTreeSet<CommentId>,
    floor: u64,
) -> Result<Projection, TxnError> {
    let dropped = dropped_txns(p, victims)?;
    let mut e = p.clone();
    e.generation = floor;
    for v in victims {
        if let Some(m) = e.revisions.get_mut(v) {
            m.collected = true;
            m.kind = RevisionKind::Tombstone;
        }
    }
    e.txns.retain(|id, _| !dropped.contains(id));
    e.observations.retain(|id, _| !dropped.contains(id));
    e.requests.retain(|_, r| {
        r.txn().is_none_or(|t| !dropped.contains(&t))
            && r.outcome.comment().is_none_or(|c| !pruned.contains(&c))
    });
    e.comments.prune(pruned)?;
    Ok(e)
}
