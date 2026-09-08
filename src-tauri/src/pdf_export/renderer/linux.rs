//! Linux PDF renderer — `webkit_print_operation_print()`.
//!
//! Purpose: render the frontend's HTML to a paginated PDF with no print
//! dialog, honouring the page size the user picked.
//!
//! Key decisions:
//!   - **The webview is a hidden Tauri `WebviewWindow`.** Same reasoning as
//!     Windows: the one Tauri already runs is configured correctly, and
//!     building a second by hand invites a mismatch (ADR-PDF5).
//!   - **The document arrives by NAVIGATION to a `file://` URL**, never
//!     `load_html`. VMark inlines images as data URIs and real exports exceed
//!     any string ceiling (ADR-PDF4).
//!   - **BOTH print-settings keys are required, for two different reasons**
//!     (ADR-PDF2, measured). Without `printer` set to `"Print to File"` the
//!     operation fails outright with `WebKitPrintError` 500 "Printer not
//!     found". Without `output-uri` it reports **success** and writes
//!     `output.pdf` into the process's working directory — or, where that path
//!     is not writable, raises a filesystem error naming a path nobody chose.
//!     Which of those two you get is decided by the environment, not the code,
//!     which is why this stalled upstream for months.
//!   - **The URI is built with `Url::from_file_path`**, never string
//!     concatenation: spaces, `#`, `%` and non-ASCII all produce a URI that
//!     navigates nowhere, and that surfaces as a silent empty PDF.
//!   - **Nothing blocks the UI thread.** Handlers are registered and the
//!     closure returns; GLib delivers `finished`/`failed` on the owning
//!     context and the sink is settled there (ADR-PDF6).
//!   - **Progress is reported at the same three points as macOS (WI-FL6.2):**
//!     `Loading` before the window is built, `Rendering` when the load has
//!     finished and the print starts, `Finishing` from the operation's
//!     `finished` signal. That signal also fires after `failed`; the sink
//!     drops a stage reported after the outcome, so the handler needs no
//!     guard of its own. Until then this backend emitted nothing.
//!   - **The window, the navigation and the load-failure tracking are
//!     `linux_nav.rs`'s** (#205, #206): one copy for export and print; and
//!     the operation's `failed`/`finished` wiring — settle, then close — is
//!     `settle_from_signals` below, the one copy both paths connect. This
//!     file keeps what is export's own: the print settings and the job.
//!
//! @coordinates-with mod.rs — dispatches here and awaits the sink
//! @coordinates-with linux_nav.rs — builds, navigates and hands over the loaded webview
//! @coordinates-with page_spec.rs — supplies the geometry, in points
//! @coordinates-with linux_print.rs — the dialog path; borrows these helpers
//! @module pdf_export/renderer/linux

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use webkit2gtk::{PrintOperation, PrintOperationExt};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::pdf_export::page_spec::PageSpec;

use super::linux_nav::navigate_once;
use super::progress::PdfProgress;
use super::RenderSink;

/// Unique per render, so two concurrent exports cannot collide on a label.
pub(super) const LABEL_PREFIX: &str = "pdf-render-";

/// The virtual printer GTK's file backend provides. Naming it is mandatory —
/// see ADR-PDF2.
///
/// **Residual, stated rather than papered over (#401):** GTK3's file backend
/// registers this printer under a TRANSLATED name, so on a non-English desktop
/// the lookup misses and the export fails with `WebKitPrintError` 500 "Printer
/// not found" — the same failure ADR-PDF2 records for omitting the key.
/// Closing it means selecting the virtual printer by CAPABILITY
/// (`is-virtual` + `accepts-pdf`) instead of by name, and the pinned
/// `gtk` 0.18.2 / `gtk-sys` 0.18.2 expose neither `GtkPrinter` nor
/// `gtk_enumerate_printers` (checked in the vendored sources) — so it needs
/// hand-written FFI against libgtk-3, on the one platform this project can
/// neither run nor compile locally (`AGENTS.md`). An unrunnable hand-rolled
/// enumeration would be a claim, not a fix, which is the same judgement
/// `workflow/ensure_dir.rs` records for its Windows walk.
const FILE_PRINTER: &str = "Print to File";

pub(super) fn render_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    _read_access_dir: &str,
    output_path: &str,
    page: PageSpec,
    sink: Arc<RenderSink>,
) {
    if let Err(e) = start(app, html_path, output_path, page, sink.clone()) {
        // Reached only when setup failed, i.e. no signal can ever fire.
        sink.settle(Err(e));
    }
}

fn start(
    app: &AppHandle,
    html_path: &str,
    output_path: &str,
    page: PageSpec,
    sink: Arc<RenderSink>,
) -> Result<(), CommandError> {
    let out_uri = path_to_file_url(output_path)?;
    sink.progress(PdfProgress::Loading);
    navigate_once(
        app,
        html_path,
        "VMark PDF render",
        sink,
        Box::new(move |view, app, label, sink| {
            // The caller's bounded wait may have ended during the load
            // (#227): a print for a caller that has given up would only fill
            // a staging file the sink then deletes. The claim is the atomic
            // check.
            if !sink.claim() {
                sink.settle(Err(CommandError::cancelled(
                    "the caller stopped waiting before the document loaded",
                )));
                close(app, label);
                return;
            }
            sink.progress(PdfProgress::Rendering);
            let op = PrintOperation::new(view);
            let settings = gtk::PrintSettings::new();
            // Both keys. Either one alone fails, in opposite ways.
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&out_uri));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            settings.set_printer(FILE_PRINTER);

            // Geometry: size, plus margins. Orientation is already applied
            // as a swap (ADR-PDF1a).
            //
            // Margins are NOT left to the CSS here, unlike macOS and
            // Windows. WebKitGTK takes its page box from the GtkPageSetup,
            // so zeroing these printed the document edge to edge whatever
            // `@page { margin }` said — measured on the real showcase at
            // 0/4/4/0 pt where macOS and Windows both gave 72.
            let paper = gtk::PaperSize::new_custom(
                "vmark-page",
                "VMark page",
                page.width_pt,
                page.height_pt,
                gtk::Unit::Points,
            );
            let setup = gtk::PageSetup::new();
            setup.set_paper_size_and_default_margins(&paper);
            setup.set_top_margin(page.margin_top_pt.unwrap_or(0.0), gtk::Unit::Points);
            setup.set_bottom_margin(page.margin_bottom_pt.unwrap_or(0.0), gtk::Unit::Points);
            setup.set_left_margin(page.margin_left_pt.unwrap_or(0.0), gtk::Unit::Points);
            setup.set_right_margin(page.margin_right_pt.unwrap_or(0.0), gtk::Unit::Points);

            op.set_print_settings(&settings);
            op.set_page_setup(&setup);

            // `finished` is the render done: report Finishing, then settle.
            // After a `failed` the sink refuses both, so a failure never
            // reads green or "finishing".
            let sink_done = sink.clone();
            settle_from_signals(&op, app, label, &sink, move || {
                sink_done.progress(PdfProgress::Finishing);
            });

            op.print();
        }),
    )
}

/// Settle `sink` from the operation's signals and close the window, the one
/// copy export and print both connect (#205): `failed` settles its error;
/// `finished` — which WebKitGTK raises after `failed` too — settles
/// `on_finished()`'s value, which settle() being idempotent turns into a
/// no-op after a failure. Connect BEFORE the job starts: a handler connected
/// after `print()` or `run_dialog()` could miss a fast job's signal.
pub(super) fn settle_from_signals<T: 'static>(
    op: &PrintOperation,
    app: &AppHandle,
    label: &str,
    sink: &Arc<RenderSink<T>>,
    on_finished: impl Fn() -> T + 'static,
) {
    let sink_fail = sink.clone();
    let app_fail = app.clone();
    let label_fail = label.to_string();
    op.connect_failed(move |_, err| {
        sink_fail.settle(Err(localized_error!(
            ErrorCode::Io,
            "errors.pdf.comFailed",
            stage = "print",
            detail = err.to_string()
        )));
        close(&app_fail, &label_fail);
    });

    let sink_done = sink.clone();
    let app_done = app.clone();
    let label_done = label.to_string();
    op.connect_finished(move |_| {
        sink_done.settle(Ok(on_finished()));
        close(&app_done, &label_done);
    });
}

/// Tear the render window down — a timeout is not cancellation (ADR-PDF7).
pub(super) fn close(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        // Reported, not discarded (#406). This close is the only thing between
        // an abandoned render and a hidden webview plus its WebKit process
        // living for the rest of the session; a refusal that says nothing turns
        // that leak into an unexplainable memory report. The label is printed
        // with `{:?}` so it cannot forge a log line.
        if let Err(e) = w.close() {
            log::warn!("[PDF] could not close the render window {label:?}: {e}");
        }
    }
}

pub(super) fn window_error(detail: &str) -> CommandError {
    localized_error!(
        ErrorCode::Internal,
        "errors.pdf.renderWindowFailed",
        detail = detail
    )
}

/// `file://` URI, percent-encoding whatever must be encoded.
pub(super) fn path_to_file_url(path: &str) -> Result<String, CommandError> {
    url::Url::from_file_path(path)
        .map(|u| u.to_string())
        .map_err(|()| {
            localized_error!(
                ErrorCode::InvalidInput,
                "errors.pdf.badTempPath",
                path = path
            )
        })
}
