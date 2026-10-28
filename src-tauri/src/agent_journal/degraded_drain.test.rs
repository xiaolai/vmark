// WI-AL1.3 — the degraded-queue scheduling limitation recorded under ADR-AL2: global status reports any nonempty queue, a failed spawn plus a failed inline retry stays armed with no autonomous timer, recovery happens only on a later ensure (inline or a new drainer) or an existing drainer's adoption, reads never recover, restart loses the queued postimage, poisoning disarms, concurrent adoption lands one terminal record in order
//! Characterizes `degraded_drain`'s scheduler around the case its header
//! documents as a limitation. The spawn seam is thread-local, so parallel
//! tests never see each other's mode: it refuses, captures the job for the
//! test to run, or starts a real thread.

use std::cell::{Cell, RefCell};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use super::controlled::{commit_controlled, decode_prepare, prepare_controlled};
use super::degraded_drain::{drain, Backoff, DrainEnd, DrainScheduler};
use super::doc_registry::DocRegistry;
use super::legacy_import::LegacyImportReport;
use super::projection::TxnStatus;
use super::record::Record;
use super::service::{AgentJournalState, Started};
use super::service_gc::GcSummary;
use super::service_legacy::LegacyRetirement;
use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::writer::{OpenReport, Writer};

#[derive(Clone, Copy)]
enum SpawnMode {
    Refuse,
    Capture,
    Run,
}

type Job = Box<dyn FnOnce() + Send>;

thread_local! {
    static MODE: Cell<SpawnMode> = const { Cell::new(SpawnMode::Refuse) };
    static CAPTURED: RefCell<Vec<Job>> = const { RefCell::new(Vec::new()) };
}

fn seam(job: Job) -> std::io::Result<()> {
    match MODE.get() {
        SpawnMode::Refuse => Err(std::io::Error::other("no threads")),
        SpawnMode::Capture => {
            CAPTURED.with_borrow_mut(|c| c.push(job));
            Ok(())
        }
        SpawnMode::Run => {
            std::thread::spawn(job);
            Ok(())
        }
    }
}

fn fast() -> Backoff {
    Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    }
}

fn prepare(w: &Writer, docs: &DocRegistry, key: &str) -> super::controlled::ControlledPrepared {
    let parent = docs.resolve(key).ok().and_then(|d| w.head(d));
    let payload = serde_json::json!({
        "docKey": key, "parent": parent, "preimage": "", "actor": agent(), "tool": "document.write",
    });
    let req = decode_prepare(&serde_json::to_vec(&payload).unwrap()).unwrap();
    let doc = docs.resolve(&req.doc_key).unwrap();
    prepare_controlled(w, doc, req).unwrap()
}

/// Commit "x" with its append and the next retry's append failing, so the
/// committed record waits in the degraded queue through one inline retry.
fn queued_commit(w: &Writer, faults: &super::faults::Faults, docs: &DocRegistry) -> DocId {
    let p = prepare(w, docs, "k");
    faults.fail_next_appends(2);
    let body = serde_json::to_vec(&serde_json::json!({ "postimage": "x" })).unwrap();
    assert!(!commit_controlled(w, p.txn, &body).unwrap().durable);
    assert!(w.is_degraded(p.doc));
    p.doc
}

/// A thread cannot start and the inline retry fails too: armed, idle.
fn armed(w: &Arc<Writer>, faults: &super::faults::Faults) -> (DrainScheduler, DocId) {
    let doc = queued_commit(w, faults, &DocRegistry::default());
    let scheduler = DrainScheduler::with_spawn(fast(), seam);
    scheduler.ensure(w.clone(), doc);
    assert!(w.is_degraded(doc) && scheduler.is_armed(doc) && !scheduler.is_active(doc));
    (scheduler, doc)
}

fn ready_state(dir: &std::path::Path, writer: Arc<Writer>) -> AgentJournalState {
    let state = AgentJournalState::default();
    state.finish(Ok(Started {
        writer,
        journal_dir: dir.to_path_buf(),
        open: OpenReport::default(),
        legacy: Ok(LegacyImportReport::default()),
        retirement: LegacyRetirement::Absent,
        gc: GcSummary::default(),
    }));
    state
}

fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !done() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn global_status_is_degraded_while_any_queue_is_nonempty_even_with_a_healthy_writer() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let state = ready_state(dir.path(), w.clone());
    assert!(!state.status().degraded);
    let doc = queued_commit(&w, &faults, &DocRegistry::default());
    assert!(w.health().is_ok(), "a queued writer stays healthy to drain");
    assert!(state.status().degraded, "the queued record is not durable");
    assert_eq!(drain(&w, doc, fast(), |_| {}), DrainEnd::Drained);
    assert!(!state.status().degraded, "drained: durable again");
}

#[test]
fn a_later_ensure_on_the_same_document_recovers_it_inline() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let (scheduler, doc) = armed(&w, &faults);
    // The fault is gone; threads still cannot start.
    scheduler.ensure(w.clone(), doc);
    assert!(!w.is_degraded(doc), "the second inline retry landed it");
    assert!(!scheduler.is_armed(doc) && !scheduler.is_active(doc));
    assert_eq!(head_text(&w, doc), "x");
    assert_eq!(w.reservation(doc), None);
}

#[test]
fn an_existing_drainer_adopts_the_armed_queue_after_its_current_document() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let scheduler = DrainScheduler::with_spawn(fast(), seam);
    // A drainer for another document exists before the queue is armed.
    let other = DocId::new();
    MODE.set(SpawnMode::Capture);
    scheduler.ensure(w.clone(), other);
    MODE.set(SpawnMode::Refuse);
    let job = CAPTURED.with_borrow_mut(Vec::pop).expect("drainer job");
    let doc = queued_commit(&w, &faults, &DocRegistry::default());
    scheduler.ensure(w.clone(), doc);
    assert!(scheduler.is_armed(doc));
    job();
    assert!(
        !w.is_degraded(doc),
        "adopted and drained by the other drainer"
    );
    assert!(!scheduler.is_armed(doc) && !scheduler.is_active(doc));
    assert!(!scheduler.is_active(other));
    assert_eq!(head_text(&w, doc), "x");
}

#[test]
fn nothing_retries_an_armed_queue_while_idle_and_reads_do_not_recover_it() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let (scheduler, doc) = armed(&w, &faults);
    let state = ready_state(dir.path(), w.clone());
    // The fault is gone and many backoff periods pass.
    std::thread::sleep(Duration::from_millis(40));
    let _ = (w.snapshot(), w.generation(), w.head(doc), w.health());
    assert!(state.status().degraded);
    assert!(w.is_degraded(doc), "no autonomous timer");
    assert!(scheduler.is_armed(doc) && !scheduler.is_active(doc));
}

#[test]
fn a_restart_loses_the_queued_postimage_and_marks_the_prepare_uncommitted() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let (scheduler, doc) = armed(&w, &faults);
    let txn = w.reservation(doc).expect("still reserved").txn;
    drop(scheduler);
    drop(w);
    let (cfg, _) = config(
        dir.path(),
        crate::agent_journal::journal_file::SyncPolicy::None,
    );
    let (w, report) = Writer::open(cfg).expect("reopen");
    assert_eq!(report.uncommitted, vec![txn]);
    assert_eq!(w.snapshot().state.txns[&txn].status, TxnStatus::Uncommitted);
    assert_eq!(w.head(doc), None, "the lost commit is not reconstructed");
    assert!(!w.is_degraded(doc), "the queue was memory-only");
}

#[test]
fn a_poisoned_writer_is_not_armed_and_its_queue_stays() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let p = prepare(&w, &DocRegistry::default(), "k");
    faults.tear_next_append_after(3);
    faults.fail_next_truncates(1);
    let body = serde_json::to_vec(&serde_json::json!({ "postimage": "x" })).unwrap();
    assert!(!commit_controlled(&w, p.txn, &body).unwrap().durable);
    assert!(w.health().is_err(), "poisoned");
    let scheduler = DrainScheduler::with_spawn(fast(), seam);
    scheduler.ensure(w.clone(), p.doc);
    assert!(w.is_degraded(p.doc), "only a reopen clears it");
    assert!(!scheduler.is_armed(p.doc) && !scheduler.is_active(p.doc));
}

#[test]
fn concurrent_ensures_and_an_adopting_drainer_land_one_terminal_record_in_order() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let (scheduler, doc) = armed(&w, &faults);
    let txn = w.reservation(doc).expect("reserved").txn;
    // A save captured while the queue holds the document waits behind it.
    let saved = observe(&w, doc, "saved after x", None);
    MODE.set(SpawnMode::Capture);
    scheduler.ensure(w.clone(), DocId::new());
    MODE.set(SpawnMode::Refuse);
    let job = CAPTURED.with_borrow_mut(Vec::pop).expect("drainer job");
    let scheduler = Arc::new(scheduler);
    let start = Arc::new(Barrier::new(5));
    let mut threads = vec![{
        let start = start.clone();
        std::thread::spawn(move || {
            start.wait();
            job();
        })
    }];
    for _ in 0..4 {
        let (start, scheduler, w) = (start.clone(), scheduler.clone(), w.clone());
        threads.push(std::thread::spawn(move || {
            MODE.set(SpawnMode::Run);
            start.wait();
            scheduler.ensure(w, doc);
        }));
    }
    threads.into_iter().for_each(|t| t.join().unwrap());
    wait_until("the queue never settled", || {
        !w.is_degraded(doc) && !scheduler.is_active(doc) && w.pending_observations(doc).is_empty()
    });
    assert!(!scheduler.is_armed(doc));
    assert_eq!(w.reservation(doc), None);
    let records = w.debug_records();
    let at = |f: &dyn Fn(&super::record::Envelope) -> bool| {
        let hits: Vec<usize> = (0..records.len()).filter(|&i| f(&records[i])).collect();
        assert_eq!(hits.len(), 1, "exactly one such record");
        hits[0]
    };
    let committed = at(&|e| e.txn == txn && matches!(e.record, Record::Committed { .. }));
    let linearized = at(&|e| {
        e.txn == saved
            && matches!(
                e.record,
                Record::ObservedRevision { .. } | Record::ConcurrentObservation { .. }
            )
    });
    assert!(committed < linearized, "the queued commit lands first");
    assert_eq!(head_text(&w, doc), "saved after x");
}
