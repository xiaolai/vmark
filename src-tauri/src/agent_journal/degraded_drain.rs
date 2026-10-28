//! Drains a document's degraded queue in the background, so a failed
//! `committed`, `aborted` or capture append lands (and releases its
//! reservation, and lets queued saves linearize) without a restart; it also
//! retries a pending save whose linearization failed to append. One drainer
//! per document; retries back off
//! exponentially to a cap; a poisoned writer stops the drainer, because
//! only a reopen can clear an ambiguous write failure. A drainer thread
//! that cannot start is replaced by one inline attempt.
//!
//! Known limitation (ADR-AL2): if a drainer thread cannot start and its
//! single inline retry also fails, retryable work remains armed without an
//! autonomous timer. A later `ensure` may retry it inline or start a
//! drainer; an existing drainer may adopt it after finishing its current
//! document. Status and history reads do not trigger recovery. Until a
//! queued record is appended successfully it is not durable (the global
//! status reports `degraded` while any queue is nonempty). Process exit
//! loses memory-only queued records; startup marks any durable unmatched
//! prepared transaction uncommitted and does not reconstruct its queued
//! postimage. Queued documents continue to refuse controlled mutations.
//!
//! @module agent_journal/degraded_drain

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::agent_journal::capture::linearize_pending;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::writer::Writer;

/// Retry pacing: `first` after the first failed retry, doubling to `max`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    pub first: Duration,
    pub max: Duration,
}

impl Default for Backoff {
    fn default() -> Self {
        Self {
            first: Duration::from_millis(50),
            max: Duration::from_secs(5),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DrainEnd {
    /// The queue is empty; every queued record landed in order.
    Drained,
    /// The writer can no longer append (poisoned, or a non-I/O failure).
    WriterStopped(TxnError),
}

/// Retry `doc`'s queue until it is empty or the writer stops, calling
/// `sleep` between failed attempts.
pub fn drain(
    w: &Writer,
    doc: DocId,
    backoff: Backoff,
    mut sleep: impl FnMut(Duration),
) -> DrainEnd {
    let mut delay = backoff.first;
    loop {
        if let Err(e) = w.health() {
            return DrainEnd::WriterStopped(e);
        }
        match w.retry_degraded(doc) {
            Ok(true) => return DrainEnd::Drained,
            Ok(false) => {
                sleep(delay);
                delay = (delay * 2).min(backoff.max);
            }
            Err(e) => return DrainEnd::WriterStopped(e),
        }
    }
}

/// A drainer's thread body, handed to the spawner.
type DrainJob = Box<dyn FnOnce() + Send>;

/// Starts a drainer's thread (a seam: tests make it fail).
type Spawn = fn(DrainJob) -> std::io::Result<()>;

fn spawn_thread(job: DrainJob) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("agent-journal-drain".into())
        .spawn(job)
        .map(|_| ())
}

/// Which documents have a drainer, and which still need one: a queue whose
/// thread could not start and whose inline attempt failed stays armed
/// until a drainer adopts it.
#[derive(Default)]
struct Drains {
    active: HashSet<DocId>,
    armed: HashMap<DocId, Arc<Writer>>,
}

impl Drains {
    /// Take one armed document no drainer holds, marking it active.
    fn adopt(&mut self) -> Option<(Arc<Writer>, DocId)> {
        let doc = *self.armed.keys().find(|d| !self.active.contains(d))?;
        let w = self.armed.remove(&doc)?;
        self.active.insert(doc);
        Some((w, doc))
    }
}

/// Starts at most one drainer thread per degraded document.
pub struct DrainScheduler {
    backoff: Backoff,
    drains: Arc<Mutex<Drains>>,
    spawn: Spawn,
}

impl Default for DrainScheduler {
    fn default() -> Self {
        Self::new(Backoff::default())
    }
}

impl DrainScheduler {
    pub fn new(backoff: Backoff) -> Self {
        Self {
            backoff,
            drains: Arc::default(),
            spawn: spawn_thread,
        }
    }

    /// A scheduler whose drainer threads start through `spawn` (tests).
    #[cfg(test)]
    pub fn with_spawn(backoff: Backoff, spawn: Spawn) -> Self {
        Self {
            spawn,
            ..Self::new(backoff)
        }
    }

    /// Whether a drainer is running for `doc` (tests wait on it).
    #[cfg(test)]
    pub fn is_active(&self, doc: DocId) -> bool {
        lock(&self.drains).active.contains(&doc)
    }

    /// Whether `doc`'s queue waits for a drainer to adopt it (tests).
    #[cfg(test)]
    pub fn is_armed(&self, doc: DocId) -> bool {
        lock(&self.drains).armed.contains_key(&doc)
    }

    /// Start a drainer for `doc` unless one is running. Idempotent. The
    /// drainer, once `doc` is done, adopts every armed queue in turn. A
    /// thread that cannot start is replaced by one drain attempt on the
    /// caller's thread (no backoff, so the caller is not held); what that
    /// attempt leaves stays armed with no timer of its own: a later
    /// `ensure` retries it, or a running drainer adopts it.
    pub fn ensure(&self, w: Arc<Writer>, doc: DocId) {
        let start = {
            let mut d = lock(&self.drains);
            if d.active.insert(doc) {
                d.armed.remove(&doc);
                Some((w, doc))
            } else {
                None
            }
        }
        .or_else(|| lock(&self.drains).adopt());
        let Some((w, doc)) = start else {
            return;
        };
        let (drains, backoff, writer) = (self.drains.clone(), self.backoff, w.clone());
        let job: DrainJob = Box::new(move || run_adopting(writer, doc, backoff, &drains));
        if let Err(e) = (self.spawn)(job) {
            log::error!(
                "agent journal: cannot start the degraded-queue drainer, draining once inline: {e}"
            );
            let still_needed = drain_once(&w, doc);
            let mut d = lock(&self.drains);
            d.active.remove(&doc);
            if still_needed {
                d.armed.insert(doc, w);
            }
        }
    }
}

/// One drain attempt and, once the queue is empty, one linearization of
/// the saves it held. `true` when a retry is still needed and can help
/// (the writer is healthy and something stays queued or unlinearized).
fn drain_once(w: &Writer, doc: DocId) -> bool {
    if w.health().is_err() {
        return false;
    }
    let retry = match w.retry_degraded(doc) {
        Ok(true) => linearize_pending(w, doc).retry,
        Ok(false) => {
            log::warn!("agent journal: the degraded queue is still waiting to drain");
            true
        }
        Err(e) => {
            log::error!("agent journal: degraded queue cannot drain until restart: {e}");
            return false;
        }
    };
    (retry || w.is_degraded(doc)) && w.health().is_ok()
}

/// Drain `doc`, then every armed queue no other drainer holds.
fn run_adopting(w: Arc<Writer>, doc: DocId, backoff: Backoff, drains: &Mutex<Drains>) {
    let mut next = Some((w, doc));
    while let Some((w, doc)) = next {
        run(&w, doc, backoff, drains);
        next = lock(drains).adopt();
    }
}

fn run(w: &Writer, doc: DocId, backoff: Backoff, drains: &Mutex<Drains>) {
    let mut delay = backoff.first;
    loop {
        match drain(w, doc, backoff, std::thread::sleep) {
            DrainEnd::Drained => {
                // Saves the queue was holding linearize now, not at the
                // next command; a linearization that failed to append is
                // retried on the same backoff.
                if linearize_pending(w, doc).retry && w.health().is_ok() {
                    std::thread::sleep(delay);
                    delay = (delay * 2).min(backoff.max);
                    continue;
                }
                // A record queued after the drain but before this check would
                // otherwise wait for the next command to notice it.
                let mut d = lock(drains);
                if !w.is_degraded(doc) {
                    d.active.remove(&doc);
                    return;
                }
            }
            DrainEnd::WriterStopped(e) => {
                log::error!("agent journal: degraded queue cannot drain until restart: {e}");
                lock(drains).active.remove(&doc);
                return;
            }
        }
    }
}

fn lock(m: &Mutex<Drains>) -> std::sync::MutexGuard<'_, Drains> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}
