// WI-AL2.2h — shared helpers for the page-lifecycle tests: a request rig beside a cleanup worker whose tasks run on counted plain threads, a pass that is the production sweep pass with its outcomes recorded, the page-load, destroy and replacing-registration entries driven through that worker, and waits for the worker to go idle
//! Helpers only; the cases live in `cleanup_worker`, `page_lifecycle`
//! and `owner_death`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::agent_journal::admission::cleanup_worker::{CleanupWorker, Job, Pass, Spawn};
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::page_events::{
    page_destroyed, page_started, register_page, sweep_pass,
};
use crate::agent_journal::admission::request_support::{ident, rig, Page, Rig};
use crate::agent_journal::ids::TxnId;

/// A spawner that starts each task on its own thread and counts it.
pub(crate) fn thread_spawn(spawns: Arc<AtomicUsize>) -> Spawn {
    Arc::new(move |job| {
        spawns.fetch_add(1, Ordering::SeqCst);
        std::thread::Builder::new()
            .name("test-cleanup-worker".into())
            .spawn(job)
            .map(|_| ())
    })
}

/// Wait until `done` holds, failing after five seconds.
pub(crate) fn wait_until(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting: {what}");
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// Wait until no work is pending and no worker runs.
pub(crate) fn wait_idle(w: &CleanupWorker) {
    wait_until("the cleanup worker to go idle", || {
        w.state() == (false, false)
    });
}

/// A request rig and the cleanup worker its page events signal.
pub(crate) struct Life {
    pub r: Rig,
    pub worker: Arc<CleanupWorker>,
    pub spawns: Arc<AtomicUsize>,
    ended: Arc<Mutex<Vec<(TxnId, OwnedEnd)>>>,
    held: Arc<Mutex<Vec<Job>>>,
}

pub(crate) fn life() -> Life {
    life_over(rig())
}

pub(crate) fn life_over(r: Rig) -> Life {
    let spawns = Arc::new(AtomicUsize::new(0));
    Life {
        r,
        worker: Arc::new(CleanupWorker::with_spawn(thread_spawn(spawns.clone()))),
        spawns,
        ended: Arc::default(),
        held: Arc::default(),
    }
}

/// A life whose worker tasks are held until `run_held`, so a test can act
/// between a revocation and the pass that follows it.
pub(crate) fn life_held() -> Life {
    let spawns = Arc::new(AtomicUsize::new(0));
    let held: Arc<Mutex<Vec<Job>>> = Arc::default();
    let spawn: Spawn = {
        let (spawns, held) = (spawns.clone(), held.clone());
        Arc::new(move |job| {
            spawns.fetch_add(1, Ordering::SeqCst);
            held.lock().expect("held jobs").push(job);
            Ok(())
        })
    };
    Life {
        r: rig(),
        worker: Arc::new(CleanupWorker::with_spawn(spawn)),
        spawns,
        ended: Arc::default(),
        held,
    }
}

/// A life whose worker runs each task inline, on the producer's thread,
/// so the pass sees exactly what the entry had done before it signalled.
pub(crate) fn life_inline() -> Life {
    let spawns = Arc::new(AtomicUsize::new(0));
    let spawn: Spawn = {
        let spawns = spawns.clone();
        Arc::new(move |job| {
            spawns.fetch_add(1, Ordering::SeqCst);
            job();
            Ok(())
        })
    };
    Life {
        r: rig(),
        worker: Arc::new(CleanupWorker::with_spawn(spawn)),
        spawns,
        ended: Arc::default(),
        held: Arc::default(),
    }
}

impl Life {
    /// The production pass over this rig's controller, recording outcomes.
    pub(crate) fn pass(&self) -> Pass {
        let (c, pages, ended) = (self.r.c.clone(), self.r.pages.clone(), self.ended.clone());
        Arc::new(move || {
            let out = sweep_pass(Some(c.clone()), &pages);
            ended.lock().expect("outcomes").extend(out);
        })
    }

    /// A page load started in `label` (the hook's entry).
    pub(crate) fn started(&self, label: &str) {
        page_started(&self.r.pages, &self.worker, label, self.pass());
    }

    /// `label`'s window was destroyed (the destroy trigger's entry).
    pub(crate) fn destroyed(&self, label: &str) {
        page_destroyed(&self.r.pages, &self.worker, label, self.pass());
    }

    /// Register page `n` under `label`, replacing `old`.
    pub(crate) fn replace(&self, old: &Page, n: u32) -> Page {
        let reg = register_page(
            &self.r.pages,
            &self.worker,
            Some(&self.r.c.writer),
            &old.label,
            &ident(n),
            Some((&old.identity, &old.generation)),
            self.pass(),
        )
        .expect("replace");
        Page {
            label: old.label.clone(),
            identity: reg.page_identity.to_string(),
            generation: reg.webview_generation.to_string(),
        }
    }

    /// Run the held worker tasks on this thread, in order.
    pub(crate) fn run_held(&self) {
        let jobs = std::mem::take(&mut *self.held.lock().expect("held jobs"));
        for job in jobs {
            job();
        }
    }

    pub(crate) fn idle(&self) {
        wait_idle(&self.worker);
    }

    /// Every outcome the passes so far reported, in order.
    pub(crate) fn ended(&self) -> Vec<(TxnId, OwnedEnd)> {
        self.ended.lock().expect("outcomes").clone()
    }

    /// The rig, once the worker is idle (to reopen its writer).
    pub(crate) fn into_rig(self) -> Rig {
        self.idle();
        self.r
    }

    pub(crate) fn spawns(&self) -> usize {
        self.spawns.load(Ordering::SeqCst)
    }
}
