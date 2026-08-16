//! macOS main-thread PDF operations.
//!
//! Purpose: the bodies that run ON the main thread — rendering to a paginated
//! PDF via `printOperationWithPrintInfo`, and showing the native print panel.
//! `createPDF` is deliberately not used: it produces one continuous page with
//! no pagination.
//!
//! @coordinates-with macos.rs — the webview plumbing these drive
//! @coordinates-with mod.rs — dispatches here and awaits the oneshot
//! @module pdf_export/renderer/macos_ops

use objc2_foundation::NSString;
use tauri::AppHandle;

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::pdf_export::page_spec::PageSpec;

use std::sync::Arc;

use super::macos::{
    configure_print_info, create_offscreen_webview, load_html_and_wait, run_loop_tick,
};
use super::{emit_progress, RenderSink};

/// Main-thread PDF rendering logic.
pub(super) fn render_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    read_access_dir: &str,
    output_path: &str,
    // macOS geometry is CSS-driven (ADR-PDF1a); the spec is accepted for a
    // uniform contract and deliberately unused here.
    page: PageSpec,
    sink: Arc<RenderSink>,
) {
    sink.settle(render_inner(
        app,
        html_path,
        read_access_dir,
        output_path,
        page,
    ));
}

/// The synchronous body. macOS can produce its result inside the UI closure
/// because it spins the run loop itself; the other two platforms cannot.
fn render_inner(
    app: &AppHandle,
    html_path: &str,
    read_access_dir: &str,
    output_path: &str,
    page: PageSpec,
) -> Result<(), CommandError> {
    use objc2::MainThreadMarker;

    let mtm = MainThreadMarker::new()
        .ok_or_else(|| CommandError::internal("PDF export must run on the main thread"))?;

    emit_progress(app, "loading");
    log::debug!("[PDF] creating hidden window + WKWebView...");

    let ov = create_offscreen_webview(mtm);

    log::debug!("[PDF] loading file: {}", html_path);
    load_html_and_wait(mtm, &ov.webview, html_path, read_access_dir)?;

    log::debug!("[PDF] creating PDF via print operation...");
    emit_progress(app, "rendering");
    let pdf_start = std::time::Instant::now();
    let result = print_to_pdf(mtm, &ov.webview, &ov.window, output_path, page);
    log::debug!(
        "[PDF] print operation done in {:.2}s",
        pdf_start.elapsed().as_secs_f64()
    );

    if result.is_ok() {
        emit_progress(app, "done");
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

    // Remove any stale file to avoid false-positive success detection
    let _ = std::fs::remove_file(output_path);

    log::debug!("[PDF] creating print operation...");

    // SAFETY: webview is a valid WKWebView; print_info is a valid NSPrintInfo.
    // Called on the main thread (caller verified MainThreadMarker).
    let print_op = unsafe { webview.printOperationWithPrintInfo(&print_info) };

    // Hide print panel and progress panel (save silently)
    print_op.setShowsPrintPanel(false);
    print_op.setShowsProgressPanel(false);

    log::debug!("[PDF] running print operation (modal for hidden window)...");

    // Run the print operation modally for the hidden window.
    // This is required for WKWebView — plain runOperation() produces blank PDFs.
    // SAFETY: print_op and window are valid objects. delegate=None and
    // didRunSelector=None skip the callback. null contextInfo is allowed.
    // Called on the main thread (required for modal operations).
    unsafe {
        print_op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            window,
            None,
            None,
            std::ptr::null_mut(),
        );
    }

    // Wait for the PDF file to be fully written.
    // We check file existence AND wait for the file size to stabilize
    // to avoid returning while the file is still being flushed.
    let start = std::time::Instant::now();
    let mut last_size: u64 = 0;
    let mut stable_ticks: u32 = 0;
    for i in 0..600 {
        run_loop_tick(0.1);

        if i > 5 {
            if let Ok(metadata) = std::fs::metadata(output_path) {
                let size = metadata.len();
                if size > 0 {
                    if size == last_size {
                        stable_ticks += 1;
                    } else {
                        stable_ticks = 0;
                        last_size = size;
                    }
                    // File size stable for 5 consecutive ticks (500ms) — done
                    if stable_ticks >= 5 {
                        // Final recheck after one more pause to guard against slow flushes
                        run_loop_tick(0.2);
                        let final_size =
                            std::fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);
                        if final_size == size {
                            log::debug!(
                                "[PDF] PDF file stable at tick {} ({:.2}s), size: {} bytes",
                                i,
                                start.elapsed().as_secs_f64(),
                                size
                            );
                            return Ok(());
                        }
                        // Size changed during recheck — reset and keep waiting
                        stable_ticks = 0;
                        last_size = final_size;
                    }
                }
            }
        }

        if i % 50 == 0 && i > 0 {
            log::debug!(
                "[PDF] print waiting... tick {} ({:.2}s)",
                i,
                start.elapsed().as_secs_f64()
            );
        }
    }

    log::debug!(
        "[PDF] print operation TIMEOUT after {:.2}s",
        start.elapsed().as_secs_f64()
    );

    // Check if file was created at all
    if std::path::Path::new(output_path).exists() {
        let size = std::fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);
        if size > 0 {
            log::debug!("[PDF] file exists with {} bytes (detected late)", size);
            return Ok(());
        }
        log::debug!("[PDF] file exists but is empty (0 bytes)");
        let _ = std::fs::remove_file(output_path);
        return Err(localized_error!(ErrorCode::Io, "errors.pdf.emptyOutput"));
    }

    Err(localized_error!(
        ErrorCode::Timeout,
        "errors.pdf.printTimeout"
    ))
}

// ============================================================================
// Native Print Dialog
// ============================================================================

/// Main-thread native print logic.
///
/// Shows the native macOS print dialog as a sheet on the app's key window.
/// The dialog is modal — this function blocks until the user confirms or cancels.
///
/// Note: We cannot reliably detect print cancellation from NSPrintOperation
/// when used with WKWebView (no delegate callback fires). We always return Ok
pub(super) fn print_on_main_thread(
    _app: &AppHandle,
    html_path: &str,
    read_access_dir: &str,
    sink: Arc<RenderSink>,
) {
    sink.settle(print_inner(html_path, read_access_dir));
}

fn print_inner(html_path: &str, read_access_dir: &str) -> Result<(), CommandError> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let mtm = MainThreadMarker::new()
        .ok_or_else(|| CommandError::internal("Print must run on the main thread"))?;

    let ov = create_offscreen_webview(mtm);

    load_html_and_wait(mtm, &ov.webview, html_path, read_access_dir)?;

    // None: the Print DIALOG stays under AppKit's and the user's control.
    let print_info = configure_print_info(mtm, None);

    // Show the print panel (unlike PDF export which hides it)
    // SAFETY: ov.webview is a valid WKWebView created on this main thread.
    // print_info is a valid NSPrintInfo from configure_print_info().
    let print_op = unsafe { ov.webview.printOperationWithPrintInfo(&print_info) };
    print_op.setShowsPrintPanel(true);
    print_op.setShowsProgressPanel(true);

    // Attach the print dialog to the app's key window (the focused document window)
    // so the sheet appears on the main window and can be interacted with normally.
    let ns_app = NSApplication::sharedApplication(mtm);
    let parent_window = ns_app.keyWindow().unwrap_or(ov.window.clone());

    // Run modal — shows native macOS print dialog as a sheet on the main window
    // SAFETY: print_op is a valid NSPrintOperation. parent_window is either the
    // app's key window or the offscreen window (both valid). delegate=None and
    // didRunSelector=None skip the callback. Called on the main thread (mtm).
    unsafe {
        print_op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &parent_window,
            None,
            None,
            std::ptr::null_mut(),
        );
    }

    // Spin run loop to let the dialog and print operation complete.
    // The modal dialog blocks user interaction until dismissed, then the
    // print spooling happens asynchronously in the macOS print subsystem.
    for _ in 0..20 {
        run_loop_tick(0.1);
    }

    Ok(())
}
