// WI-PDF2.1 (prerequisite) — the outcome sink's two guarantees, plus the two
// that WI-FL6.2 (progress) and WI-FL6.3 (the shown phase) hang on them.
//
// The sink exists because Windows and Linux cannot produce a result before the
// UI closure must return (ADR-PDF6), so the outcome is settled from a native
// callback later. That makes two properties load-bearing that a synchronous
// return never needed.

use super::*;
use crate::pdf_export::renderer::progress::{PdfProgress, ProgressReporter};

fn sink_with_temp() -> (
    Arc<RenderSink>,
    PathBuf,
    oneshot::Receiver<Result<(), CommandError>>,
) {
    let (tx, rx) = oneshot::channel();
    let path = temp_path();
    // The bare shape — no reporter, no shown phase, no staging file — which
    // production never builds: a render always carries progress and a
    // dialog always has the phase. `build` is private; this module is its
    // child.
    (
        RenderSink::build(tx, None, None, path.clone(), None),
        path,
        rx,
    )
}

/// A staging path that is never written: the sink keeps a delivered `Ok`'s
/// staging file for the caller, and a file no test publishes would linger.
fn staging_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "vmark-sink-test-{}-{}.pdf",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ))
}

/// A UNIQUE path per call. Keying on `process::id()` alone gave all four
/// tests ONE path: each passed alone and they raced when run together,
/// because one test's settle/Drop removed the file another had just
/// written. Passing-in-isolation is the worst way for a test to be wrong.
fn temp_path() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "vmark-sink-test-{}-{}.html",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&path, b"<p>x</p>").expect("write temp");
    path
}

#[tokio::test]
async fn settling_delivers_the_result_and_removes_the_temp_file() {
    let (sink, path, rx) = sink_with_temp();
    assert!(path.exists(), "precondition: temp file written");

    sink.settle(Ok(()));

    assert!(rx.await.expect("sender alive").is_ok());
    assert!(!path.exists(), "the sink owns the temp file and drops it");
}

#[tokio::test]
async fn a_second_settle_is_ignored_rather_than_panicking() {
    // A platform that both returns an error AND fires its callback would
    // otherwise double-send. The first outcome must win.
    let (sink, _path, rx) = sink_with_temp();

    sink.settle(Err(CommandError::internal("first")));
    sink.settle(Ok(())); // must not panic, must not overwrite

    let err = rx
        .await
        .expect("sender alive")
        .expect_err("first outcome wins");
    assert_eq!(err.message(), "first");
}

#[tokio::test]
async fn dropping_without_settling_reports_immediately_instead_of_hanging() {
    // The case this guards: a native callback that is released without ever
    // firing. Without the Drop guard the caller waits out the entire timeout
    // for a result that can never arrive.
    let (sink, path, rx) = sink_with_temp();

    drop(sink);

    let err = rx.await.expect("sender alive").expect_err("abandoned");
    assert_eq!(err.code(), ErrorCode::Internal);
    assert_eq!(err.i18n_key(), Some("errors.pdf.abandoned"));
    assert!(
        !path.exists(),
        "the temp file is dropped on abandonment too"
    );
}

#[tokio::test]
async fn dropping_after_settling_does_not_overwrite_the_outcome() {
    let (sink, _path, rx) = sink_with_temp();
    sink.settle(Ok(()));
    drop(sink);
    assert!(
        rx.await.expect("sender alive").is_ok(),
        "the real outcome survives the drop"
    );
}

// ---------------------------------------------------------------------------
// Progress rides on settle-once (WI-FL6.2)
// ---------------------------------------------------------------------------

/// The stages a capturing reporter saw, in order.
type Seen = Arc<std::sync::Mutex<Vec<PdfProgress>>>;
/// The receiving end of a sink's outcome.
type OutcomeRx<T> = oneshot::Receiver<Result<T, CommandError>>;

fn progress_sink() -> (Arc<RenderSink>, Seen, OutcomeRx<()>) {
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink_seen = seen.clone();
    let reporter =
        ProgressReporter::with_sink(move |stage| sink_seen.lock().expect("lock").push(stage));
    let (tx, rx) = oneshot::channel();
    (
        RenderSink::with_progress(tx, temp_path(), staging_path(), reporter),
        seen,
        rx,
    )
}

#[tokio::test]
async fn stages_reported_before_settling_go_out_in_order() {
    let (sink, seen, rx) = progress_sink();
    for stage in PdfProgress::RENDER {
        sink.progress(stage);
    }
    sink.settle(Ok(()));
    assert!(rx.await.expect("sender alive").is_ok());
    assert_eq!(seen.lock().expect("lock").as_slice(), &PdfProgress::RENDER);
}

// #457 — the caller's timeout ends the report too. Windows's PrintToPdf
// completion still ran `progress(Finishing)` when it arrived after the wait
// had already reported a timeout, so the export dialog moved on to "finishing"
// on top of a failure the user had already been shown.
#[tokio::test]
async fn a_stage_reported_after_the_caller_gave_up_never_reaches_the_dialog() {
    let (sink, seen, _rx) = progress_sink();
    sink.progress(PdfProgress::Loading);
    assert_eq!(sink.abandon(), Abandoned::Marked);
    sink.progress(PdfProgress::Finishing);
    assert_eq!(
        seen.lock().expect("lock").as_slice(),
        &[PdfProgress::Loading],
        "nothing after the caller stopped waiting"
    );
}

// The same, for the race the claim exists to decide: the platform got there
// first, so the caller keeps waiting — but it has still reported its timeout
// for a render, and the reporter is closed either way.
#[tokio::test]
async fn a_claimed_render_reports_nothing_more_once_the_caller_has_given_up() {
    let (sink, seen, _rx) = progress_sink();
    assert!(sink.claim(), "the platform claims first");
    assert_eq!(sink.abandon(), Abandoned::Claimed);
    sink.progress(PdfProgress::Finishing);
    assert!(seen.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_stage_reported_after_settling_never_reaches_the_dialog() {
    // WebKitGTK fires `finished` after `failed`; the Linux handler reports
    // Finishing from `finished` unconditionally and relies on THIS.
    let (sink, seen, rx) = progress_sink();
    sink.progress(PdfProgress::Loading);
    sink.progress(PdfProgress::Rendering);
    sink.settle(Err(CommandError::io("print failed")));
    sink.progress(PdfProgress::Finishing);
    assert!(rx.await.expect("sender alive").is_err());
    assert_eq!(
        seen.lock().expect("lock").as_slice(),
        &[PdfProgress::Loading, PdfProgress::Rendering],
        "a failed render must not claim to be finishing"
    );
}

#[tokio::test]
async fn progress_on_a_sink_without_a_reporter_is_a_quiet_no_op() {
    let (sink, _path, _rx) = sink_with_temp();
    sink.progress(PdfProgress::Loading); // must not panic
}

// ---------------------------------------------------------------------------
// The shown phase (WI-FL6.3)
// ---------------------------------------------------------------------------

fn dialog_sink() -> (Arc<RenderSink<u8>>, oneshot::Receiver<()>, OutcomeRx<u8>) {
    let (tx, rx) = oneshot::channel();
    let (shown_tx, shown_rx) = oneshot::channel();
    (
        RenderSink::for_dialog(tx, shown_tx, temp_path()),
        shown_rx,
        rx,
    )
}

#[tokio::test]
async fn shown_fires_once_and_the_outcome_arrives_later() {
    let (sink, shown_rx, rx) = dialog_sink();
    sink.shown();
    sink.shown(); // a second call has nothing to send and must not panic
    assert!(shown_rx.await.is_ok(), "the phase ended with a value");
    sink.settle(Ok(7));
    assert_eq!(rx.await.expect("sender alive").expect("outcome"), 7);
}

#[tokio::test]
async fn settling_before_shown_closes_the_phase_so_nothing_waits_for_it() {
    // A load failure settles before any dialog exists. The bounded wait must
    // see the phase END, not sit out its full timeout for a dialog that will
    // never appear.
    let (sink, shown_rx, rx) = dialog_sink();
    sink.settle(Err(CommandError::io("load failed")));
    assert!(shown_rx.await.is_err(), "closed, not delivered");
    assert!(rx.await.expect("sender alive").is_err());
}

#[tokio::test]
async fn dropping_closes_the_phase_too() {
    let (sink, shown_rx, rx) = dialog_sink();
    drop(sink);
    assert!(shown_rx.await.is_err());
    assert_eq!(
        rx.await
            .expect("sender alive")
            .expect_err("abandoned")
            .i18n_key(),
        Some("errors.pdf.abandoned")
    );
}

// ---------------------------------------------------------------------------
// Re-entrancy (#231) and abandonment (#227)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_reporter_that_settles_the_sink_from_inside_does_not_deadlock() {
    // The reporter runs with the outcome lock RELEASED; a sink closure that
    // re-enters `settle` used to block on the lock `progress` still held.
    use std::sync::{Mutex, OnceLock, Weak};
    let slot: Arc<OnceLock<Weak<RenderSink>>> = Arc::new(OnceLock::new());
    let sink_slot = slot.clone();
    let reporter = ProgressReporter::with_sink(move |_stage| {
        if let Some(sink) = sink_slot.get().and_then(Weak::upgrade) {
            sink.settle(Ok(()));
        }
    });
    let (tx, rx) = oneshot::channel();
    let sink = RenderSink::with_progress(tx, temp_path(), staging_path(), reporter);
    assert!(slot.set(Arc::downgrade(&sink)).is_ok(), "installed once");

    let sink_thread = sink.clone();
    let done = Arc::new(Mutex::new(false));
    let done_thread = done.clone();
    // On a thread with a bound, so a deadlock fails the test instead of
    // hanging it.
    let worker = std::thread::spawn(move || {
        sink_thread.progress(PdfProgress::Loading);
        *done_thread.lock().expect("lock") = true;
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !*done.lock().expect("lock") {
        assert!(
            std::time::Instant::now() < deadline,
            "progress() deadlocked on a sink that settles from inside the reporter"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    worker.join().expect("worker");
    assert!(rx.await.expect("sender alive").is_ok());
}

#[tokio::test]
async fn abandoning_a_sink_refuses_the_platforms_claim_and_settling_still_cleans_up() {
    let (sink, path, rx) = sink_with_temp();
    assert_eq!(sink.abandon(), Abandoned::Marked);
    assert!(
        !sink.claim(),
        "the platform claims before showing UI, and finds the caller gone"
    );
    // A platform that is refused settles and closes; the temp file goes with
    // the settle exactly as before. The claim word itself is pinned in
    // `sink_phase.test.rs`.
    sink.settle(Err(CommandError::cancelled("abandoned")));
    assert!(rx.await.expect("sender alive").is_err());
    assert!(!path.exists());
}
