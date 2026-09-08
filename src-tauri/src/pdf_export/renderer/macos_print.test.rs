// WI-FL6.3 — the macOS print delegate, measured on a real WKWebView print
// operation.
//
// `printOperationDidRun:success:contextInfo:` is the whole basis of the
// completed/cancelled distinction on macOS, and an earlier comment in this
// module claimed the callback never fires for a WKWebView print operation
// (nothing had ever passed a delegate to find out). So this runs one — panel
// hidden, disposition NSPrintSaveJob to a temp file, the shape `macos_ops.rs`
// renders with — against the real `PrintDelegate`, and reports whether the
// selector arrived, what it said, whether the operation wrote its file, and
// whether the delegate's self-retain was actually released afterwards (#216).
//
// Same mechanism as `nav_api_navigation_native.test.rs`: WebKit and AppKit run
// only on the process's main thread, so the test binary is spawned again with
// an env var set and a static initializer runs the probe before `main`.
//
// Cancel cannot be measured here: it is a click in a panel this probe does
// not show. What CAN be measured is that the flag arrives at all, that the
// self-retain is released without AppKit crashing on the way out, and that
// nothing else keeps the delegate — and the webview and sink it holds — alive.
//
// The parent-window rule (#218) is pure and pinned below without AppKit.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use objc2::rc::Weak;
use objc2::runtime::AnyObject;
use objc2::{sel, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSPrintJobSavingURL, NSPrintSaveJob};
use objc2_foundation::{NSString, NSURL};
use tokio::sync::oneshot;

use super::super::macos::{
    configure_print_info, create_offscreen_webview, load_html_and_wait, run_loop_tick,
};
use super::super::outcome::PrintStatus;
use super::*;
use crate::command_error::ErrorCode;

/// Set in the child: where to write the report. Its presence IS the request.
const REPORT_ENV: &str = "VMARK_PRINT_DELEGATE_PROBE_REPORT";
const PROBE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ProbeReport {
    /// Did the delegate's selector run at all?
    fired: bool,
    /// The outcome the sink was settled with, when it fired.
    status: Option<PrintStatus>,
    /// The saved PDF's size — the operation ran to completion, not merely
    /// reported it.
    pdf_bytes: u64,
    /// Did the bounded phase end?
    shown: bool,
    /// After the callback and a pool drain, does a weak reference to the
    /// delegate load nothing? The self-retain cycle is broken by the
    /// callback and by nothing else (#216).
    released: bool,
    elapsed_ms: u128,
}

// ── child side ─────────────────────────────────────────────────────────────

extern "C" fn probe_entry() {
    let Ok(report_path) = std::env::var(REPORT_ENV) else {
        return;
    };
    let mtm = MainThreadMarker::new().expect("static initializers run on the main thread");
    // The callback autoreleases the delegate's self-retain; the app's event
    // loop provides the pool there, this provides it here. The weak
    // reference is loaded only AFTER the pool has drained, which is the
    // moment the release the callback scheduled actually happens.
    let (mut report, weak) = objc2::rc::autoreleasepool(|_| run_probe(mtm));
    report.released = weak.load().is_none();
    let json = serde_json::to_string(&report).expect("the report serializes");
    std::fs::write(&report_path, json).expect("write the probe report");
    std::process::exit(0);
}

#[used]
#[link_section = "__DATA,__mod_init_func"]
static PROBE_INIT: extern "C" fn() = probe_entry;

fn run_probe(mtm: MainThreadMarker) -> (ProbeReport, Weak<PrintDelegate>) {
    // AppKit's print machinery assumes an application object exists; the real
    // app always has one, a bare test binary does not until asked.
    let _app = NSApplication::sharedApplication(mtm);

    let dir = tempfile::tempdir().expect("temp dir for the probe");
    let html_path = dir.path().join("probe.html");
    let pdf_path = dir.path().join("probe.pdf");
    std::fs::write(&html_path, "<!doctype html><p>print delegate probe</p>").expect("write html");
    let html = html_path.to_string_lossy().into_owned();
    let read_dir = dir.path().to_string_lossy().into_owned();

    let ov = create_offscreen_webview(mtm);
    load_html_and_wait(mtm, &ov.webview, &html, &read_dir).expect("the probe page loads");

    // The save-job shape from `macos_ops::print_to_pdf`, so the operation runs
    // to completion with no panel and nothing for a human to click.
    let print_info = configure_print_info(mtm, None);
    let output_url = NSURL::fileURLWithPath(&NSString::from_str(&pdf_path.to_string_lossy()));
    // SAFETY: the same calls `print_to_pdf` makes on the same objects.
    unsafe {
        print_info.setJobDisposition(NSPrintSaveJob);
        let dict = print_info.dictionary();
        let _: () = objc2::msg_send![&*dict, setObject: &*output_url, forKey: NSPrintJobSavingURL];
    }
    // SAFETY: a valid WKWebView on the main thread and a valid NSPrintInfo.
    let print_op = unsafe { ov.webview.printOperationWithPrintInfo(&print_info) };
    print_op.setShowsPrintPanel(false);
    print_op.setShowsProgressPanel(false);

    let window = ov.window.clone();
    let (tx, mut rx) = oneshot::channel();
    let (shown_tx, mut shown_rx) = oneshot::channel();
    let sink = RenderSink::for_dialog(tx, shown_tx, html_path.clone());
    let delegate = PrintDelegate::new(mtm, sink.clone(), ov);
    let weak = Weak::from_retained(&delegate);
    let delegate_obj: &AnyObject = &delegate;
    // SAFETY: exactly the call `print_inner` makes, with the same delegate.
    unsafe {
        print_op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &window,
            Some(delegate_obj),
            Some(sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        );
    }
    sink.shown();
    // Our own Retained goes now, as it does in `print_inner` when it returns:
    // from here only the self-retain keeps the delegate alive.
    drop(delegate);
    // And our own sink handle: the delegate's is the only one left, so a
    // delegate that is not released would keep the sink alive too.
    drop(sink);

    let start = Instant::now();
    let mut outcome = None;
    while start.elapsed() < PROBE_TIMEOUT {
        run_loop_tick(0.05);
        match rx.try_recv() {
            Ok(result) => {
                outcome = Some(result);
                break;
            }
            Err(oneshot::error::TryRecvError::Empty) => {}
            Err(oneshot::error::TryRecvError::Closed) => break,
        }
    }
    // Let the autorelease pool's release of the delegate happen inside the
    // probe, where a use-after-free would crash the child rather than pass.
    run_loop_tick(0.2);

    let report = ProbeReport {
        fired: outcome.is_some(),
        status: outcome
            .and_then(|result| result.ok())
            .map(|outcome| outcome.status),
        pdf_bytes: std::fs::metadata(&pdf_path).map(|m| m.len()).unwrap_or(0),
        shown: shown_rx.try_recv().is_ok(),
        released: false, // measured by the caller, after the pool drains
        elapsed_ms: start.elapsed().as_millis(),
    };
    (report, weak)
}

// ── parent side ────────────────────────────────────────────────────────────

fn probe() -> &'static ProbeReport {
    static REPORT: OnceLock<ProbeReport> = OnceLock::new();
    REPORT.get_or_init(|| {
        let dir = tempfile::tempdir().expect("temp dir for the report");
        let report_path = dir.path().join("report.json");
        let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .env(REPORT_ENV, &report_path)
            .output()
            .expect("spawn the test binary as the probe");
        assert!(
            output.status.success(),
            "the probe exited {:?}\nstderr:\n{}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        let json = std::fs::read_to_string(&report_path).expect("the probe wrote its report");
        serde_json::from_str(&json).expect("a well-formed report")
    })
}

#[test]
fn the_did_run_selector_fires_for_a_wkwebview_print_operation() {
    let report = probe();
    assert!(
        report.fired,
        "AppKit never sent printOperationDidRun:success:contextInfo: within {:?} — the \
         outcome path this module rests on does not exist: {report:?}",
        PROBE_TIMEOUT
    );
}

#[test]
fn a_save_job_that_ran_to_the_end_reports_completed() {
    let report = probe();
    assert_eq!(
        report.status,
        Some(PrintStatus::Completed),
        "success=YES must map to completed: {report:?}"
    );
    assert!(
        report.pdf_bytes > 0,
        "completed must mean the job actually produced its output: {report:?}"
    );
}

#[test]
fn the_bounded_phase_ends_as_soon_as_the_operation_is_running() {
    let report = probe();
    assert!(
        report.shown,
        "shown() must have ended the bounded wait before the outcome: {report:?}"
    );
}

#[test]
fn the_callback_releases_the_delegate_and_everything_it_held() {
    // #216: the delegate, the webview and the sink form a cycle the callback
    // alone is meant to break. If anything else still held the delegate
    // after the callback and the pool drain, that cycle would be a leak per
    // print — measured here rather than asserted in a comment.
    let report = probe();
    assert!(
        report.released,
        "the delegate is still alive after its callback ran and the pool drained: {report:?}"
    );
}

// ── the parent-window rule (#218), without AppKit ──────────────────────────

#[test]
fn a_labelled_caller_gets_its_own_window() {
    let parent = choose_parent(true, Some("invoking"), || Some("key"), || "hidden");
    assert_eq!(parent.expect("resolved"), "invoking");
}

#[test]
fn a_labelled_caller_whose_window_is_gone_is_cancelled_not_redirected() {
    // The bug #218 names: never a sheet on whichever window is key.
    let err = choose_parent(true, None::<&str>, || Some("key"), || "hidden")
        .expect_err("no substitute parent");
    assert_eq!(err.code(), ErrorCode::Cancelled);
}

#[test]
fn an_unlabelled_caller_gets_the_key_window() {
    let parent = choose_parent(false, None::<&str>, || Some("key"), || "hidden");
    assert_eq!(parent.expect("resolved"), "key");
}

#[test]
fn an_unlabelled_caller_with_no_key_window_gets_the_hidden_render_window() {
    let parent = choose_parent(false, None::<&str>, || None, || "hidden");
    assert_eq!(parent.expect("resolved"), "hidden");
}
