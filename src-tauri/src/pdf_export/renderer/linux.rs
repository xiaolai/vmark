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
//!
//! @coordinates-with mod.rs — dispatches here and awaits the sink
//! @coordinates-with page_spec.rs — supplies the geometry, in points
//! @module pdf_export/renderer/linux

use std::sync::Arc;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use webkit2gtk::{PrintOperation, PrintOperationExt, WebViewExt};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::pdf_export::page_spec::PageSpec;

use super::RenderSink;

/// Unique per render, so two concurrent exports cannot collide on a label.
const LABEL_PREFIX: &str = "pdf-render-";

/// The virtual printer GTK's file backend provides. Naming it is mandatory —
/// see ADR-PDF2.
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
    let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let file_url = path_to_file_url(html_path)?;
    let out_uri = path_to_file_url(output_path)?;

    let blank = "about:blank".parse().expect("about:blank parses");
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(false)
        .title("VMark PDF render")
        .build()
        .map_err(|e| window_error(&e.to_string()))?;

    let app_cb = app.clone();
    let label_cb = label.clone();

    window
        .with_webview(move |pw| {
            let view = pw.inner();
            let sink_load = sink.clone();
            let app_load = app_cb.clone();
            let label_load = label_cb.clone();
            let out_uri = out_uri.clone();

            view.connect_load_changed(move |view, event| {
                if event != webkit2gtk::LoadEvent::Finished {
                    return;
                }
                let op = PrintOperation::new(view);
                let settings = gtk::PrintSettings::new();
                // Both keys. Either one alone fails, in opposite ways.
                settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&out_uri));
                settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
                settings.set_printer(FILE_PRINTER);

                // Geometry: size only. Orientation is already applied as a
                // swap, and margins belong to the CSS (ADR-PDF1a).
                let paper = gtk::PaperSize::new_custom(
                    "vmark-page",
                    "VMark page",
                    page.width_pt,
                    page.height_pt,
                    gtk::Unit::Points,
                );
                let setup = gtk::PageSetup::new();
                setup.set_paper_size_and_default_margins(&paper);
                setup.set_top_margin(0.0, gtk::Unit::Points);
                setup.set_bottom_margin(0.0, gtk::Unit::Points);
                setup.set_left_margin(0.0, gtk::Unit::Points);
                setup.set_right_margin(0.0, gtk::Unit::Points);

                op.set_print_settings(&settings);
                op.set_page_setup(&setup);

                let sink_fail = sink_load.clone();
                let app_fail = app_load.clone();
                let label_fail = label_load.clone();
                op.connect_failed(move |_, err| {
                    sink_fail.settle(Err(localized_error!(
                        ErrorCode::Io,
                        "errors.pdf.comFailed",
                        stage = "print",
                        detail = err.to_string()
                    )));
                    close(&app_fail, &label_fail);
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

                op.print();
            });

            view.load_uri(&file_url);
        })
        .map_err(|e| window_error(&e.to_string()))?;

    Ok(())
}

/// Tear the render window down — a timeout is not cancellation (ADR-PDF7).
fn close(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
}

fn window_error(detail: &str) -> CommandError {
    localized_error!(
        ErrorCode::Internal,
        "errors.pdf.renderWindowFailed",
        detail = detail
    )
}

/// `file://` URI, percent-encoding whatever must be encoded.
fn path_to_file_url(path: &str) -> Result<String, CommandError> {
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

/// Show the system print dialog for the rendered document.
///
/// Settles once the dialog has been SHOWN. `webkit_print_operation_run_dialog`
/// is where the user takes over, and like the other two platforms we cannot
/// report what they choose to do there.
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
    // Visible: a print dialog floating over nothing is disorienting.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(true)
        .title("VMark Print")
        .build()
        .map_err(|e| window_error(&e.to_string()))?;

    window
        .with_webview(move |pw| {
            let view = pw.inner();
            let sink_load = sink.clone();
            view.connect_load_changed(move |view, event| {
                if event != webkit2gtk::LoadEvent::Finished {
                    return;
                }
                let op = PrintOperation::new(view);
                // No parent window: the operation owns its own dialog, and
                // passing the render window would tie the dialog's lifetime to
                // a window the user may close underneath it.
                // Turbofish: `None` alone is ambiguous — the parameter is
                // generic over `IsA<gtk::Window>` and there is nothing to
                // infer from.
                op.run_dialog(None::<&gtk::Window>);
                sink_load.settle(Ok(()));
            });
            view.load_uri(&file_url);
        })
        .map_err(|e| window_error(&e.to_string()))?;
    Ok(())
}
