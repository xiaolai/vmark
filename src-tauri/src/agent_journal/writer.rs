//! The single journal writer.
//!
//! One `Mutex` serializes every append, so generation (= `seq`) is strictly
//! monotonic and a review-only decision can never interleave with another
//! append. Per document it holds at most one reservation: a controlled
//! mutation from `prepared` to its terminal record, or a maintenance
//! reservation for `discarded`. A terminal append that fails is not an
//! error to the caller once content changed: the record waits in the
//! document's degraded queue, the reservation stays, and `retry_degraded`
//! drains it in order. Every applied record is broadcast after the append.
//! An ambiguous write failure poisons the shared writer: controlled
//! mutations, decisions and linearization on every document are refused
//! with `JOURNAL_DEGRADED` until reopen; captures still queue in memory.
//!
//! Operations live in `writer_txn` (prepare/commit/abort/discard),
//! `writer_observe`, `writer_review`, `writer_degraded`, `writer_pins` and
//! `writer_legacy` (legacy import plus test seams); streaming startup replay
//! in `writer_replay`; read accessors in `writer_reads`.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};

use crate::agent_journal::admission::identity::Incarnation;
use crate::agent_journal::admission::requests::Requests;
use crate::agent_journal::blob_store::BlobStore;
use crate::agent_journal::capture_seq::CaptureSeqs;
use crate::agent_journal::codec;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::journal_file::{
    create_dir_durable, JournalFile, SyncPolicy, JOURNAL_FILE,
};
use crate::agent_journal::projection::{Projection, TxnStatus};
use crate::agent_journal::record::{Envelope, ObservedRef, Record, MAX_SUPPORTED_SCHEMA};
use crate::agent_journal::schema_table;
use crate::agent_journal::writer_degraded::Queued;
use replay::Replay;

pub use crate::agent_journal::writer_budget::RetentionBudget;

#[path = "certificate.rs"]
pub mod certificate;
#[path = "writer_replay.rs"]
mod replay;
pub use crate::agent_journal::writer_observe::{
    Journaled, LinearizeRequest, Linearized, ObserveOutcome, ObserveRequest,
};
pub use crate::agent_journal::writer_review::ReviewRequest;
use crate::agent_journal::writer_types::now_ms;
pub use crate::agent_journal::writer_types::{
    CommitOutcome, CommitRequest, Durability, JournalEvent, OpenReport, PrepareRequest, Prepared,
    Reservation, Snapshot, WriterConfig,
};
pub use crate::agent_journal::writer_window::linearization_window;
#[cfg(test)]
pub use crate::agent_journal::writer_wire::ObserveReply;

pub(crate) struct Inner {
    pub(crate) journal: JournalFile,
    pub(crate) blobs: BlobStore,
    pub(crate) proj: Projection,
    pub(crate) reservations: HashMap<DocId, Reservation>,
    pub(crate) degraded: HashMap<DocId, VecDeque<Queued>>,
    pub(crate) window_bases: BTreeMap<String, (DocId, ObservedRef)>,
    pub(crate) external: BTreeSet<RevisionId>,
    pub(crate) budget: RetentionBudget,
    /// Window names released, newest last, at most `budget.window_bases`.
    pub(crate) released: VecDeque<String>,
    /// Live windows whose base went unregistered past the window budget,
    /// at most `budget.window_bases`; past that, the app window labels they
    /// belong to (`unpinned_labels`, cleared when that window is destroyed),
    /// and past that too, `unpinned_overflow`, which holds until the live
    /// app windows fit the budget (`reconcile_live_windows` then turns it
    /// into their labels). While any holds, the collector defers: such a
    /// base is not pinned.
    pub(crate) unpinned: BTreeSet<String>,
    pub(crate) unpinned_labels: BTreeSet<String>,
    pub(crate) unpinned_overflow: bool,
    /// Set when a pass finds the journal corrupt (a reachable blob the pack
    /// lost); every later write is refused until the journal is reopened.
    pub(crate) corrupt: Option<String>,
    /// The last capture seq per session (`capture_seq`); in memory only.
    pub(crate) capture_seqs: CaptureSeqs,
    /// Certificates that fell back to a barrier since open (`certificate`).
    pub(crate) uncertified_fallbacks: u64,
    /// Request ids in flight or fenced, and transaction owners (`requests`).
    pub(crate) requests: Requests,
    /// The addresses of each open prepare, until its terminal record.
    pub(crate) addresses: HashMap<TxnId, Vec<CommentId>>,
}

impl Inner {
    /// an ambiguous write failure (fsync, or truncate-back after a
    /// partial write) poisons a file; the whole writer is then degraded for
    /// every document until it is reopened.
    pub(crate) fn healthy(&self) -> Result<(), TxnError> {
        if let Some(why) = &self.corrupt {
            return Err(TxnError::Corrupt(why.clone()));
        }
        if self.journal.is_poisoned() || self.blobs.is_poisoned() {
            return Err(TxnError::JournalDegraded);
        }
        Ok(())
    }

    /// The one persistence boundary, checked before every append: nothing
    /// is written while the writer is corrupt or either file is poisoned.
    /// Poison is `Io`, the class a failed append already has, so captures
    /// and terminal records queue and the drainer stops with order kept.
    pub(crate) fn persistable(&self) -> Result<(), TxnError> {
        if let Some(why) = &self.corrupt {
            return Err(TxnError::Corrupt(why.clone()));
        }
        if self.journal.is_poisoned() || self.blobs.is_poisoned() {
            return Err(TxnError::Io(
                "writer poisoned by an earlier ambiguous failure; nothing persists until reopen"
                    .into(),
            ));
        }
        Ok(())
    }

    pub(crate) fn not_busy(&self, doc: DocId) -> Result<(), TxnError> {
        if self.degraded.get(&doc).is_some_and(|q| !q.is_empty()) {
            return Err(TxnError::JournalDegraded);
        }
        match self.reservations.get(&doc) {
            Some(r) => Err(TxnError::JournalBusy { holder: r.txn }),
            None => Ok(()),
        }
    }
}

pub struct Writer {
    pub(crate) inner: Mutex<Inner>,
    subscribers: Mutex<Vec<mpsc::Sender<JournalEvent>>>,
    pub(crate) faults: Arc<Faults>,
    /// Fixed at open; read without the lock (`admission::identity`).
    pub(crate) incarnation: Incarnation,
}

impl Writer {
    /// Recover the journal (torn tail truncated, records replayed), then
    /// append `uncommitted` for every `prepared` left open and
    /// `epochUnclosed` for every epoch left armed. A failure to append those
    /// is fatal: starting without them would leave unresolved transactions
    /// that no reservation guards, or maps that lost operations.
    pub fn open(cfg: WriterConfig) -> Result<(Self, OpenReport), TxnError> {
        Self::open_with_max_schema(cfg, MAX_SUPPORTED_SCHEMA)
    }

    /// `open` as a build that reads schemas `1..=max` only. A record newer
    /// than `max` refuses the open as `FUTURE_FORMAT` before anything is
    /// truncated, repaired or appended (both files stay byte-identical).
    #[doc(hidden)]
    pub fn open_with_max_schema(
        cfg: WriterConfig,
        max: u32,
    ) -> Result<(Self, OpenReport), TxnError> {
        create_dir_durable(&cfg.dir, cfg.sync == SyncPolicy::Full)?;
        let path = cfg.dir.join(JOURNAL_FILE);
        let mut replay = Replay::new(max, &cfg.faults);
        let scanned = JournalFile::open_stream(&path, cfg.sync, cfg.faults.clone(), &mut replay);
        let (journal, truncated_tail_bytes) = replay.finish(scanned)?;
        let blobs = BlobStore::open(&cfg.dir, cfg.sync, cfg.faults.clone())?;
        let mut report = OpenReport {
            truncated_tail_bytes,
            ..Default::default()
        };
        let Replay { proj, .. } = replay;
        let open_txns: Vec<TxnId> = proj
            .txns
            .iter()
            .filter(|(_, t)| t.status == TxnStatus::Prepared)
            .map(|(id, _)| *id)
            .collect();
        let w = Writer {
            inner: Mutex::new(Inner {
                journal,
                blobs,
                proj,
                reservations: HashMap::new(),
                degraded: HashMap::new(),
                window_bases: BTreeMap::new(),
                external: BTreeSet::new(),
                budget: RetentionBudget::default(),
                released: VecDeque::new(),
                unpinned: BTreeSet::new(),
                unpinned_labels: BTreeSet::new(),
                unpinned_overflow: false,
                corrupt: None,
                capture_seqs: CaptureSeqs::default(),
                uncertified_fallbacks: 0,
                requests: Requests::default(),
                addresses: HashMap::new(),
            }),
            subscribers: Mutex::new(Vec::new()),
            faults: cfg.faults,
            incarnation: Incarnation::fresh(),
        };
        {
            let mut g = w.lock();
            for txn in open_txns {
                w.append(&mut g, txn, Record::Uncommitted, &[])?;
                report.uncommitted.push(txn);
            }
            let armed: Vec<(DocId, u64)> = g
                .proj
                .docs
                .iter()
                .filter_map(|(d, s)| s.epoch.open.map(|e| (*d, e)))
                .collect();
            for (doc, epoch) in armed {
                w.append(
                    &mut g,
                    TxnId::new(),
                    Record::EpochUnclosed { doc, epoch },
                    &[],
                )?;
                report.unclosed_epochs.push((doc, epoch));
            }
            report.pending_observations = g.proj.docs.values().map(|d| d.pending.len()).sum();
        }
        Ok((w, report))
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, Inner> {
        self.faults.before_lock();
        self.inner.lock().expect("writer lock poisoned by a panic")
    }

    /// Put blobs, append the record, apply it, broadcast it. A failure is
    /// broadcast too (`HealthChanged`): it appends nothing, but it can poison
    /// the writer or queue a document's record, which every window shows.
    pub(crate) fn append(
        &self,
        inner: &mut Inner,
        txn: TxnId,
        record: Record,
        blobs: &[(&BlobHash, &str)],
    ) -> Result<Envelope, TxnError> {
        let out = self.append_unannounced(inner, txn, record, blobs);
        if out.is_err() {
            self.broadcast(JournalEvent::HealthChanged);
        }
        out
    }

    fn append_unannounced(
        &self,
        inner: &mut Inner,
        txn: TxnId,
        record: Record,
        blobs: &[(&BlobHash, &str)],
    ) -> Result<Envelope, TxnError> {
        inner.persistable()?;
        let seq = inner.next_generation()?;
        for (hash, text) in blobs {
            inner.blobs.put(hash, text)?;
        }
        let env = Envelope {
            schema_version: schema_table::label(&record),
            seq,
            txn,
            at: now_ms(),
            record,
            receipt: None,
        };
        self.faults.run_hook(&env);
        inner.journal.append_record(&codec::encode(&env))?;
        if let Err(e) = inner.proj.apply(&env) {
            // Validated before the append, so this is a writer bug: stop.
            inner.journal.poison();
            return Err(TxnError::Corrupt(format!(
                "appended record failed to apply: {e}"
            )));
        }
        self.broadcast(JournalEvent::Appended(Box::new(env.clone())));
        Ok(env)
    }

    pub(crate) fn broadcast(&self, event: JournalEvent) {
        if self.faults.take_broadcast_drop() {
            return;
        }
        let mut subs = self.subscribers.lock().expect("subscriber lock");
        subs.retain(|tx| tx.send(event.clone()).is_ok());
    }

    /// Subscribe before taking a snapshot (see `hydration`).
    pub fn subscribe(&self) -> mpsc::Receiver<JournalEvent> {
        let (tx, rx) = mpsc::channel();
        self.subscribers.lock().expect("subscriber lock").push(tx);
        rx
    }
}
