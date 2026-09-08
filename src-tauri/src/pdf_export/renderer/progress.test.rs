// WI-FL6.2 — one stage sequence, on every platform, in one direction.
//
// The three backends emit progress from three different control shapes: a
// synchronous body (macOS), COM completion handlers (Windows), GLib signals
// (Linux). What must NOT differ is what the dialog sees. These tests pin the
// vocabulary against the frontend's map, and pin the sequencing rule under
// each platform's callback order — including the orders the platforms are
// documented to produce and that a naive emit would turn into a lie.
//
// A real webview is out of reach here; the pdf-smoke harness captures the
// same events on each platform's shipped backend and asserts the sequence.

use std::sync::{Arc, Mutex};

use super::*;

// ---------------------------------------------------------------------------
// Vocabulary — the wire must match src/export/PdfExportDialog.tsx `stageKeys`
// ---------------------------------------------------------------------------

/// The keys the dialog maps to translated labels. A stage missing from this
/// list shows the RAW key to the user, so the test reads them from the source
/// rather than trusting a copy here.
fn frontend_stage_keys() -> Vec<String> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let dialog = root.join("../src/export/PdfExportDialog.tsx");
    let source = std::fs::read_to_string(&dialog).expect("read PdfExportDialog.tsx");
    source
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            let (key, rest) = trimmed.split_once(':')?;
            rest.trim_start()
                .starts_with("\"pdf.progress.")
                .then(|| key.to_string())
        })
        .collect()
}

#[test]
fn every_stage_is_spelled_the_way_the_dialog_expects() {
    let keys = frontend_stage_keys();
    assert!(
        keys.len() >= PdfProgress::ALL.len(),
        "could not locate the stageKeys map — found {keys:?}"
    );
    for stage in PdfProgress::ALL {
        assert!(
            keys.iter().any(|k| k == stage.as_str()),
            "stage {:?} is emitted as {:?} but the dialog maps {keys:?}",
            stage,
            stage.as_str()
        );
    }
}

#[test]
fn the_wire_payload_is_a_stage_field_carrying_the_lowercase_name() {
    for stage in PdfProgress::ALL {
        let json = serde_json::to_string(&PdfProgressEvent { stage }).expect("serialize");
        assert_eq!(json, format!("{{\"stage\":\"{}\"}}", stage.as_str()));
        let back: PdfProgressEvent = serde_json::from_str(&json).expect("round trip");
        assert_eq!(back.stage, stage);
    }
}

#[test]
fn stages_are_ordered_as_the_pipeline_runs_them() {
    let mut sorted = PdfProgress::ALL;
    sorted.sort();
    assert_eq!(
        sorted,
        PdfProgress::ALL,
        "declaration order IS pipeline order"
    );
    assert_eq!(&PdfProgress::ALL[..3], &PdfProgress::RENDER[..]);
    assert_eq!(
        PdfProgress::ALL[3],
        PdfProgress::Done,
        "Done belongs to export_pdf"
    );
}

// ---------------------------------------------------------------------------
// The tracker — forward only, once each
// ---------------------------------------------------------------------------

#[test]
fn a_repeat_and_a_regression_are_both_refused() {
    let mut tracker = StageTracker::default();
    assert!(tracker.advance(PdfProgress::Loading));
    assert!(tracker.advance(PdfProgress::Rendering));
    assert!(!tracker.advance(PdfProgress::Rendering), "again");
    assert!(!tracker.advance(PdfProgress::Loading), "backwards");
    assert!(tracker.advance(PdfProgress::Finishing));
    assert!(tracker.advance(PdfProgress::Done));
    assert!(!tracker.advance(PdfProgress::Done));
}

#[test]
fn a_skipped_stage_is_still_forward_motion() {
    // A platform with no equivalent point for a stage must still be able to
    // emit the ones after it; the tracker enforces direction, not adjacency.
    let mut tracker = StageTracker::default();
    assert!(tracker.advance(PdfProgress::Rendering));
    assert!(!tracker.advance(PdfProgress::Loading));
    assert!(tracker.advance(PdfProgress::Done));
}

// ---------------------------------------------------------------------------
// The reporter — what each platform's callback order produces
// ---------------------------------------------------------------------------

fn capturing() -> (ProgressReporter, Arc<Mutex<Vec<PdfProgress>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink_seen = seen.clone();
    let reporter =
        ProgressReporter::with_sink(move |stage| sink_seen.lock().expect("lock").push(stage));
    (reporter, seen)
}

/// The calls a platform makes on the happy path, in the order its native
/// callbacks fire. Every platform reports the same three points: after the
/// webview is created (`Loading`), when the document has loaded and the
/// print starts (`Rendering`), when the print reports success (`Finishing`).
struct Pipeline {
    platform: &'static str,
    reports: &'static [PdfProgress],
    expected: &'static [PdfProgress],
}

const PIPELINES: &[Pipeline] = &[
    Pipeline {
        platform: "macos: synchronous body",
        reports: &[
            PdfProgress::Loading,
            PdfProgress::Rendering,
            PdfProgress::Finishing,
        ],
        expected: &PdfProgress::RENDER,
    },
    Pipeline {
        platform: "windows: NavigationCompleted then PrintToPdfCompleted",
        reports: &[
            PdfProgress::Loading,
            PdfProgress::Rendering,
            PdfProgress::Finishing,
        ],
        expected: &PdfProgress::RENDER,
    },
    Pipeline {
        platform: "linux: load-changed Finished then print finished",
        reports: &[
            PdfProgress::Loading,
            PdfProgress::Rendering,
            PdfProgress::Finishing,
        ],
        expected: &PdfProgress::RENDER,
    },
    Pipeline {
        // WebKitGTK emits `finished` after `failed`, and a load that failed
        // still reaches LoadEvent::Finished. A second report of an earlier or
        // equal stage must not reach the dialog.
        platform: "linux: finished after failed re-reports Finishing",
        reports: &[
            PdfProgress::Loading,
            PdfProgress::Rendering,
            PdfProgress::Finishing,
            PdfProgress::Finishing,
        ],
        expected: &PdfProgress::RENDER,
    },
    Pipeline {
        // A window that was built but whose navigation failed: the platform
        // reports Loading, then settles Err and never reports Rendering.
        platform: "windows: navigation failed",
        reports: &[PdfProgress::Loading],
        expected: &[PdfProgress::Loading],
    },
];

#[test]
fn each_platform_pipeline_yields_the_one_shared_sequence() {
    for case in PIPELINES {
        let (reporter, seen) = capturing();
        for &stage in case.reports {
            reporter.report(stage);
        }
        assert_eq!(
            seen.lock().expect("lock").as_slice(),
            case.expected,
            "{}",
            case.platform
        );
    }
}

#[test]
fn report_says_whether_the_stage_went_out() {
    let (reporter, seen) = capturing();
    assert!(reporter.report(PdfProgress::Loading));
    assert!(
        !reporter.report(PdfProgress::Loading),
        "dropped, not re-sent"
    );
    assert_eq!(seen.lock().expect("lock").len(), 1);
}

// ---------------------------------------------------------------------------
// Ordering and re-entrancy (#230, #231)
// ---------------------------------------------------------------------------

#[test]
fn a_sink_that_reports_from_inside_the_sink_neither_deadlocks_nor_reorders() {
    // The sink closure re-enters the reporter — what a lock held around the
    // sink would deadlock on. The re-entrant stage is queued and delivered
    // AFTER the one being emitted, so the order is still the pipeline's.
    use std::sync::OnceLock;
    let seen: Arc<Mutex<Vec<PdfProgress>>> = Arc::new(Mutex::new(Vec::new()));
    let slot: Arc<OnceLock<Arc<ProgressReporter>>> = Arc::new(OnceLock::new());
    let (sink_seen, sink_slot) = (seen.clone(), slot.clone());
    let reporter = Arc::new(ProgressReporter::with_sink(move |stage| {
        sink_seen.lock().expect("lock").push(stage);
        if stage == PdfProgress::Loading {
            let inner = sink_slot.get().expect("reporter installed").clone();
            assert!(inner.report(PdfProgress::Rendering), "queued, not refused");
        }
    }));
    assert!(slot.set(reporter.clone()).is_ok(), "first install");

    assert!(reporter.report(PdfProgress::Loading));
    assert_eq!(
        seen.lock().expect("lock").as_slice(),
        &[PdfProgress::Loading, PdfProgress::Rendering]
    );
    assert!(
        !reporter.report(PdfProgress::Rendering),
        "already delivered"
    );
    assert!(reporter.report(PdfProgress::Finishing));
}

#[test]
fn stages_accepted_on_two_threads_leave_in_acceptance_order() {
    // The sink is slow; a second thread reports the next stage while the
    // first is still inside the sink. Without the queue the second could be
    // emitted first, and the dialog would step backwards.
    use std::sync::Barrier;
    let seen: Arc<Mutex<Vec<PdfProgress>>> = Arc::new(Mutex::new(Vec::new()));
    let inside = Arc::new(Barrier::new(2));
    let (sink_seen, sink_inside) = (seen.clone(), inside.clone());
    let reporter = Arc::new(ProgressReporter::with_sink(move |stage| {
        if stage == PdfProgress::Loading {
            // Hold the sink open until the other thread has reported.
            sink_inside.wait();
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        sink_seen.lock().expect("lock").push(stage);
    }));
    let other = std::thread::spawn({
        let reporter = reporter.clone();
        let inside = inside.clone();
        move || {
            inside.wait();
            assert!(reporter.report(PdfProgress::Rendering), "accepted, queued");
        }
    });
    assert!(reporter.report(PdfProgress::Loading));
    other.join().expect("reporting thread");
    assert_eq!(
        seen.lock().expect("lock").as_slice(),
        &[PdfProgress::Loading, PdfProgress::Rendering]
    );
}

// #438 — closing must stop the DRAIN too, not only new acceptances. The sink
// runs with the lock released, so a stage can be accepted BEHIND the caller
// that is draining; without a check inside the loop that stage went out after
// `close`, i.e. after the outcome had been settled — the one thing closing
// exists to prevent. The sink here re-enters and then closes, which is what a
// settle landing mid-drain looks like from the reporter's side.
#[test]
fn a_close_while_a_drain_is_in_flight_drops_the_stages_still_queued() {
    use std::sync::{OnceLock, Weak};

    let seen = Arc::new(Mutex::new(Vec::new()));
    let handle: Arc<OnceLock<Weak<ProgressReporter>>> = Arc::new(OnceLock::new());
    let sink_seen = seen.clone();
    let sink_handle = handle.clone();
    let reporter = Arc::new(ProgressReporter::with_sink(move |stage| {
        sink_seen.lock().expect("lock").push(stage);
        if stage == PdfProgress::Loading {
            let me = sink_handle.get().and_then(Weak::upgrade).expect("reporter");
            // Accepted while the drain is in flight: it only joins the queue.
            assert!(me.report(PdfProgress::Rendering), "accepted, then queued");
            // …and the outcome settles before the drainer reaches it.
            me.close();
        }
    }));
    handle.set(Arc::downgrade(&reporter)).expect("set once");

    assert!(reporter.report(PdfProgress::Loading));
    assert_eq!(
        seen.lock().expect("lock").as_slice(),
        &[PdfProgress::Loading],
        "a stage queued behind the drain must not go out after the close"
    );
}

#[test]
fn a_closed_reporter_refuses_everything() {
    let (reporter, seen) = capturing();
    assert!(reporter.report(PdfProgress::Loading));
    reporter.close();
    assert!(!reporter.report(PdfProgress::Rendering));
    assert_eq!(
        seen.lock().expect("lock").as_slice(),
        &[PdfProgress::Loading]
    );
}
