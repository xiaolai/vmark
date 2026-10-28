//! The collector (ADR-AL13) on the writer: plan over the pin projection,
//! rewrite the journal with the victims tombstoned, publish, then compact
//! the blob pack.
//!
//! It runs under the writer lock, so nothing appends meanwhile. It defers
//! (collects nothing, says why) while a document is reserved or has a
//! degraded queue — their records name revisions the plan cannot see — and
//! while a live window's base went unregistered past the window budget,
//! since that base would not be pinned.
//!
//! The journal is never held whole: the rewrite streams the live file
//! twice, record by record (`writer_gc_stream`), once to replay and once
//! to write.
//!
//! Order: replay the rewrite and compare it with the expected projection
//! (any difference refuses the collection, nothing written); require every
//! reachable blob stored (a missing one is `Corrupt`, not cleanup debt,
//! and nothing is written); rewrite the journal atomically; publish the replayed projection and broadcast
//! `Resync` at once, so readers learn of the collection even when the pack
//! compaction after it fails (the pack then keeps extra blobs, which only
//! costs space; the next collection or forget retries it, even one with
//! nothing to remove, because the pack itself shows what is unreached).
//! The startup pass (`collect_startup`) also prunes deleted comment
//! threads (`gc_compact`); an ordinary collection never does.
//! A deferred collection runs no plan: it reports its reason and no usage
//! warnings, and does not compact, since its roots may be incomplete.
//!
//! @module agent_journal/writer_gc

use std::collections::BTreeSet;

use serde::Serialize;

use crate::agent_journal::codec;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::gc_compact::{expected, header, revision_of, Rewrite};
use crate::agent_journal::gc_plan::{keep_set, plan};
pub use crate::agent_journal::gc_plan::{GcLimit, GcPolicy, GcWarning, GcWarningKind};
use crate::agent_journal::ids::{BlobHash, RevisionId};
use crate::agent_journal::projection::Projection;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V1};
use crate::agent_journal::writer::{Inner, JournalEvent, Writer};
use crate::agent_journal::writer_pins::{compute_pins, journal_pins, queued_roots};

#[path = "writer_gc_stream.rs"]
mod stream;

/// What one collection did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GcReport {
    /// Tombstoned revisions, in journal order.
    pub collected: Vec<RevisionId>,
    pub warnings: Vec<GcWarning>,
    /// Why nothing was collected this time, when the collector deferred.
    pub deferred: Option<String>,
    /// The pack compaction after a published collection failed (kept
    /// blobs are intact; unreferenced ones stay until the next run).
    pub blob_error: Option<String>,
}

fn deferral(g: &Inner) -> Option<String> {
    if !g.reservations.is_empty() {
        return Some("a document is reserved".into());
    }
    if g.degraded.values().any(|q| !q.is_empty()) {
        return Some("a document has queued records".into());
    }
    if g.unpinned_windows() {
        return Some("a window base is not pinned (window budget)".into());
    }
    None
}

/// Every blob the journal reaches, or `Corrupt` naming one the pack lost:
/// a cleanup around it would report success over a broken journal. The
/// finding sticks (`Inner::corrupt`): the writer refuses every later write
/// rather than keep reporting healthy over a journal it knows is broken.
fn reach(g: &mut Inner) -> Result<BTreeSet<BlobHash>, TxnError> {
    let keep = keep_set(&g.proj, &journal_pins(g));
    match keep.iter().find(|h| !g.blobs.contains(h)) {
        Some(h) => {
            let why = format!("blob {} is reachable but not stored", h.as_str());
            log::error!("agent journal: {why}; writes are refused until reopened");
            g.corrupt = Some(why.clone());
            Err(TxnError::Corrupt(why))
        }
        None => Ok(keep),
    }
}

/// Compact the pack to what the journal reaches, when it holds more.
/// The pack itself is the cleanup state: an earlier failed compaction is
/// retried by the next call, with no record of it kept. Returns the
/// compaction's recoverable failure.
///
/// # Errors
/// `Corrupt` when the pack misses a blob the journal reaches.
pub(crate) fn compact_unreached(g: &mut Inner) -> Result<Option<String>, TxnError> {
    // The journal's reach must be stored; a queued record's blob is kept
    // only if it already is.
    let mut keep = reach(g)?;
    let stored: Vec<_> = queued_roots(g)
        .into_iter()
        .filter(|h| g.blobs.contains(h))
        .collect();
    keep.extend(stored);
    if !g.blobs.holds_beyond(&keep) {
        return Ok(None);
    }
    match g.blobs.compact(&keep) {
        Ok(()) => Ok(None),
        Err(e @ TxnError::Corrupt(_)) => Err(e),
        Err(e) => {
            log::error!("agent journal: blob pack compaction failed: {e}");
            Ok(Some(e.to_string()))
        }
    }
}

/// One live record as a rewrite keeps it; the live header never is (the
/// rewrite writes its own).
type MapRecord<'a> = &'a dyn Fn(Envelope) -> Result<Option<Envelope>, TxnError>;

/// The top-level records a live record becomes: none for the header, an
/// `admission` frame's items each through `map` as top-level records with
/// their seq and receipt unchanged, anything else through `map`.
fn kept(map: MapRecord<'_>, env: Envelope) -> Result<Vec<Envelope>, TxnError> {
    match env.record {
        Record::JournalHeader { .. } => Ok(Vec::new()),
        Record::Admission { items } => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.extend(map(item)?);
            }
            Ok(out)
        }
        _ => Ok(map(env)?.into_iter().collect()),
    }
}

impl Writer {
    /// Replace the journal with a header at `floor` and every live record
    /// through `map`, streamed from the live file: replay it and require
    /// exactly `want`, and require every reachable blob stored (else
    /// nothing is written); rewrite atomically, publish and broadcast
    /// `Resync`, then compact the pack to what the new projection still
    /// reaches. Returns the pack compaction's recoverable failure, if
    /// any; the rewrite stands either way.
    ///
    /// # Errors
    /// The replay differs from `want`, a reachable blob is missing
    /// (`Corrupt`), or the rewrite failed (the old journal is then whole).
    pub(crate) fn publish_rewrite(
        &self,
        g: &mut Inner,
        map: MapRecord<'_>,
        want: &Projection,
        floor: u64,
    ) -> Result<Option<String>, TxnError> {
        let cap = self.faults.replay_reserve_cap();
        let mut replay = Projection::default();
        replay.apply(&header(floor))?;
        let positions = stream::each_record(g, cap, &mut |env| {
            kept(map, env)?.iter().try_for_each(|e| replay.apply(e))
        })?;
        // A rewrite the collector built is whole, or the collector erred.
        replay
            .finish_replay()
            .map_err(|e| TxnError::Invariant(format!("rewrite would not replay whole: {e}")))?;
        if &replay != want {
            log::error!("agent journal: a rewrite would change the projection; nothing written");
            return Err(TxnError::Invariant(
                "rewrite would change the projection".into(),
            ));
        }
        reach(g)?;
        let mut old = g.journal.open_reader()?;
        let mut first = Some(header(floor));
        let mut positions = positions.into_iter();
        let mut ready = std::collections::VecDeque::new();
        g.journal.rewrite_each(&mut || {
            if let Some(h) = first.take() {
                return Ok(Some(codec::encode(&h)));
            }
            loop {
                if let Some(env) = ready.pop_front() {
                    return Ok(Some(codec::encode(&env)));
                }
                let Some(at) = positions.next() else {
                    return Ok(None);
                };
                ready.extend(kept(map, stream::read_at(&mut old, at, cap)?)?);
            }
        })?;
        g.proj = replay;
        self.broadcast(JournalEvent::Resync { generation: floor });
        compact_unreached(g)
    }

    /// Collect what `policy` allows. See the module docs.
    ///
    /// # Errors
    /// The writer is corrupt or degraded, the journal cannot be read or
    /// rewritten, a reachable blob is missing (`Corrupt`), or the rewrite
    /// would not replay to the expected state.
    pub fn collect(&self, policy: &GcPolicy) -> Result<GcReport, TxnError> {
        self.collect_with(policy, false)
    }

    /// `collect`, also pruning every deleted comment thread (rewriting the
    /// journal even when no revision is collected). Only startup prunes:
    /// a request id retried after a restart is `staleIncarnation` before
    /// its receipt is read, so dropping the receipt loses no answer.
    ///
    /// # Errors
    /// As `collect`.
    pub fn collect_startup(&self, policy: &GcPolicy) -> Result<GcReport, TxnError> {
        self.collect_with(policy, true)
    }

    fn collect_with(&self, policy: &GcPolicy, prune: bool) -> Result<GcReport, TxnError> {
        let mut g = self.lock();
        g.healthy()?;
        let pins = compute_pins(&g);
        if let Some(why) = deferral(&g) {
            return Ok(GcReport {
                deferred: Some(why),
                ..GcReport::default()
            });
        }
        // A v1 record carries no provenance; rewriting it as a v2 tombstone
        // would drop the block it implies, so its revision stays.
        let mut exempt = BTreeSet::new();
        stream::each_record(&g, self.faults.replay_reserve_cap(), &mut |env| {
            if env.schema_version == SCHEMA_V1 {
                exempt.extend(revision_of(&g.proj, &env));
            }
            Ok(())
        })?;
        let p = plan(
            &g.proj,
            &pins,
            policy,
            &|h| g.blobs.size_of(h).unwrap_or(0),
            &exempt,
        );
        let mut report = GcReport {
            warnings: p.warnings,
            ..GcReport::default()
        };
        let pruned = if prune {
            g.proj.comments.deleted()
        } else {
            BTreeSet::new()
        };
        if p.victims.is_empty() && pruned.is_empty() {
            report.blob_error = compact_unreached(&mut g)?;
            return Ok(report);
        }
        let victims: BTreeSet<RevisionId> = p.victims.iter().copied().collect();
        let floor = g.next_generation()?;
        let rewrite = Rewrite::new(&g.proj, &victims, &pruned)?;
        let want = expected(&g.proj, &victims, &pruned, floor)?;
        report.blob_error = self.publish_rewrite(&mut g, &|env| rewrite.map(env), &want, floor)?;
        report.collected = p.victims;
        Ok(report)
    }
}

#[cfg(test)]
#[path = "blob_cleanup.test.rs"]
mod blob_cleanup_tests;
