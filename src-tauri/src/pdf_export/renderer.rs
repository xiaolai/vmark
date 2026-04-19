//! Off-screen WKWebView PDF renderer (macOS only).
//!
//! Flow:
//! 1. Write HTML to temp file (avoids loadHTMLString issues)
//! 2. Dispatch to main thread via Tauri's event loop (NOT GCD — critical!)
//! 3. Create hidden NSWindow + WKWebView, load HTML from file URL
//! 4. Spin NSRunLoop to wait for load completion
//! 5. Use printOperationWithPrintInfo + NSPrintSaveJob for paginated PDF
//!
//! Uses `app.run_on_main_thread()` (tao event loop) instead of
//! `dispatch2::Queue::main().exec_async()` (GCD). The latter causes
//! WKWebView callbacks to deadlock because NSRunLoop spinning inside
//! a GCD main queue block can't drain nested GCD callbacks.
//!
//! Uses `printOperationWithPrintInfo` instead of `createPDF` because
//! createPDF produces a single continuous page with no pagination.
//! The print operation respects @page CSS rules and paginates properly.
//!
//! Emits `pdf-export-progress` events to the frontend for UI updates.

use objc2::MainThreadOnly;
use objc2_foundation::NSString;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// Progress event payload.
#[derive(Clone, serde::Serialize)]
struct PdfProgress {
    stage: &'static str,
}

fn emit_progress(app: &AppHandle, stage: &'static str) {
    let _ = app.emit_to("pdf-export", "pdf-export-progress", PdfProgress { stage });
}

// ============================================================================
// Shared WKWebView Setup
// ============================================================================

/// A hidden NSWindow + WKWebView pair used for off-screen rendering.
struct OffscreenWebView {
    window: objc2::rc::Retained<objc2_app_kit::NSWindow>,
    webview: objc2::rc::Retained<objc2_web_kit::WKWebView>,
}

/// Create a hidden NSWindow + WKWebView for off-screen HTML rendering.
///
/// WKWebView's printOperationWithPrintInfo requires a window for
/// runOperationModalForWindow to work correctly.
fn create_offscreen_webview(
    mtm: objc2::MainThreadMarker,
) -> OffscreenWebView {
    use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowStyleMask};
    use objc2_core_foundation::CGRect;
    use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

    let frame = CGRect::new(
        objc2_core_foundation::CGPoint::new(0.0, 0.0),
        objc2_core_foundation::CGSize::new(800.0, 600.0),
    );
    // SAFETY: Called on the main thread (mtm proves MainThreadMarker).
    // NSWindow init is a standard Cocoa initializer with valid frame/style params.
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            frame,
            NSWindowStyleMask::Borderless,
            NSBackingStoreType::Buffered,
            true,
        )
    };
    // SAFETY: Main thread (mtm). WKWebViewConfiguration::new is a standard initializer.
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    // SAFETY: Main thread (mtm). config is a valid WKWebViewConfiguration created above.
    let webview = unsafe {
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config)
    };
    window.setContentView(Some(&webview));

    OffscreenWebView { window, webview }
}

/// Load HTML from a file URL and wait for the load to complete.
///
/// Returns Err if the load times out (10 seconds).
fn load_html_and_wait(
    webview: &objc2_web_kit::WKWebView,
    html_path: &str,
    read_access_dir: &str,
) -> Result<(), String> {
    use objc2_foundation::NSURL;

    let file_url = NSURL::fileURLWithPath(&NSString::from_str(html_path));
    let dir_url = NSURL::fileURLWithPath(&NSString::from_str(read_access_dir));
    // SAFETY: webview is a valid WKWebView (caller provides it). file_url and dir_url
    // are valid NSURLs constructed from path strings above. Runs on the main thread
    // (this function is only called from main-thread contexts).
    unsafe { webview.loadFileURL_allowingReadAccessToURL(&file_url, &dir_url) };

    let load_start = std::time::Instant::now();
    let mut loaded = false;
    for i in 0..200 {
        run_loop_tick(0.05);

        // SAFETY: webview is a valid WKWebView. isLoading is a simple property
        // getter that returns a BOOL. Called on the main thread.
        let is_loading: bool = unsafe { objc2::msg_send![webview, isLoading] };
        if !is_loading && i > 2 {
            log::debug!(
                "[PDF] loaded at tick {} ({:.2}s)",
                i,
                load_start.elapsed().as_secs_f64()
            );
            loaded = true;
            break;
        }
        if i % 20 == 0 {
            log::debug!("[PDF] tick {}: isLoading={}", i, is_loading);
        }
    }

    if !loaded {
        log::debug!(
            "[PDF] load TIMEOUT after {:.2}s",
            load_start.elapsed().as_secs_f64()
        );
        return Err(rust_i18n::t!("errors.pdf.loadTimeout").to_string());
    }

    // Extra settle time for CSS parsing, layout, font loading
    run_loop_tick(0.2);
    Ok(())
}

/// Configure NSPrintInfo with zero margins and fit-to-page pagination.
///
/// Returns a copy of the shared print info to avoid mutating global state.
fn configure_print_info() -> objc2::rc::Retained<objc2_app_kit::NSPrintInfo> {
    use objc2_app_kit::{NSPrintInfo, NSPrintingPaginationMode};
    use objc2_foundation::NSCopying;

    let print_info = NSPrintInfo::sharedPrintInfo().copy();
    print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);

    // Set margins to 0 — let @page CSS rules control margins.
    // WebKit's print pipeline applies @page margins internally.
    print_info.setTopMargin(0.0);
    print_info.setBottomMargin(0.0);
    print_info.setLeftMargin(0.0);
    print_info.setRightMargin(0.0);

    print_info
}

// ============================================================================
// PDF Export
// ============================================================================

/// Render HTML to PDF via off-screen WKWebView.
///
/// Writes HTML to a temp file, then dispatches to the main thread via
/// Tauri's event loop to create a WKWebView and generate the PDF.
pub async fn render_pdf(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    // Write HTML to temp file on the async thread (no main thread needed)
    let temp_dir = std::env::temp_dir();
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_html = temp_dir.join(format!(
        "vmark-pdf-export-{}-{}.html",
        std::process::id(),
        unique_id
    ));
    std::fs::write(&temp_html, &html)
        .map_err(|e| format!("Failed to write temp HTML: {}", e))?;

    log::debug!(
        "[PDF] render_pdf: wrote {} bytes to {}, output: {}",
        html.len(),
        temp_html.display(),
        output_path
    );

    let (tx, rx) = oneshot::channel::<Result<(), String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    let tx_clone = tx.clone();
    let app_clone = app.clone();
    let temp_html_str = temp_html.to_string_lossy().to_string();
    let temp_dir_str = temp_dir.to_string_lossy().to_string();
    let output_path_clone = output_path.clone();

    // Use Tauri's event loop dispatch (NOT GCD) — this is critical.
    // GCD dispatch causes WKWebView callback deadlock when spinning NSRunLoop.
    app.run_on_main_thread(move || {
        log::debug!("[PDF] main thread (tao event loop) entered");
        let result = render_pdf_on_main_thread(
            &app_clone,
            &temp_html_str,
            &temp_dir_str,
            &output_path_clone,
        );
        log::debug!(
            "[PDF] done, result: {:?}",
            result.as_ref().map(|_| "ok")
        );
        // Clean up temp file
        let _ = std::fs::remove_file(&temp_html_str);
        if let Some(sender) = tx_clone.lock().unwrap_or_else(|p| p.into_inner()).take() {
            let _ = sender.send(result);
        }
    })
    .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;

    rx.await
        .map_err(|_| "PDF render channel closed".to_string())?
}

/// Main-thread PDF rendering logic.
fn render_pdf_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    read_access_dir: &str,
    output_path: &str,
) -> Result<(), String> {
    use objc2::MainThreadMarker;

    let mtm =
        MainThreadMarker::new().ok_or("PDF export must run on the main thread")?;

    emit_progress(app, "loading");
    log::debug!("[PDF] creating hidden window + WKWebView...");

    let ov = create_offscreen_webview(mtm);

    log::debug!("[PDF] loading file: {}", html_path);
    load_html_and_wait(&ov.webview, html_path, read_access_dir)?;

    log::debug!("[PDF] creating PDF via print operation...");
    emit_progress(app, "rendering");
    let pdf_start = std::time::Instant::now();
    let result = print_to_pdf(&ov.webview, &ov.window, output_path);
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
fn print_to_pdf(
    webview: &objc2_web_kit::WKWebView,
    window: &objc2_app_kit::NSWindow,
    output_path: &str,
) -> Result<(), String> {
    use objc2_app_kit::{NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::NSURL;

    log::debug!("[PDF] configuring NSPrintInfo...");

    let print_info = configure_print_info();

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
        let _: () =
            objc2::msg_send![&*dict, setObject: &*output_url, forKey: NSPrintJobSavingURL];
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
                        let final_size = std::fs::metadata(output_path)
                            .map(|m| m.len())
                            .unwrap_or(0);
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
        let size = std::fs::metadata(output_path)
            .map(|m| m.len())
            .unwrap_or(0);
        if size > 0 {
            log::debug!("[PDF] file exists with {} bytes (detected late)", size);
            return Ok(());
        }
        log::debug!("[PDF] file exists but is empty (0 bytes)");
        let _ = std::fs::remove_file(output_path);
        return Err(rust_i18n::t!("errors.pdf.emptyOutput").to_string());
    }

    Err(rust_i18n::t!("errors.pdf.printTimeout").to_string())
}

// ============================================================================
// Native Print Dialog
// ============================================================================

/// Print HTML via native macOS print dialog.
///
/// Same pipeline as render_pdf but shows the print panel instead of
/// silently saving to file. The user selects a printer and prints.
pub async fn print_document(app: AppHandle, html: String) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_html = temp_dir.join(format!(
        "vmark-print-{}-{}.html",
        std::process::id(),
        unique_id
    ));
    std::fs::write(&temp_html, &html)
        .map_err(|e| format!("Failed to write temp HTML: {}", e))?;

    let (tx, rx) = oneshot::channel::<Result<(), String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx_clone = tx.clone();
    let temp_html_str = temp_html.to_string_lossy().to_string();
    let temp_dir_str = temp_dir.to_string_lossy().to_string();

    app.run_on_main_thread(move || {
        let result =
            print_on_main_thread(&temp_html_str, &temp_dir_str);
        let _ = std::fs::remove_file(&temp_html_str);
        if let Some(sender) = tx_clone.lock().unwrap_or_else(|p| p.into_inner()).take() {
            let _ = sender.send(result);
        }
    })
    .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;

    rx.await
        .map_err(|_| "Print channel closed".to_string())?
}

/// Main-thread native print logic.
///
/// Shows the native macOS print dialog as a sheet on the app's key window.
/// The dialog is modal — this function blocks until the user confirms or cancels.
///
/// Note: We cannot reliably detect print cancellation from NSPrintOperation
/// when used with WKWebView (no delegate callback fires). We always return Ok
/// and let the print system handle errors via the macOS print infrastructure.
fn print_on_main_thread(
    html_path: &str,
    read_access_dir: &str,
) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let mtm = MainThreadMarker::new().ok_or("Print must run on the main thread")?;

    let ov = create_offscreen_webview(mtm);

    load_html_and_wait(&ov.webview, html_path, read_access_dir)?;

    let print_info = configure_print_info();

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

/// Tick the run loop using NSRunLoop.
fn run_loop_tick(seconds: f64) {
    use objc2_foundation::{NSDate, NSRunLoop};

    let date = NSDate::dateWithTimeIntervalSinceNow(seconds);
    let run_loop = NSRunLoop::currentRunLoop();
    run_loop.runUntilDate(&date);
}
