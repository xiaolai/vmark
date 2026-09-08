// #220, #224, #227 — the two wait policies, driven without a platform: a
// render that publishes only a delivered success and discards a late one,
// and a dialog whose timeout defers to a platform that won the race.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::pdf_export::renderer::progress::ProgressReporter;

const BOUND: Duration = Duration::from_millis(40);
const LONG: Duration = Duration::from_secs(5);

fn temp_file(tag: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "vmark-wait-{tag}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&path, b"%PDF-x").expect("write temp");
    path
}

/// A render-shaped sink over real files, plus the output the caller wants.
fn render_fixture() -> (Arc<RenderSink>, OutcomeRx<()>, PathBuf, PathBuf) {
    let (tx, rx) = oneshot::channel();
    let staging = temp_file("staging.pdf");
    let output = std::env::temp_dir().join(format!(
        "vmark-wait-out-{}-{}.pdf",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    let sink = RenderSink::with_progress(
        tx,
        temp_file("doc.html"),
        staging.clone(),
        ProgressReporter::with_sink(|_| {}),
    );
    (sink, rx, staging, output)
}

fn dialog_fixture() -> (Arc<RenderSink<u8>>, oneshot::Receiver<()>, OutcomeRx<u8>) {
    let (tx, rx) = oneshot::channel();
    let (shown_tx, shown_rx) = oneshot::channel();
    (
        RenderSink::for_dialog(tx, shown_tx, temp_file("doc.html")),
        shown_rx,
        rx,
    )
}

// ---------------------------------------------------------------------------
// settle_render
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_delivered_success_is_published_onto_the_output() {
    let (sink, rx, staging, output) = render_fixture();
    sink.settle(Ok(()));
    settle_render(&sink, rx, &staging, &output, LONG)
        .await
        .expect("published");
    assert!(output.exists(), "the output appears only now, complete");
    assert!(!staging.exists(), "moved, not copied");
    let _ = std::fs::remove_file(&output);
}

#[tokio::test]
async fn a_delivered_failure_propagates_and_leaves_no_files() {
    let (sink, rx, staging, output) = render_fixture();
    sink.settle(Err(CommandError::io("print failed")));
    let err = settle_render(&sink, rx, &staging, &output, LONG)
        .await
        .expect_err("the platform's error");
    assert_eq!(err.code(), ErrorCode::Io);
    assert!(!staging.exists());
    assert!(
        !output.exists(),
        "a failed render never touches the output path"
    );
}

#[tokio::test]
async fn a_timeout_abandons_the_render_and_a_late_result_is_discarded() {
    // The case #224 names: the caller reported failure at the bound, the
    // platform finished afterwards. The output path must stay untouched and
    // the staging file must not linger.
    let (sink, rx, staging, output) = render_fixture();
    let err = settle_render(&sink, rx, &staging, &output, BOUND)
        .await
        .expect_err("nothing settled within the bound");
    assert_eq!(err.code(), ErrorCode::Timeout);
    assert_eq!(err.i18n_key(), Some("errors.pdf.exportTimeout"));
    assert!(
        !sink.claim(),
        "the platform, arriving late, finds the sink abandoned"
    );

    sink.settle(Ok(()));
    assert!(
        !output.exists(),
        "a late success must not write the caller's path"
    );
    assert!(!staging.exists(), "and leaves no sibling behind");
}

#[tokio::test]
async fn a_print_the_platform_had_already_started_is_still_a_timeout_and_still_discarded() {
    // The platform claimed (started its print) before the bound; the file it
    // eventually writes is nobody's.
    let (sink, rx, staging, output) = render_fixture();
    assert!(sink.claim());
    let err = settle_render(&sink, rx, &staging, &output, BOUND)
        .await
        .expect_err("timed out mid-print");
    assert_eq!(err.code(), ErrorCode::Timeout);

    sink.settle(Ok(()));
    assert!(!output.exists());
    assert!(!staging.exists());
}

// ---------------------------------------------------------------------------
// await_dialog
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_shown_dialog_waits_unbounded_for_the_outcome() {
    let (sink, shown_rx, rx) = dialog_fixture();
    let waiter = tokio::spawn({
        let sink = sink.clone();
        async move { await_dialog(&sink, shown_rx, rx, BOUND).await }
    });
    assert!(sink.claim());
    sink.shown();
    // Well past the bound: the phase ended, so this is the user's time.
    tokio::time::sleep(BOUND * 3).await;
    sink.settle(Ok(7));
    assert_eq!(waiter.await.expect("join").expect("outcome"), 7);
}

#[tokio::test]
async fn a_settle_before_the_dialog_ends_the_bounded_phase_at_once() {
    let (sink, shown_rx, rx) = dialog_fixture();
    sink.settle(Err(CommandError::io("load failed")));
    let started = std::time::Instant::now();
    let err = await_dialog(&sink, shown_rx, rx, LONG)
        .await
        .expect_err("the load failure");
    assert_eq!(err.code(), ErrorCode::Io);
    assert!(started.elapsed() < LONG, "did not sit out the bound");
}

#[tokio::test]
async fn a_dialog_that_never_appears_is_a_timeout_and_abandons_the_sink() {
    let (sink, shown_rx, rx) = dialog_fixture();
    let err = await_dialog(&sink, shown_rx, rx, BOUND)
        .await
        .expect_err("nothing shown within the bound");
    assert_eq!(err.code(), ErrorCode::Timeout);
    assert_eq!(err.i18n_key(), Some("errors.pdf.printTimeoutSecs"));
    assert!(
        !sink.claim(),
        "a platform reaching its dialog after this must tear down, not present it"
    );
}

#[tokio::test]
async fn a_platform_that_claimed_the_dialog_just_after_the_bound_is_waited_for() {
    // The race #227 names, from the caller's side: the bound elapses, and in
    // the same instant the platform claims and presents. The caller must not
    // report a timeout over a sheet the user is looking at.
    let (sink, shown_rx, rx) = dialog_fixture();
    let platform = tokio::spawn({
        let sink = sink.clone();
        async move {
            tokio::time::sleep(BOUND).await;
            // Claim wins against an abandon that has not happened yet.
            let claimed = sink.claim();
            sink.shown();
            tokio::time::sleep(BOUND).await;
            sink.settle(Ok(9));
            claimed
        }
    });
    let outcome = await_dialog(&sink, shown_rx, rx, BOUND).await;
    let claimed = platform.await.expect("join");
    if claimed {
        assert_eq!(
            outcome.expect("the dialog's outcome, not a timeout"),
            9,
            "the platform won: its outcome is honoured"
        );
    } else {
        // The caller's abandon won the race on this run; then the platform
        // must have been refused and the caller reported a real timeout.
        assert_eq!(
            outcome.expect_err("abandoned first").code(),
            ErrorCode::Timeout
        );
    }
}

// ---------------------------------------------------------------------------
// The teardown a timeout runs (#224, #227)
// ---------------------------------------------------------------------------

use std::sync::atomic::{AtomicUsize, Ordering};

/// Arm `sink` with a counting close, standing in for the platform's window.
fn armed<T>(sink: &RenderSink<T>) -> Arc<AtomicUsize> {
    let closes = Arc::new(AtomicUsize::new(0));
    let seen = closes.clone();
    sink.teardown.arm(move || {
        seen.fetch_add(1, Ordering::SeqCst);
    });
    closes
}

#[tokio::test]
async fn a_render_timeout_closes_the_platforms_window_at_once() {
    // The verifier's residual on #224: staging kept a late print off the
    // output path, but the window it printed from lived on at the
    // platform's own pace — forever, when its callback never came.
    let (sink, rx, staging, output) = render_fixture();
    let closes = armed(&sink);
    let err = settle_render(&sink, rx, &staging, &output, BOUND)
        .await
        .expect_err("nothing settled within the bound");
    assert_eq!(err.code(), ErrorCode::Timeout);
    assert_eq!(
        closes.load(Ordering::SeqCst),
        1,
        "the window is closed by the timeout, not left to the platform"
    );

    // The platform, arriving late, settles and would close its window
    // itself: the close already ran, and does not run again.
    sink.settle(Ok(()));
    assert_eq!(closes.load(Ordering::SeqCst), 1);
    assert!(!output.exists());
}

#[tokio::test]
async fn a_render_timeout_mid_print_closes_the_window_too() {
    // A print in flight for a caller that has left fills a file nobody will
    // read; destroying the webview is the only cancellation WebView2 and
    // WebKitGTK offer, and the caller pulls it.
    let (sink, rx, staging, output) = render_fixture();
    let closes = armed(&sink);
    assert!(sink.claim());
    settle_render(&sink, rx, &staging, &output, BOUND)
        .await
        .expect_err("timed out mid-print");
    assert_eq!(closes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_render_that_settles_in_time_leaves_the_window_to_the_platform() {
    let (sink, rx, staging, output) = render_fixture();
    let closes = armed(&sink);
    sink.settle(Ok(()));
    settle_render(&sink, rx, &staging, &output, LONG)
        .await
        .expect("published");
    assert_eq!(
        closes.load(Ordering::SeqCst),
        0,
        "settling disarmed the close: the platform closes, or keeps, its own window"
    );
    let _ = std::fs::remove_file(&output);
}

#[tokio::test]
async fn a_dialog_timeout_before_any_claim_closes_the_window() {
    // The verifier's residual on #227: the claim gate kept a late dialog off
    // the screen, but the helper window stayed until the platform got there.
    let (sink, shown_rx, rx) = dialog_fixture();
    let closes = armed(&sink);
    let err = await_dialog(&sink, shown_rx, rx, BOUND)
        .await
        .expect_err("nothing shown within the bound");
    assert_eq!(err.code(), ErrorCode::Timeout);
    assert_eq!(closes.load(Ordering::SeqCst), 1);
    assert!(
        !sink.claim(),
        "and a platform reaching its dialog now is refused"
    );
}

#[tokio::test]
async fn a_dialog_timeout_after_the_platform_claimed_leaves_the_window_to_the_user() {
    // Claimed but not yet shown when the bound elapses: the dialog is about
    // to be on screen, over this very window. Closing it would take the
    // dialog with it.
    let (sink, shown_rx, rx) = dialog_fixture();
    let closes = armed(&sink);
    assert!(sink.claim());
    let waiter = tokio::spawn({
        let sink = sink.clone();
        async move { await_dialog(&sink, shown_rx, rx, BOUND).await }
    });
    tokio::time::sleep(BOUND * 3).await;
    assert_eq!(closes.load(Ordering::SeqCst), 0, "the time is the user's");
    sink.shown();
    sink.settle(Ok(4));
    assert_eq!(waiter.await.expect("join").expect("outcome"), 4);
    assert_eq!(closes.load(Ordering::SeqCst), 0);
}

// ===== #452 — a timeout names a bound, never "0 seconds" =====================

#[test]
fn a_sub_second_bound_is_reported_as_a_whole_second_not_as_zero() {
    // `as_secs()` truncates, so every bound under a second used to read
    // "0 seconds" — a message that names no bound at all.
    assert_eq!(bound_seconds(Duration::from_millis(1)), 1);
    assert_eq!(bound_seconds(Duration::from_millis(200)), 1);
    assert_eq!(bound_seconds(Duration::from_millis(1_001)), 2);
}

#[test]
fn a_whole_second_bound_is_reported_exactly() {
    // Rounding up must not inflate the bounds production actually uses.
    assert_eq!(bound_seconds(Duration::from_secs(180)), 180);
    assert_eq!(bound_seconds(Duration::ZERO), 0);
}
