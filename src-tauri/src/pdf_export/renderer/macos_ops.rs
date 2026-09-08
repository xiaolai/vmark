//! macOS main-thread PDF operations.
//!
//! Purpose: the body that runs ON the main thread — rendering to a paginated
//! PDF via `printOperationWithPrintInfo`. `createPDF` is deliberately not
//! used: it produces one continuous page with no pagination. The native
//! print DIALOG lives in `macos_print.rs`; the save job's completion — the
//! delegate callback, the stale-output check and the PDF verification — in
//! `macos_save_job.rs` (#212, #213, #214).
//!
//! @coordinates-with macos.rs — the webview plumbing this drives
//! @coordinates-with macos_print.rs — the dialog path; shares the plumbing
//! @coordinates-with macos_save_job.rs — runs the operation and verifies the file
//! @coordinates-with mod.rs — dispatches here and awaits the oneshot
//! @module pdf_export/renderer/macos_ops

use objc2_foundation::NSString;
use tauri::AppHandle;

use crate::command_error::CommandError;
use crate::pdf_export::page_spec::PageSpec;

use std::sync::Arc;

use super::macos::{configure_print_info, create_offscreen_webview, load_html_and_wait};
use super::macos_save_job::{clear_stale_output, run_save_job};
use super::progress::PdfProgress;
use super::RenderSink;

/// Main-thread PDF rendering logic.
///
/// The parameter list is the PLATFORM CONTRACT, not this function's needs:
/// `mod.rs` dispatches to `macos_ops`, `linux` and `windows` with one argument
/// list under `#[cfg]`, so every backend declares every parameter whether or
/// not it reads one. `_app` is macOS's unused one (audit 20260907 #421) —
/// this path builds a raw `NSWindow` + `WKWebView` rather than a Tauri window,
/// so it needs no handle, while the other two create Tauri windows and do.
pub(super) fn render_on_main_thread(
    _app: &AppHandle,
    html_path: &str,
    read_access_dir: &str,
    output_path: &str,
    // NOT unused, whatever this comment used to claim (audit 20260907 #422):
    // `page` is forwarded to `print_to_pdf` → `configure_print_info`, which is
    // what makes `NSPrintInfo` honour the requested paper size. The comment
    // predates WI-PDF1.4, when macOS took its geometry from the `@page` CSS
    // rule alone and every size came out at the system default.
    page: PageSpec,
    sink: Arc<RenderSink>,
) {
    let result = render_inner(html_path, read_access_dir, output_path, page, &sink);
    sink.settle(result);
}

/// The synchronous body. macOS can produce its result inside the UI closure
/// because it spins the run loop itself; the other two platforms cannot.
///
/// Progress goes through the sink at the same three points every platform
/// reports (WI-FL6.2): before the webview exists, once the document has
/// loaded, and once the print operation has written the file.
fn render_inner(
    html_path: &str,
    read_access_dir: &str,
    output_path: &str,
    page: PageSpec,
    sink: &RenderSink,
) -> Result<(), CommandError> {
    use objc2::MainThreadMarker;

    let mtm = MainThreadMarker::new()
        .ok_or_else(|| CommandError::internal("PDF export must run on the main thread"))?;

    sink.progress(PdfProgress::Loading);
    log::debug!("[PDF] creating hidden window + WKWebView...");

    let ov = create_offscreen_webview(mtm);

    log::debug!("[PDF] loading file: {}", html_path);
    load_html_and_wait(mtm, &ov.webview, html_path, read_access_dir)?;

    // The caller's bounded wait may have ended during the load (#227). A
    // print for a caller that has given up would only fill a staging file
    // the sink then deletes; the claim is the atomic check.
    if !sink.claim() {
        return Err(CommandError::cancelled(
            "render abandoned before the print started",
        ));
    }

    log::debug!("[PDF] creating PDF via print operation...");
    sink.progress(PdfProgress::Rendering);
    let pdf_start = std::time::Instant::now();
    let result = print_to_pdf(mtm, &ov.webview, &ov.window, output_path, page);
    log::debug!(
        "[PDF] print operation done in {:.2}s",
        pdf_start.elapsed().as_secs_f64()
    );

    if result.is_ok() {
        // "finishing", not "done": the RENDER is finished, but `export_pdf`
        // still has the outline and the page numbers to add, and on a long
        // document that is visible time. Claiming completion here told the user
        // the export was over while it was still writing to the file.
        // `export_pdf` emits "done" once post-processing returns.
        sink.progress(PdfProgress::Finishing);
    }
    result
}

/// Print WKWebView content to PDF using NSPrintOperation.
///
/// Uses printOperationWithPrintInfo with NSPrintSaveJob disposition
/// to generate a paginated PDF that respects @page CSS rules.
///
/// `mtm` proves main-thread context for the unsafe Cocoa calls and is
/// forwarded to helpers that need the same proof.
fn print_to_pdf(
    mtm: objc2::MainThreadMarker,
    webview: &objc2_web_kit::WKWebView,
    window: &objc2_app_kit::NSWindow,
    output_path: &str,
    page: PageSpec,
) -> Result<(), CommandError> {
    use objc2_app_kit::{NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::NSURL;

    log::debug!("[PDF] configuring NSPrintInfo...");

    let print_info = configure_print_info(mtm, Some(page));

    // Configure save-to-PDF disposition
    // SAFETY: print_info is a valid NSPrintInfo copy from configure_print_info().
    // NSPrintSaveJob is a valid job disposition constant.
    unsafe {
        print_info.setJobDisposition(NSPrintSaveJob);
    }

    // Set the output file URL in the print info dictionary.
    let output_url = NSURL::fileURLWithPath(&NSString::from_str(output_path));
    // SAFETY: print_info.dictionary() returns a valid NSMutableDictionary.
    // output_url is a valid NSURL. NSPrintJobSavingURL is a valid dictionary key.
    // setObject:forKey: is a standard NSDictionary mutation on a mutable dict.
    unsafe {
        let dict = print_info.dictionary();
        let _: () = objc2::msg_send![&*dict, setObject: &*output_url, forKey: NSPrintJobSavingURL];
    }

    // A stale file at the destination would be read back as this export's
    // result; failing to remove it is a failure, not a shrug (#212).
    clear_stale_output(output_path)?;

    log::debug!("[PDF] creating print operation...");

    // SAFETY: webview is a valid WKWebView; print_info is a valid NSPrintInfo.
    // Called on the main thread (caller verified MainThreadMarker).
    let print_op = unsafe { webview.printOperationWithPrintInfo(&print_info) };

    // Hide print panel and progress panel (save silently)
    print_op.setShowsPrintPanel(false);
    print_op.setShowsProgressPanel(false);

    log::debug!("[PDF] running print operation (modal for hidden window)...");
    // Completion comes from AppKit's delegate callback, and the file is then
    // verified to be a PDF — no more inferring "done" from a size that
    // stopped changing (#213, #214).
    run_save_job(mtm, &print_op, window, output_path)
}
