//! macOS off-screen WKWebView plumbing.
//!
//! Purpose: creating the hidden NSWindow + WKWebView pair, loading HTML from a
//! file URL, configuring NSPrintInfo, and ticking the run loop. Split from the
//! operations that use them so each file stays under the size limit.
//!
//! `configure_print_info` deliberately zeroes all four margins and never sets
//! a paper size: on macOS the `@page` CSS rules drive both, which is the
//! opposite of the other two platforms (ADR-PDF1a).
//!
//! @coordinates-with macos_ops.rs — the only consumer
//! @module pdf_export/renderer/macos

use objc2::MainThreadOnly;

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use objc2_foundation::NSString;

// ============================================================================
// Shared WKWebView Setup
// ============================================================================

/// A hidden NSWindow + WKWebView pair used for off-screen rendering.
pub(super) struct OffscreenWebView {
    pub(super) window: objc2::rc::Retained<objc2_app_kit::NSWindow>,
    pub(super) webview: objc2::rc::Retained<objc2_web_kit::WKWebView>,
}

/// Create a hidden NSWindow + WKWebView for off-screen HTML rendering.
///
/// WKWebView's printOperationWithPrintInfo requires a window for
/// runOperationModalForWindow to work correctly.
pub(super) fn create_offscreen_webview(mtm: objc2::MainThreadMarker) -> OffscreenWebView {
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
    let webview =
        unsafe { WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config) };
    window.setContentView(Some(&webview));

    OffscreenWebView { window, webview }
}

/// Load HTML from a file URL and wait for the load to complete.
///
/// Returns Err if the load times out (10 seconds).
///
/// `_mtm` is unused at runtime but required as a compile-time proof that the
/// caller is on the main thread — the `unsafe` Cocoa calls below segfault if
/// run from a worker thread.
pub(super) fn load_html_and_wait(
    _mtm: objc2::MainThreadMarker,
    webview: &objc2_web_kit::WKWebView,
    html_path: &str,
    read_access_dir: &str,
) -> Result<(), CommandError> {
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
        return Err(localized_error!(
            ErrorCode::Timeout,
            "errors.pdf.loadTimeout"
        ));
    }

    // Extra settle time for CSS parsing, layout, font loading
    run_loop_tick(0.2);
    Ok(())
}

/// Configure NSPrintInfo with zero margins and fit-to-page pagination.
///
/// Returns a copy of the shared print info to avoid mutating global state.
///
/// `_mtm` proves we're on the main thread — `NSPrintInfo::sharedPrintInfo()`
/// is main-thread-only.
pub(super) fn configure_print_info(
    _mtm: objc2::MainThreadMarker,
) -> objc2::rc::Retained<objc2_app_kit::NSPrintInfo> {
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

pub(super) fn run_loop_tick(seconds: f64) {
    use objc2_foundation::{NSDate, NSRunLoop};

    let date = NSDate::dateWithTimeIntervalSinceNow(seconds);
    let run_loop = NSRunLoop::currentRunLoop();
    run_loop.runUntilDate(&date);
}
