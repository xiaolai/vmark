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
//!
//! @coordinates-with linux.rs — shares the window, URL and error helpers
//! @coordinates-with mod.rs — dispatches here and awaits the sink
//! @module pdf_export/renderer/linux_print

use std::sync::Arc;

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use webkit2gtk::{PrintOperation, PrintOperationExt, PrintOperationResponse, WebViewExt};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

use super::linux::{close, path_to_file_url, window_error, LABEL_PREFIX};
use super::RenderSink;

/// Show the system print dialog for the rendered document.
///
/// `webkit_print_operation_run_dialog` blocks until the user responds. On
/// Cancel this settles right there; on Print it settles once the operation's
/// `finished` or `failed` signal fires, because a confirmed job keeps
/// spooling after the dialog closes (#1343). Like the other two platforms we
/// do not report what the user chose — a cancelled dialog still settles Ok —
/// but a confirmed job that FAILS now reports its error, as export does.
pub(super) fn print_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    _read_access_dir: &str,
    sink: Arc<RenderSink>,
) {
    if let Err(e) = start_print(app, html_path, sink.clone()) {
        sink.settle(Err(e));
    }
}

fn start_print(
    app: &AppHandle,
    html_path: &str,
    sink: Arc<RenderSink>,
) -> Result<(), CommandError> {
    let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let file_url = path_to_file_url(html_path)?;
    let blank = "about:blank".parse().expect("about:blank parses");
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(false)
        .title("VMark Print")
        .build()
        .map_err(|e| window_error(&e.to_string()))?;

    let app_cb = app.clone();
    let label_cb = label.clone();

    window
        .with_webview(move |pw| {
            let view = pw.inner();

            // A failed load still reaches `Finished`, and settling + closing
            // from the failure handler is not enough on its own: `close()`
            // only QUEUES the teardown on the event loop, so the Finished
            // handler still ran and popped a print dialog over WebKit's error
            // page from a window already being torn down. One flag, two
            // handlers. Rc<Cell>, not Arc: GTK signal handlers all run on the
            // main thread. If a SECOND navigation is ever added, reset the
            // flag on LoadEvent::Started.
            let load_failed = std::rc::Rc::new(std::cell::Cell::new(false));

            let sink_fail = sink.clone();
            let app_fail = app_cb.clone();
            let label_fail = label_cb.clone();
            let failed_flag = load_failed.clone();
            view.connect_load_failed(move |_, _, _, _| {
                failed_flag.set(true);
                sink_fail.settle(Err(localized_error!(
                    ErrorCode::Io,
                    "errors.pdf.loadFailed"
                )));
                close(&app_fail, &label_fail);
                true // handled — suppress WebKit's own error page
            });

            let sink_load = sink.clone();
            let app_load = app_cb.clone();
            let label_load = label_cb.clone();
            view.connect_load_changed(move |view, event| {
                if event != webkit2gtk::LoadEvent::Finished || load_failed.get() {
                    return;
                }
                let op = PrintOperation::new(view);

                // Connected BEFORE the dialog runs: WebKitGTK starts the job
                // the moment the user confirms, and a handler connected only
                // after `run_dialog` returns could miss a fast job's signal.
                let sink_err = sink_load.clone();
                let app_err = app_load.clone();
                let label_err = label_load.clone();
                op.connect_failed(move |_, err| {
                    sink_err.settle(Err(localized_error!(
                        ErrorCode::Io,
                        "errors.pdf.comFailed",
                        stage = "print",
                        detail = err.to_string()
                    )));
                    close(&app_err, &label_err);
                });

                let sink_done = sink_load.clone();
                let app_done = app_load.clone();
                let label_done = label_load.clone();
                op.connect_finished(move |_| {
                    // `finished` fires after `failed` too, so settle() being
                    // idempotent is what keeps a failure from reading green.
                    sink_done.settle(Ok(()));
                    close(&app_done, &label_done);
                });

                // No parent window: the render window is hidden, and a
                // transient parent that is never mapped gives the WM nothing
                // to stack against — the dialog floats free, as it always
                // has. Turbofish: `None` alone is ambiguous — the parameter
                // is generic over `IsA<gtk::Window>` with nothing to infer
                // from.
                match op.run_dialog(None::<&gtk::Window>) {
                    // Confirmed: the job is now spooling from THIS webview
                    // and completes asynchronously after `run_dialog`
                    // returns (#1343). The handlers above own settle and
                    // close. If the job outlives PDF_OPERATION_TIMEOUT the
                    // caller reports a timeout, but the handlers still run
                    // when the job ends: settling a settled sink is a
                    // no-op, and the hidden window still closes itself.
                    PrintOperationResponse::Print => {}
                    // Cancelled: nothing was started, so `finished` may
                    // never fire — waiting on it would leak the hidden
                    // helper window forever. Settle and close now.
                    _ => {
                        sink_load.settle(Ok(()));
                        close(&app_load, &label_load);
                    }
                }
            });

            view.load_uri(&file_url);
        })
        .map_err(|e| window_error(&e.to_string()))?;
    Ok(())
}
