//! macOS off-screen WKWebView plumbing.
//!
//! Purpose: creating the hidden NSWindow + WKWebView pair, loading HTML from a
//! file URL, configuring NSPrintInfo, and ticking the run loop. Split from the
//! operations that use them so each file stays under the size limit.
//!
//! `configure_print_info` deliberately zeroes all four margins — on macOS the
//! `@page` CSS rules drive those, unlike the other two platforms (ADR-PDF1a).
//! It sets the PAGE SIZE for the silent export path and leaves it alone for the
//! interactive Print dialog (WI-PDF1.4). This header used to say it never set a
//! page size at all (#415), which the function has contradicted since
//! `@page { size }` was measured to be ignored entirely here; the reasoning is
//! at the `if let Some(p) = page` block and is the authoritative account.
//!
//! @coordinates-with macos_ops.rs, macos_print.rs, macos_save_job.rs — the consumers
//! @module pdf_export/renderer/macos

use std::cell::Cell;

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKNavigation, WKNavigationDelegate, WKWebView};

use crate::pdf_export::page_spec::PageSpec;

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// What a navigation reported, once it has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LoadOutcome {
    Loaded,
    Failed,
}

pub(super) struct LoadDelegateIvars {
    outcome: Cell<Option<LoadOutcome>>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = LoadDelegateIvars]
    pub(super) struct LoadDelegate;

    unsafe impl NSObjectProtocol for LoadDelegate {}

    /// The load's own verdict (#210). `isLoading` alone went false for a
    /// FAILED navigation too, and the render then printed WebKit's error
    /// page — or nothing — and reported success.
    unsafe impl WKNavigationDelegate for LoadDelegate {
        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, _web_view: &WKWebView, _navigation: Option<&WKNavigation>) {
            self.ivars().outcome.set(Some(LoadOutcome::Loaded));
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(
            &self,
            _web_view: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            self.record_failure("failed", error);
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(
            &self,
            _web_view: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            self.record_failure("failed before it started", error);
        }
    }
);

impl LoadDelegate {
    /// What EITHER navigation-failure callback does (#416): say which stage
    /// failed, then record the verdict `load_html_and_wait` reads.
    ///
    /// One function rather than two copies: the copies differed only in the
    /// word describing the stage, and the half that matters — setting
    /// `outcome` — is the half a later edit to one of them would drop from the
    /// other. A failure that records nothing is a load that times out instead
    /// of reporting the error WebKit already handed us.
    fn record_failure(&self, stage: &str, error: &NSError) {
        log::warn!(
            "[PDF] document navigation {stage}: {}",
            error.localizedDescription()
        );
        self.ivars().outcome.set(Some(LoadOutcome::Failed));
    }

    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(LoadDelegateIvars {
            outcome: Cell::new(None),
        });
        // SAFETY: NSObject's init has the standard signature.
        unsafe { msg_send![super(this), init] }
    }
}

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

/// Load HTML from a file URL and wait for the navigation to REPORT — finished
/// or failed — through a `WKNavigationDelegate` (#210).
///
/// Returns Err if the load fails, or times out (10 seconds). The delegate is
/// held by this frame for the duration; the webview references it weakly and
/// is detached from it before returning.
///
/// `mtm` proves the caller is on the main thread — the `unsafe` Cocoa calls
/// below segfault if run from a worker thread.
pub(super) fn load_html_and_wait(
    mtm: MainThreadMarker,
    webview: &WKWebView,
    html_path: &str,
    read_access_dir: &str,
) -> Result<(), CommandError> {
    use objc2_foundation::NSURL;

    let delegate = LoadDelegate::new(mtm);
    // SAFETY: the delegate is a valid main-thread object that outlives every
    // tick below; the webview holds it weakly and is detached before return.
    unsafe { webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*delegate))) };

    let file_url = NSURL::fileURLWithPath(&NSString::from_str(html_path));
    let dir_url = NSURL::fileURLWithPath(&NSString::from_str(read_access_dir));
    // SAFETY: webview is a valid WKWebView (caller provides it). file_url and dir_url
    // are valid NSURLs constructed from path strings above. Runs on the main thread.
    unsafe { webview.loadFileURL_allowingReadAccessToURL(&file_url, &dir_url) };

    let load_start = std::time::Instant::now();
    let mut outcome = None;
    for i in 0..200 {
        run_loop_tick(0.05);
        outcome = delegate.ivars().outcome.get();
        if outcome.is_some() {
            log::debug!(
                "[PDF] navigation reported {:?} at tick {} ({:.2}s)",
                outcome,
                i,
                load_start.elapsed().as_secs_f64()
            );
            break;
        }
        if i % 20 == 0 {
            log::debug!("[PDF] tick {}: navigation pending", i);
        }
    }
    // SAFETY: same object, same thread; nil detaches it.
    unsafe { webview.setNavigationDelegate(None) };

    match outcome {
        Some(LoadOutcome::Loaded) => {}
        Some(LoadOutcome::Failed) => {
            return Err(localized_error!(ErrorCode::Io, "errors.pdf.loadFailed"));
        }
        None => {
            log::debug!(
                "[PDF] load TIMEOUT after {:.2}s",
                load_start.elapsed().as_secs_f64()
            );
            return Err(localized_error!(
                ErrorCode::Timeout,
                "errors.pdf.loadTimeout"
            ));
        }
    }

    // Extra settle time for CSS parsing, layout, font loading
    run_loop_tick(0.2);
    Ok(())
}

/// Configure NSPrintInfo with zero margins and fit-to-page pagination.
///
/// Returns a copy of the shared print info to avoid mutating global state —
/// and, on the silent export path, one whose layout-affecting properties are
/// all set here rather than inherited from the user's last print (#420).
///
/// `_mtm` proves we're on the main thread — `NSPrintInfo::sharedPrintInfo()`
/// is main-thread-only.
/// `page` sets the physical page size, and is `None` for the interactive
/// Print dialog — that path must stay under AppKit's and the user's control
/// via the print panel, so it keeps taking the system default.
pub(super) fn configure_print_info(
    _mtm: objc2::MainThreadMarker,
    page: Option<PageSpec>,
) -> objc2::rc::Retained<objc2_app_kit::NSPrintInfo> {
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo, NSPrintingPaginationMode};
    use objc2_foundation::{NSCopying, NSSize};

    let print_info = NSPrintInfo::sharedPrintInfo().copy();
    print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);

    // WI-PDF1.4: the page size comes from the caller, not the system default.
    //
    // Measured 2026-08-16: `@page { size }` is ignored ENTIRELY here — the
    // same content at `size:A4` and `size:A5` produced the same page count AND
    // the same MediaBox, so it affects neither size nor layout. Every export
    // therefore came out at whatever size the machine happened to default to,
    // which made the dialog's Page Size and Orientation controls decorative.
    //
    // `PageSpec` already carries orientation as a width/height swap, so
    // landscape needs nothing extra.
    //
    // But the COPY carries whatever the user last printed with (#420):
    // `sharedPrintInfo` is a persisted, mutable global, and a scaling factor
    // left at 50% by an unrelated print silently halved every export. So the
    // silent path — `page` is `Some` — normalises every layout-affecting
    // property it does not otherwise set, rather than only the ones it does.
    //
    // Orientation is set BEFORE the size, and deliberately: `setOrientation:`
    // SWAPS `paperSize` when it disagrees with it, so setting it afterwards
    // would undo the geometry asked for. Setting it to match means AppKit
    // never has a disagreement to resolve. Centering is off because the
    // margins here are zero and `@page` owns the layout; a centred body
    // inside a full-bleed page is AppKit second-guessing the CSS.
    if let Some(p) = page {
        print_info.setOrientation(if p.width_pt > p.height_pt {
            NSPaperOrientation::Landscape
        } else {
            NSPaperOrientation::Portrait
        });
        print_info.setPaperSize(NSSize::new(p.width_pt, p.height_pt));
        print_info.setScalingFactor(1.0);
        print_info.setHorizontallyCentered(false);
        print_info.setVerticallyCentered(false);
    }

    // Set margins to 0 — let @page CSS rules control margins.
    // WebKit's print pipeline applies @page margins internally, and margins
    // ARE honoured there (unlike size), so this stays as it was.
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
