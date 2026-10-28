//! The one cleanup worker: after a page load starts, a window is destroyed
//! or a registration is replaced, it runs the sweep that ends what the
//! revoked pages owned.
//!
//! Key decisions:
//!   - One worker per process. Producers mark the work dirty, and only the
//!     producer that finds no worker running starts one; the worker runs
//!     passes until a check finds nothing dirty. Whether to exit is decided
//!     under the same lock that producers mark under, so an event either
//!     lands before that decision (and gets a pass) or finds the worker gone
//!     (and starts a new one).
//!   - The state is two booleans behind a leaf mutex. Nothing else is taken
//!     while it is held and nothing that can panic runs under it; a poisoned
//!     lock is used as it is, since any interleaving leaves two booleans
//!     valid.
//!   - The right to run is a claim guard. It is created when a producer
//!     marks the worker running, moves into the worker's task, and is
//!     disarmed only at the exit decision. Dropped armed (the task could not
//!     start, was dropped unrun, or a pass panicked), it marks the worker
//!     stopped with work pending and counts a failure. Nothing restarts it
//!     on its own: the next event does.
//!   - Passes run on the blocking pool, never on the main thread, and the
//!     producers never wait for them.
//!
//! @module agent_journal/admission/cleanup_worker

use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// One cleanup pass.
pub type Pass = Arc<dyn Fn() + Send + Sync>;

/// A worker's body, handed to the spawner.
pub type Job = Box<dyn FnOnce() + Send>;

/// Starts a worker's task (a seam: tests count and fail it).
pub type Spawn = Arc<dyn Fn(Job) -> io::Result<()> + Send + Sync>;

#[derive(Debug, Default)]
struct WorkerState {
    dirty: bool,
    running: bool,
}

/// Where a test may pause the worker or a producer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Point {
    /// A producer holds a claim and has not handed it to the spawner.
    BeforeSubmit,
    /// A pass returned; the exit decision has not been taken.
    AfterPass,
    /// The worker decided to exit and released the lock.
    AfterExit,
}

#[cfg(test)]
type PointHook = Arc<dyn Fn(Point) + Send + Sync>;

struct Shared {
    state: Mutex<WorkerState>,
    failures: AtomicU64,
    #[cfg(test)]
    hook: Mutex<Option<PointHook>>,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, WorkerState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Run the test hook, if any, at `point`. Never under the state lock.
    #[cfg_attr(not(test), allow(unused_variables))]
    fn at(&self, point: Point) {
        #[cfg(test)]
        {
            let hook = self
                .hook
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            if let Some(hook) = hook {
                hook(point);
            }
        }
    }
}

/// The right to run passes. Dropped armed, it marks the worker stopped
/// with work pending and counts a failure.
struct WorkerClaim {
    shared: Arc<Shared>,
    armed: bool,
}

impl Drop for WorkerClaim {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        {
            let mut s = self.shared.lock();
            s.running = false;
            s.dirty = true;
        }
        self.shared.failures.fetch_add(1, Ordering::Relaxed);
        log::error!("agent journal: the cleanup worker stopped before its exit; the next page event restarts it");
    }
}

/// The worker's body: passes until a check under the lock finds nothing
/// dirty, which is also where it gives up the right to run.
fn run(mut claim: WorkerClaim, pass: Pass) {
    loop {
        {
            let mut s = claim.shared.lock();
            if !s.dirty {
                s.running = false;
                claim.armed = false;
                break;
            }
            s.dirty = false;
        }
        pass();
        claim.shared.at(Point::AfterPass);
    }
    claim.shared.at(Point::AfterExit);
}

/// The process's cleanup worker.
pub struct CleanupWorker {
    shared: Arc<Shared>,
    spawn: Spawn,
}

impl Default for CleanupWorker {
    fn default() -> Self {
        Self::with_spawn(Arc::new(|job: Job| {
            tauri::async_runtime::spawn_blocking(job);
            Ok(())
        }))
    }
}

impl CleanupWorker {
    /// A worker whose tasks start through `spawn`.
    pub fn with_spawn(spawn: Spawn) -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(WorkerState::default()),
                failures: AtomicU64::new(0),
                #[cfg(test)]
                hook: Mutex::new(None),
            }),
            spawn,
        }
    }

    /// Something was revoked: make sure a pass runs after this call.
    pub fn signal(&self, pass: Pass) {
        let claim = {
            let mut s = self.shared.lock();
            s.dirty = true;
            if s.running {
                return;
            }
            s.running = true;
            WorkerClaim {
                shared: self.shared.clone(),
                armed: true,
            }
        };
        self.shared.at(Point::BeforeSubmit);
        if let Err(e) = (self.spawn)(Box::new(move || run(claim, pass))) {
            // The claim moved into the refused task and was dropped with it.
            log::error!("agent journal: cannot start the cleanup worker: {e}");
        }
    }

    /// Claims dropped without reaching their exit decision since launch.
    pub fn failures(&self) -> u64 {
        self.shared.failures.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    pub(crate) fn set_hook(&self, hook: Option<PointHook>) {
        *self
            .shared
            .hook
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = hook;
    }

    /// `(dirty, running)`.
    #[cfg(test)]
    pub(crate) fn state(&self) -> (bool, bool) {
        let s = self.shared.lock();
        (s.dirty, s.running)
    }

    /// Panic while holding the state lock, leaving it poisoned.
    #[cfg(test)]
    pub(crate) fn poison(&self) {
        let shared = self.shared.clone();
        let _ = std::thread::spawn(move || {
            let _held = shared.state.lock();
            panic!("poisoning the worker state");
        })
        .join();
        assert!(self.shared.state.is_poisoned());
    }
}
