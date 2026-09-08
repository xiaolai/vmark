//! Linux native print dialog — `webkit_print_operation_run_dialog()`.
//!
//! Purpose: split from `linux.rs` so each stays under the size limit — the
//! same split `windows.rs`/`windows_print.rs` made — and because a dialog is
//! a different concern from writing a file: this path hands control to the
//! user, where export renders off-screen and completes on its own.
//!
//! Key decisions:
//!   - **The helper window outlives a CONFIRMED print job (#1343).**
//!     `run_dialog` blocks until the user responds, but confirming only
//!     STARTS the job — CUPS spooling or Print-to-File output completes
//!     asynchronously afterwards, signalled by `finished`/`failed`. Settling
//!     and closing when `run_dialog` returned tore the webview down while a
//!     slow job was still rendering from it. So the response is branched:
//!     Cancel settles and closes immediately (nothing started, so `finished`
//!     may never fire, and waiting on it would leak the hidden helper
//!     forever); Print defers both to the signal handlers, exactly as the
//!     export path in `linux.rs` does.
//!   - **The window is hidden** (#1341): users read a raw-document window
//!     behind the dialog as a stray bug window, and a hidden WebKitGTK
//!     webview provably still renders and prints — the export path always
//!     has. Do NOT unify this with Windows: there `ShowPrintUI` draws the
//!     print UI INSIDE the webview window, so hiding it would hide the
//!     dialog itself.
//!   - **The outcome is reported (WI-FL6.3).** `run_dialog` returns
//!     `Cancel` or `Print`; Cancel settles `cancelled` on the spot, and a
//!     confirmed job settles `completed` from `finished` (or its error from
//!     `failed`). `shown()` is called just before `run_dialog`, which BLOCKS
//!     in a nested GTK loop for as long as the user deliberates — that is
//!     why the bounded wait in `wait.rs` ends there.
//!   - **The claim is the last thing before the dialog (#227).** One
//!     compare-and-swap with the caller's timeout: a caller whose bounded
//!     wait ended gets no dialog, and a caller that loses the race learns the
//!     dialog is up and keeps waiting.
//!   - **The window, the navigation and the load-failure tracking are
//!     `linux_nav.rs`'s, and the operation's signal wiring is `linux.rs`'s
//!     `settle_from_signals`** (#205, #206), both shared with export. This
//!     file keeps what is print's own: what `finished` means, and the dialog.
//!
//! @coordinates-with linux_nav.rs — builds, navigates and hands over the loaded webview
//! @coordinates-with linux.rs — shares the window and error helpers
//! @coordinates-with outcome.rs — `from_dialog_response`
//! @coordinates-with mod.rs — dispatches here and awaits the sink
//! @module pdf_export/renderer/linux_print

use std::sync::Arc;

use tauri::AppHandle;
use webkit2gtk::{PrintOperation, PrintOperationExt};

use crate::command_error::CommandError;

use super::linux::{close, settle_from_signals};
use super::linux_nav::navigate_once;
use super::outcome::PrintOutcome;
use super::RenderSink;

/// Show the system print dialog for the rendered document.
///
/// `webkit_print_operation_run_dialog` blocks until the user responds. On
/// Cancel this settles `cancelled` right there; on Print it settles
/// `completed` once the operation's `finished` signal fires — or the error
/// from `failed` — because a confirmed job keeps spooling after the dialog
/// closes (#1343).
///
/// `_read_access_dir` is the PLATFORM CONTRACT, not dead code (audit 20260907
/// #412): `mod.rs` dispatches to the macOS, Linux and Windows backends with
/// one argument list under `#[cfg]`, so every backend declares it. Only macOS
/// reads it — `WKWebView::loadFileURL:allowingReadAccessToURL:` needs an
/// explicit read-access scope for the directory the document loads resources
/// from. WebKitGTK grants no such scope through `load_uri`: a `file://`
/// navigation reads under the process's own permissions, so there is nothing
/// here for the boundary to be, and Linux is not ignoring one it has.
pub(super) fn print_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    _read_access_dir: &str,
    sink: Arc<RenderSink<PrintOutcome>>,
) {
    if let Err(e) = start_print(app, html_path, sink.clone()) {
        sink.settle(Err(e));
    }
}

fn start_print(
    app: &AppHandle,
    html_path: &str,
    sink: Arc<RenderSink<PrintOutcome>>,
) -> Result<(), CommandError> {
    // Translated for the same reason as the Windows twin (audit 20260907 #464).
    // This window is hidden (#1341), so the title reaches the user only through
    // a window-list applet — but it is the same string on the same surface, and
    // two spellings of one title is how one of them stays English forever.
    let title = rust_i18n::t!("window.print.title");
    navigate_once(
        app,
        html_path,
        &title,
        sink,
        Box::new(|view, app, label, sink| {
            let op = PrintOperation::new(view);

            // Connected BEFORE the dialog runs: WebKitGTK starts the job
            // the moment the user confirms, and a handler connected only
            // after `run_dialog` returns could miss a fast job's signal.
            // A confirmed job's `finished` is a completed print.
            settle_from_signals(&op, app, label, &sink, PrintOutcome::completed);

            // Immediately before the dialog, and atomic with the caller's
            // timeout (#227).
            if !sink.claim() {
                sink.settle(Err(CommandError::cancelled(
                    "print abandoned before the dialog was shown",
                )));
                close(app, label);
                return;
            }

            // The dialog is about to be up, and `run_dialog` will not
            // return until the user is done with it: end the bounded
            // phase here, not after.
            sink.shown();

            // No parent window: the render window is hidden, and a
            // transient parent that is never mapped gives the WM nothing
            // to stack against — the dialog floats free, as it always
            // has. Turbofish: `None` alone is ambiguous — the parameter
            // is generic over `IsA<gtk::Window>` with nothing to infer
            // from.
            match PrintOutcome::from_dialog_response(op.run_dialog(None::<&gtk::Window>)) {
                // Confirmed: the job is now spooling from THIS webview
                // and completes asynchronously after `run_dialog`
                // returns (#1343). The handlers above own settle and
                // close, and the caller's wait is unbounded from
                // `shown()` on, so a slow job is not a timeout.
                None => {}
                // Cancelled (or a response GTK does not define): nothing
                // was started, so `finished` may never fire — waiting on
                // it would leak the hidden helper window forever. Settle
                // with what the dialog said and close now.
                Some(outcome) => {
                    sink.settle(Ok(outcome));
                    close(app, label);
                }
            }
        }),
    )
}
