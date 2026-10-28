// WI-AL2.2h — the one cleanup worker (R89 as completed by R95): an event that lands while the worker is between its pass and its exit decision is served by that worker, an event after the exit starts a new one, concurrent producers never run two passes at once and a pass always follows the last event; a claim dropped armed (spawn refused, task dropped unrun, panic before submission, panicking pass) leaves the worker stopped with work pending and counted, and the next event restarts it; a poisoned state lock still claims; the status reports the failures; a thousand page loads and registrations while the writer lock is held start one worker and leave one label with one registration, and the pass after the release ends the owned transaction; the production spawner runs a pass off the caller's thread
//! Pause points come from the worker's test hook; an `active` gauge each
//! pass raises on entry and lowers on exit measures overlap.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use crate::agent_journal::admission::cleanup_worker::{CleanupWorker, Pass, Point};
use crate::agent_journal::admission::lifecycle_support::{
    life, thread_spawn, wait_idle, wait_until,
};
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::request_support::txn_of;
use crate::agent_journal::service::AgentJournalState;

#[derive(Default)]
struct Gauge {
    active: AtomicUsize,
    max: AtomicUsize,
    passes: AtomicUsize,
}

fn gauged(g: &Arc<Gauge>, inner: impl Fn() + Send + Sync + 'static) -> Pass {
    let g = g.clone();
    Arc::new(move || {
        let now = g.active.fetch_add(1, SeqCst) + 1;
        g.max.fetch_max(now, SeqCst);
        inner();
        g.passes.fetch_add(1, SeqCst);
        g.active.fetch_sub(1, SeqCst);
    })
}

fn worker() -> (Arc<CleanupWorker>, Arc<AtomicUsize>) {
    let spawns = Arc::new(AtomicUsize::new(0));
    (
        Arc::new(CleanupWorker::with_spawn(thread_spawn(spawns.clone()))),
        spawns,
    )
}

/// Pause the first arrival at `at`: it reports on the first channel and
/// waits for a send on the second.
fn pause_once(w: &CleanupWorker, at: Point) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (reached_tx, reached) = mpsc::channel();
    let (go, go_rx) = mpsc::channel::<()>();
    let once = Mutex::new(Some((reached_tx, go_rx)));
    w.set_hook(Some(Arc::new(move |p| {
        if p != at {
            return;
        }
        let taken = once.lock().unwrap().take();
        if let Some((reached, go)) = taken {
            reached.send(()).unwrap();
            go.recv().unwrap();
        }
    })));
    (reached, go)
}

const WAIT: std::time::Duration = std::time::Duration::from_secs(5);

#[test]
fn worker_exit_loses_reacquire_to_producer() {
    let (w, spawns) = worker();
    let g = Arc::new(Gauge::default());
    let (reached, go) = pause_once(&w, Point::AfterPass);
    w.signal(gauged(&g, || {}));
    reached.recv_timeout(WAIT).expect("paused after its pass");

    w.signal(gauged(&g, || {}));
    assert_eq!(spawns.load(SeqCst), 1, "the running worker is not doubled");
    assert_eq!(w.state(), (true, true));
    go.send(()).unwrap();
    wait_idle(&w);
    assert_eq!((g.passes.load(SeqCst), g.max.load(SeqCst)), (2, 1));
    assert_eq!(spawns.load(SeqCst), 1);
}

#[test]
fn producer_after_worker_exit_spawns_a_new_worker() {
    let (w, spawns) = worker();
    let g = Arc::new(Gauge::default());
    let (reached, go) = pause_once(&w, Point::AfterExit);
    w.signal(gauged(&g, || {}));
    reached.recv_timeout(WAIT).expect("decided to exit");
    assert_eq!(w.state(), (false, false), "the exit is decided");

    w.signal(gauged(&g, || {}));
    wait_until("the new worker's pass", || g.passes.load(SeqCst) == 2);
    assert_eq!(spawns.load(SeqCst), 2, "a new worker serves the event");
    go.send(()).unwrap();
    wait_idle(&w);
    assert_eq!((g.passes.load(SeqCst), g.max.load(SeqCst)), (2, 1));
}

#[test]
fn concurrent_producers_never_run_two_passes() {
    let (w, _) = worker();
    let g = Arc::new(Gauge::default());
    let events = Arc::new(AtomicUsize::new(0));
    let seen = Arc::new(AtomicUsize::new(0));
    let pass = {
        let (events, seen) = (events.clone(), seen.clone());
        gauged(&g, move || {
            seen.store(events.load(SeqCst), SeqCst);
        })
    };
    let producers: Vec<_> = (0..4)
        .map(|_| {
            let (w, events, pass) = (w.clone(), events.clone(), pass.clone());
            thread::spawn(move || {
                for _ in 0..10_000 {
                    events.fetch_add(1, SeqCst);
                    w.signal(pass.clone());
                }
            })
        })
        .collect();
    for p in producers {
        p.join().unwrap();
    }
    wait_idle(&w);
    assert_eq!(g.max.load(SeqCst), 1, "never two passes at once");
    assert_eq!(seen.load(SeqCst), 40_000, "a pass ran after the last event");
}

#[test]
fn a_panicking_pass_clears_running_and_the_next_event_restarts_it() {
    let (w, spawns) = worker();
    let g = Arc::new(Gauge::default());
    let first = Arc::new(AtomicBool::new(true));
    let pass = {
        let first = first.clone();
        gauged(&g, move || {
            if first.swap(false, SeqCst) {
                panic!("a failing pass");
            }
        })
    };
    w.signal(pass.clone());
    wait_until("the claim to drop", || w.failures() == 1);
    assert_eq!(w.state(), (true, false), "stopped, the work still pending");

    w.signal(pass);
    wait_idle(&w);
    assert_eq!((g.passes.load(SeqCst), spawns.load(SeqCst)), (1, 2));
}

#[test]
fn spawn_failure_rolls_back_worker_claim() {
    let spawns = Arc::new(AtomicUsize::new(0));
    let refuse = Arc::new(AtomicBool::new(true));
    let inner = thread_spawn(spawns.clone());
    let w = {
        let refuse = refuse.clone();
        CleanupWorker::with_spawn(Arc::new(move |job| {
            if refuse.swap(false, SeqCst) {
                drop(job);
                return Err(std::io::Error::other("no threads"));
            }
            inner(job)
        }))
    };
    let g = Arc::new(Gauge::default());
    w.signal(gauged(&g, || {}));
    assert_eq!(w.state(), (true, false), "rolled back, the work pending");
    assert_eq!((w.failures(), g.passes.load(SeqCst)), (1, 0));

    w.signal(gauged(&g, || {}));
    wait_idle(&w);
    assert_eq!((g.passes.load(SeqCst), spawns.load(SeqCst)), (1, 1));
}

#[test]
fn a_claim_dropped_unsubmitted_does_not_strand_running() {
    // A panic between the claim and the submission.
    let (w, spawns) = worker();
    let g = Arc::new(Gauge::default());
    let (reached, go) = pause_once(&w, Point::BeforeSubmit);
    drop((reached, go));
    let out = catch_unwind(AssertUnwindSafe(|| w.signal(gauged(&g, || {}))));
    assert!(out.is_err(), "the hook's channels are gone, so it panics");
    assert_eq!((w.state(), w.failures()), ((true, false), 1));
    w.set_hook(None);
    w.signal(gauged(&g, || {}));
    wait_idle(&w);
    assert_eq!((g.passes.load(SeqCst), spawns.load(SeqCst)), (1, 1));

    // A task the runtime dropped unrun (shutdown).
    let w = CleanupWorker::with_spawn(Arc::new(|job| {
        drop(job);
        Ok(())
    }));
    w.signal(gauged(&g, || {}));
    assert_eq!((w.state(), w.failures()), ((true, false), 1));
}

#[test]
fn panic_under_worker_state_lock_has_defined_disposition() {
    let (w, _) = worker();
    w.poison();
    let g = Arc::new(Gauge::default());
    w.signal(gauged(&g, || {}));
    wait_idle(&w);
    assert_eq!((g.passes.load(SeqCst), w.failures()), (1, 0));
}

#[test]
fn the_status_reports_cleanup_worker_failures() {
    let state = AgentJournalState::default();
    let json = serde_json::to_value(state.status()).unwrap();
    assert_eq!(json["cleanupWorkerFailures"], serde_json::json!(0));
    let w = state.cleanup.clone();
    w.set_hook(Some(Arc::new(|p| {
        if p == Point::BeforeSubmit {
            panic!("before submission");
        }
    })));
    let _ = catch_unwind(AssertUnwindSafe(|| w.signal(Arc::new(|| {}))));
    assert_eq!(state.status().cleanup_worker_failures, 1);
}

#[test]
fn writer_held_thousand_starteds_and_registers_schedule_one_worker_table_size_one() {
    let l = life();
    let a = l.r.page("doc-a", 1);
    let txn = txn_of(&l.r.prepare(&a, &l.r.p(&a, None, "text")).expect("prepare"));
    let g = l.r.c.writer.lock();
    for n in 0..1_000 {
        l.started("doc-a");
        l.r.register("doc-a", n + 2);
    }
    assert_eq!(l.r.pages.labels(), 1);
    assert_eq!(l.r.pages.registrations("doc-a"), 1);
    assert_eq!(l.spawns(), 1, "one worker, waiting on the writer lock");
    drop(g);
    l.idle();
    assert_eq!(l.ended(), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(l.spawns(), 1);
}

#[test]
fn the_production_spawner_runs_the_pass_off_the_callers_thread() {
    let w = CleanupWorker::default();
    let ran_on = Arc::new(Mutex::new(None));
    let pass: Pass = {
        let ran_on = ran_on.clone();
        Arc::new(move || *ran_on.lock().unwrap() = Some(thread::current().id()))
    };
    w.signal(pass);
    wait_idle(&w);
    let ran_on = ran_on.lock().unwrap().expect("the pass ran");
    assert_ne!(ran_on, thread::current().id(), "not inline on the caller");
}
