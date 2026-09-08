//! macOS native print dialog — `NSPrintOperation` as a sheet, with the outcome.
//!
//! Purpose: split from `macos_ops.rs` for the size limit — the same split
//! `windows.rs`/`windows_print.rs` and `linux.rs`/`linux_print.rs` made — and
//! because the dialog path now has state of its own: a delegate that outlives
//! the sheet.
//!
//! Key decisions:
//!   - **The outcome comes from the delegate, not from a timer (WI-FL6.3).**
//!     `runOperationModalForWindow:delegate:didRunSelector:contextInfo:`
//!     returns as soon as the sheet is up. The old body then ticked the run
//!     loop for two seconds and settled `Ok`, so `print_document` resolved
//!     while the panel was still open and could not know what the user chose.
//!     AppKit sends `printOperationDidRun:success:contextInfo:` when the sheet
//!     ends, with `success` NO on cancel. An earlier comment here said no
//!     delegate callback fires with WKWebView; nothing had ever passed a
//!     delegate to find out.
//!   - **The delegate keeps itself and the webview alive, and the callback
//!     is the ONLY release (#216).** AppKit does not document retaining the
//!     delegate, and the print operation draws from the WKWebView until the
//!     job is spooled. Both are held in the delegate's ivars, and the
//!     delegate holds itself, until `printOperationDidRun:` lets go —
//!     autoreleased, so nothing is freed under AppKit's feet. There is
//!     deliberately no other release path: AppKit messages the delegate
//!     when the sheet ends however it ends (a parent window closing takes
//!     its sheet with it and still runs the selector), so a teardown that
//!     freed the delegate on the app's own schedule would be a
//!     use-after-free, not a leak fix. `macos_print.test.rs` MEASURES the
//!     release on a real print operation: after the callback and a pool
//!     drain, a weak reference to the delegate loads nothing.
//!   - **Nothing blocks once the sheet is shown.** The body reports `shown`
//!     and returns to the event loop; that is what lets the bounded wait in
//!     `wait.rs` end there and the user take their time.
//!   - **The sheet attaches to the INVOKING window, resolved BEFORE the load
//!     (#218).** The command passes the label of the window it was called
//!     from. That window is resolved and RETAINED before the load, which can
//!     take ten seconds, and is re-checked at presentation BY IDENTITY: one
//!     that closed meanwhile is a cancel, never a substitute — and a
//!     replacement that reused the label is not the same window (#428). There is no key-window
//!     fallback for a labelled caller — a sheet on whichever window happens
//!     to be key is the bug this replaces. An unlabelled caller (the smoke
//!     harness) gets the key window, else the hidden render window.
//!   - **The claim is the last thing before the sheet (#227).** It is one
//!     compare-and-swap with the caller's timeout, so a caller whose bounded
//!     wait ended gets no sheet, and a caller that loses the race learns the
//!     sheet is up and keeps waiting.
//!
//! @coordinates-with macos.rs — the webview plumbing this drives
//! @coordinates-with outcome.rs — maps the success flag
//! @coordinates-with mod.rs — dispatches here and awaits the sink
//! @module pdf_export/renderer/macos_print

use core::ffi::c_void;
use std::cell::Cell;
use std::sync::Arc;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSPrintOperation, NSWindow};
use tauri::{AppHandle, Manager};

use crate::command_error::CommandError;

use super::macos::{
    configure_print_info, create_offscreen_webview, load_html_and_wait, OffscreenWebView,
};
use super::outcome::PrintOutcome;
use super::RenderSink;

/// What the delegate carries until the sheet ends.
pub(super) struct PrintDelegateIvars {
    sink: Arc<RenderSink<PrintOutcome>>,
    /// The hidden window + WKWebView the operation prints from. Dropped with
    /// the delegate, i.e. after the callback.
    _webview: OffscreenWebView,
    /// The delegate's own retain, released by the callback.
    self_retain: Cell<Option<Retained<PrintDelegate>>>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = PrintDelegateIvars]
    pub(super) struct PrintDelegate;

    unsafe impl NSObjectProtocol for PrintDelegate {}

    impl PrintDelegate {
        /// The `didRunSelector` of the modal print operation. `success` is NO
        /// when the user cancels the panel (and when the job fails, which
        /// AppKit reports in its own alert).
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn print_operation_did_run(
            &self,
            _operation: &NSPrintOperation,
            success: bool,
            _context: *mut c_void,
        ) {
            log::debug!("[PDF] print sheet ended, success={success}");
            self.ivars()
                .sink
                .settle(Ok(PrintOutcome::from_did_run_success(success)));
            // Let go of ourselves — into the autorelease pool, not
            // immediately: AppKit is still inside a message to this object.
            if let Some(me) = self.ivars().self_retain.take() {
                let _ = Retained::autorelease_ptr(me);
            }
        }
    }
);

impl PrintDelegate {
    fn new(
        mtm: MainThreadMarker,
        sink: Arc<RenderSink<PrintOutcome>>,
        webview: OffscreenWebView,
    ) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PrintDelegateIvars {
            sink,
            _webview: webview,
            self_retain: Cell::new(None),
        });
        // SAFETY: NSObject's init has the standard signature.
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        this.ivars().self_retain.set(Some(this.clone()));
        this
    }
}

/// Main-thread native print logic.
///
/// Shows the native macOS print dialog as a sheet on the invoking window and
/// returns; the delegate settles the sink when the sheet ends.
pub(super) fn print_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    read_access_dir: &str,
    parent_label: Option<&str>,
    sink: Arc<RenderSink<PrintOutcome>>,
) {
    if let Err(e) = print_inner(app, html_path, read_access_dir, parent_label, &sink) {
        // Reached only when nothing was shown, so no callback can ever fire.
        sink.settle(Err(e));
    }
}

fn print_inner(
    app: &AppHandle,
    html_path: &str,
    read_access_dir: &str,
    parent_label: Option<&str>,
    sink: &Arc<RenderSink<PrintOutcome>>,
) -> Result<(), CommandError> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| CommandError::internal("Print must run on the main thread"))?;

    let ov = create_offscreen_webview(mtm);
    // Resolved and RETAINED before the load, which can take ten seconds
    // (#218): the retain keeps the NSWindow valid across it whatever the
    // user does meanwhile.
    let parent = resolve_parent(app, mtm, parent_label, &ov.window)?;
    load_html_and_wait(mtm, &ov.webview, html_path, read_access_dir)?;
    let print_op = print_operation_for(mtm, &ov);

    // A window that closed during the load is a valid object and a useless
    // parent: a sheet on it is one nobody can see or dismiss, and the phase
    // after `shown` has no bound. Cancel instead (#218).
    //
    // The check is on IDENTITY, not on the label (#428). Tauri labels are
    // unique among LIVE windows only, so a window that closed and was
    // replaced during the load answers `get_webview_window` — while `parent`
    // still retains the closed NSWindow the label used to name. Re-resolving
    // and comparing the pointer is what tells the two apart.
    if let Some(label) = parent_label {
        let current = invoking_window(app, label);
        let same = current.is_some_and(|w| std::ptr::eq(&*w, &*parent));
        if !same {
            return Err(CommandError::cancelled(
                "the window that asked to print closed before the dialog could be shown",
            ));
        }
    }

    // Immediately before presenting, and atomic with the caller's timeout
    // (#227): a caller whose bounded wait ended gets no sheet, and a caller
    // that loses this race learns the sheet is up and keeps waiting.
    if !sink.claim() {
        return Err(CommandError::cancelled(
            "print abandoned before the dialog was shown",
        ));
    }

    present_sheet(mtm, &print_op, &parent, ov, sink);
    Ok(())
}

/// The print operation for the loaded document, panel and progress shown.
fn print_operation_for(mtm: MainThreadMarker, ov: &OffscreenWebView) -> Retained<NSPrintOperation> {
    // None: the Print DIALOG stays under AppKit's and the user's control.
    let print_info = configure_print_info(mtm, None);
    // SAFETY: ov.webview is a valid WKWebView created on this main thread.
    // print_info is a valid NSPrintInfo from configure_print_info().
    let print_op = unsafe { ov.webview.printOperationWithPrintInfo(&print_info) };
    print_op.setShowsPrintPanel(true);
    print_op.setShowsProgressPanel(true);
    print_op
}

/// The window the sheet attaches to (#218): the invoking window by label,
/// resolved now and retained. `choose_parent` is the rule.
fn resolve_parent(
    app: &AppHandle,
    mtm: MainThreadMarker,
    parent_label: Option<&str>,
    hidden: &Retained<NSWindow>,
) -> Result<Retained<NSWindow>, CommandError> {
    let invoking = parent_label.and_then(|label| invoking_window(app, label));
    choose_parent(
        parent_label.is_some(),
        invoking,
        || NSApplication::sharedApplication(mtm).keyWindow(),
        || hidden.clone(),
    )
}

/// The invoking window's own `NSWindow`, retained for as long as the sheet
/// needs it.
fn invoking_window(app: &AppHandle, label: &str) -> Option<Retained<NSWindow>> {
    let ptr = app.get_webview_window(label)?.ns_window().ok()?;
    // SAFETY: `ns_window()` hands back the window's own live `NSWindow`;
    // retaining it keeps the object valid across the load even if the window
    // closes meanwhile — which `print_inner` checks for before presenting.
    unsafe { Retained::retain(ptr.cast::<NSWindow>()) }
}

/// The rule, pure so it is pinned without AppKit: a labelled caller gets ITS
/// window or a cancel — never whichever window is key, which is the bug #218
/// names; an unlabelled caller (the smoke harness, a direct call) gets the
/// key window, else the hidden render window.
fn choose_parent<W>(
    label_given: bool,
    invoking: Option<W>,
    key: impl FnOnce() -> Option<W>,
    hidden: impl FnOnce() -> W,
) -> Result<W, CommandError> {
    match (label_given, invoking) {
        (true, Some(window)) => Ok(window),
        (true, None) => Err(CommandError::cancelled(
            "the window that asked to print is gone",
        )),
        (false, _) => Ok(key().unwrap_or_else(hidden)),
    }
}

/// Run the operation as a sheet on `parent`; the delegate owns the settle.
fn present_sheet(
    mtm: MainThreadMarker,
    print_op: &NSPrintOperation,
    parent: &NSWindow,
    ov: OffscreenWebView,
    sink: &Arc<RenderSink<PrintOutcome>>,
) {
    let delegate = PrintDelegate::new(mtm, sink.clone(), ov);
    let delegate_obj: &AnyObject = &delegate;
    // SAFETY: print_op is a valid NSPrintOperation. `parent` is a live window.
    // The delegate implements the selector with the signature AppKit sends,
    // and retains itself until that callback runs. Called on the main thread.
    unsafe {
        print_op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            parent,
            Some(delegate_obj),
            Some(sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        );
    }
    // The sheet is up. From here the time is the user's; the delegate owns
    // the settle.
    sink.shown();
}

#[cfg(test)]
#[path = "macos_print.test.rs"]
mod tests;
