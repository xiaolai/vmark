// WI-AL1.7 — the journal generation broadcast that drives live history
// updates across windows: every append (and a compaction's resync) reaches
// the forwarder, a burst is coalesced into one event carrying the latest
// generation, generations only rise, and a burst of 100 back-to-back writes
// (the DoD's 100 writes in a second; about 0.02 s run alone) all land with
// the last event naming the final generation. The burst's wall time is not
// asserted: under the parallel test runner it measures the other tests'
// load (it exceeded a second there), not the journal.
// Live updates are a status of their own: the running forwarder marks them
// ready, and a forwarder that never starts marks them failed (in the status
// every window reads) and broadcasts one invalidation so open panels re-read
// it and fall back to polling.
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::generation_events::{forward, GenerationEvent, GENERATION_EVENT};
use super::test_support::*;
use super::writer::JournalEvent;

#[test]
fn a_queued_burst_is_coalesced_into_one_event_with_the_latest_generation() {
    let (tx, rx) = mpsc::channel();
    for g in [3, 4, 5] {
        tx.send(JournalEvent::Resync { generation: g }).unwrap();
    }
    drop(tx);
    let mut seen = Vec::new();
    forward(&rx, || 7, |g| seen.push(g));
    assert_eq!(
        seen,
        vec![7],
        "three queued events, one emission of the writer's generation"
    );
}

/// A stream that never goes idle still emits: coalescing stops after a
/// bounded number of events, so the windows see progress during the stream.
#[test]
fn a_stream_that_never_idles_still_emits_at_a_bounded_interval() {
    let (tx, rx) = mpsc::channel();
    for g in 0..1000 {
        tx.send(JournalEvent::Resync { generation: g }).unwrap();
    }
    drop(tx);
    let mut seen = 0usize;
    forward(&rx, || 9, |_| seen += 1);
    let bound = super::generation_events::COALESCE_MAX;
    assert_eq!(
        seen,
        1000usize.div_ceil(bound),
        "one emission per {bound} events"
    );
}

#[test]
fn a_burst_of_100_rapid_writes_all_land_and_the_last_event_names_the_final_generation() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let w = Arc::new(w);
    let rx = w.subscribe();
    let weak = Arc::downgrade(&w);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let worker = std::thread::spawn(move || {
        forward(
            &rx,
            || weak.upgrade().map_or(0, |w| w.generation()),
            |g| sink.lock().unwrap().push(g),
        );
    });

    let doc = crate::agent_journal::ids::DocId::new();
    for i in 0..100 {
        snapshot_save(&w, doc, &format!("burst {i}"));
    }
    let final_generation = w.generation();
    let deadline = Instant::now() + Duration::from_secs(5);
    while seen.lock().unwrap().last() != Some(&final_generation) {
        assert!(
            Instant::now() < deadline,
            "the final generation was never emitted"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
    drop(w); // closes the subscription: the forwarder returns
    worker.join().unwrap();

    let seen = seen.lock().unwrap().clone();
    assert!(
        seen.windows(2).all(|p| p[0] <= p[1]),
        "generations never go back: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&final_generation));
    assert!(
        final_generation >= 200,
        "every save landed (observation + linearization each)"
    );
}

#[test]
fn the_event_payload_is_a_decimal_string_under_a_stable_name() {
    assert_eq!(GENERATION_EVENT, "agent-journal:generation");
    let v = serde_json::to_value(GenerationEvent::ready(18_446_744_073_709_551_615)).unwrap();
    assert_eq!(
        v,
        serde_json::json!({ "generation": "18446744073709551615" })
    );
    let v = serde_json::to_value(GenerationEvent::failed()).unwrap();
    assert_eq!(v, serde_json::json!({ "generation": null }));
}

#[test]
fn a_failed_append_is_announced_so_every_window_rereads_the_status() {
    use super::controller::Controller;
    use super::degraded_drain::{Backoff, DrainScheduler};
    use super::doc_registry::DocRegistry;
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let c = Controller::new(
        w.clone(),
        Arc::<DocRegistry>::default(),
        Arc::new(DrainScheduler::new(Backoff {
            first: Duration::from_secs(600),
            max: Duration::from_secs(600),
        })),
    );
    let rx = w.subscribe();
    faults.fail_next_appends(1);
    let p = serde_json::json!({
        "docKey": "path:/a.md", "parent": null, "preimage": "",
        "actor": { "type": "mcp", "principal": { "state": "anonymous" },
                   "connectionId": uuid::Uuid::new_v4().to_string() },
        "tool": "document.write",
    });
    assert!(c.prepare(&p.to_string()).is_err(), "the append failed");
    assert_eq!(
        rx.try_recv(),
        Ok(JournalEvent::HealthChanged),
        "a failed append reaches the broadcast though nothing was appended"
    );
}

mod forwarder_start {
    use std::cell::RefCell;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use crate::agent_journal::generation_events::{
        start_forwarder, Emit, ForwardJob, LiveUpdates, LiveUpdatesCell, SPAWN_ATTEMPTS,
    };
    use crate::agent_journal::service::{start, AgentJournalState, Phase};
    use crate::agent_journal::test_support::*;

    fn recorder() -> (Emit, Arc<Mutex<Vec<u64>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        (Arc::new(move |g| sink.lock().unwrap().push(g)), seen)
    }

    fn never_spawns(attempts: &mut u32) -> impl FnMut(ForwardJob) -> std::io::Result<()> + '_ {
        |_job: ForwardJob| {
            *attempts += 1;
            Err(std::io::Error::other("no threads left"))
        }
    }

    #[test]
    fn a_forwarder_that_never_starts_marks_live_updates_failed_and_invalidates_once() {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let w = Arc::new(w);
        snapshot_save(&w, crate::agent_journal::ids::DocId::new(), "x 中文");
        let (emit, seen) = recorder();
        let live = Arc::new(LiveUpdatesCell::default());
        assert_eq!(live.get(), LiveUpdates::Starting);
        let mut attempts = 0;
        let started = start_forwarder(
            &w,
            &emit,
            &live,
            Duration::ZERO,
            never_spawns(&mut attempts),
        );
        assert!(!started);
        assert_eq!(attempts, SPAWN_ATTEMPTS, "the spawn is retried, bounded");
        assert_eq!(live.get(), LiveUpdates::Failed, "the failure is observable");
        assert_eq!(
            *seen.lock().unwrap(),
            vec![w.generation()],
            "one direct invalidation, so open panels re-read the status"
        );
    }

    #[test]
    fn the_status_reports_failed_live_updates_beside_a_healthy_writer() {
        let state = AgentJournalState::default();
        assert_eq!(state.status().live_updates, LiveUpdates::Starting);
        let app_data = tmp();
        state.finish(start(app_data.path()));
        let writer = state.writer().expect("ready");
        assert_eq!(
            state.status().live_updates,
            LiveUpdates::Starting,
            "an opened writer alone does not mean live updates"
        );
        let (emit, _) = recorder();
        let mut attempts = 0;
        start_forwarder(
            &writer,
            &emit,
            state.live_updates(),
            Duration::ZERO,
            never_spawns(&mut attempts),
        );
        let status = state.status();
        assert_eq!(status.phase, Phase::Ready, "writer health stays separate");
        assert!(!status.degraded && !status.read_only);
        let v = serde_json::to_value(&status).unwrap();
        assert_eq!(v["phase"], "ready");
        assert_eq!(v["liveUpdates"], "failed");
    }

    #[test]
    fn a_journal_that_failed_to_start_has_no_live_updates() {
        let state = AgentJournalState::default();
        state.finish(Err("JOURNAL_IO: denied".to_string().into()));
        let v = serde_json::to_value(state.status()).unwrap();
        assert_eq!(v["liveUpdates"], "failed");
    }

    #[test]
    fn readiness_is_marked_by_the_started_forwarder_never_before_it_runs() {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let w = Arc::new(w);
        snapshot_save(&w, crate::agent_journal::ids::DocId::new(), "x 中文");
        let (emit, seen) = recorder();
        let live = Arc::new(LiveUpdatesCell::default());
        let held: RefCell<Option<ForwardJob>> = RefCell::new(None);
        let mut failures = 1;
        let started = start_forwarder(&w, &emit, &live, Duration::ZERO, |job| {
            if failures > 0 {
                failures -= 1;
                return Err(std::io::Error::other("transient"));
            }
            *held.borrow_mut() = Some(job);
            Ok(())
        });
        assert!(started, "a transient spawn failure is retried");
        assert!(
            seen.lock().unwrap().is_empty(),
            "not announced before the thread runs"
        );
        assert_eq!(
            live.get(),
            LiveUpdates::Starting,
            "not ready before it runs"
        );
        let generation = w.generation();
        let job = held.into_inner().expect("the job was handed over");
        let worker = std::thread::spawn(job);
        while seen.lock().unwrap().is_empty() {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(
            live.get(),
            LiveUpdates::Ready,
            "ready precedes the first event"
        );
        assert_eq!(
            seen.lock().unwrap()[0],
            generation,
            "ready names the generation"
        );
        drop(w); // closes the subscription: the forwarder returns
        worker.join().unwrap();
    }
}
