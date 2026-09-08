//! Windows PDF renderer — `ICoreWebView2_7::PrintToPdf`.
//!
//! Purpose: render the frontend's HTML to a paginated PDF with no print
//! dialog, honouring the page size the user picked.
//!
//! Key decisions:
//!   - **The webview is a hidden Tauri `WebviewWindow`, not a raw WebView2.**
//!     Tauri forces a writable user-data folder and wry adds non-default
//!     environment options; a second environment built by hand must duplicate
//!     those exactly or it fails — and it fails after a non-admin install
//!     rather than in development (ADR-PDF5). Asking Tauri for a window means
//!     the environment is the one already running.
//!   - **The document arrives by NAVIGATION to a `file://` URL.** Never
//!     `NavigateToString` / wry's `.with_html`, which caps at 2 MiB — VMark
//!     inlines images as data URIs, so real exports exceed that routinely
//!     (ADR-PDF4). A navigation has no such ceiling.
//!   - **Nothing blocks the UI thread.** The closure creates the webview,
//!     registers handlers and returns; `NavigationCompleted` starts the print
//!     and `PrintToPdfCompleted` settles the sink (ADR-PDF6). Waiting here
//!     would deadlock the pump that delivers those very callbacks.
//!   - **Geometry is size only.** Width and height come from `PageSpec`, which
//!     already applied orientation as a swap — the orientation *enum* was
//!     measurably ignored while explicit width/height were set. Margins stay
//!     in the CSS, which is where Windows actually reads them (ADR-PDF1a).
//!   - **Progress is reported at the same three points as macOS (WI-FL6.2):**
//!     `Loading` before the window is built, `Rendering` when navigation has
//!     completed and the print starts, `Finishing` when `PrintToPdf` reports
//!     success. Until then this backend emitted nothing, so the export
//!     dialog sat on "Preparing…" until the file appeared.
//!   - **The window, the handlers and the navigation are `windows_nav.rs`'s**
//!     (#236): one copy for export and print, acting on the DOCUMENT's
//!     completion — matched by the navigation id its start reported —
//!     exactly once (#233), claiming the sink inside that decision (#227),
//!     closing the window on every failure through one path (#234, #237)
//!     and on the caller's timeout (#224). This file keeps what is export's
//!     own: the print.
//!
//! @coordinates-with mod.rs — dispatches here and awaits the sink
//! @coordinates-with windows_nav.rs — builds, navigates and hands over the loaded webview
//! @coordinates-with page_spec.rs — supplies the geometry, in inches
//! @module pdf_export/renderer/windows

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Environment6, ICoreWebView2PrintSettings, ICoreWebView2_2,
    ICoreWebView2_7,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows_core::{Interface, HSTRING, PCWSTR};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::pdf_export::page_spec::PageSpec;

use super::progress::PdfProgress;
use super::windows_nav::navigate_once;
use super::RenderSink;

/// Label prefix for the throwaway render window. Unique per render so two
/// concurrent exports cannot collide on a label Tauri treats as a key.
pub(super) const LABEL_PREFIX: &str = "pdf-render-";

/// Render `html_path` to `output_path`, settling `sink` when the print
/// completes, fails, or cannot be started.
pub(super) fn render_on_main_thread(
    app: &AppHandle,
    html_path: &str,
    _read_access_dir: &str,
    output_path: &str,
    page: PageSpec,
    sink: Arc<RenderSink>,
) {
    if let Err(e) = start(app, html_path, output_path, page, sink.clone()) {
        // Reached only when setup failed, i.e. no callback can ever fire.
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
    sink.progress(PdfProgress::Loading);
    let out = output_path.to_string();
    navigate_once(
        app,
        html_path,
        false,
        "VMark PDF render",
        sink,
        Box::new(move |core, app, label, sink| {
            sink.progress(PdfProgress::Rendering);
            if let Err(e) = print_to_pdf(core, &out, page, sink.clone(), app, label) {
                // The window's ONE failure path (#454) — the same one
                // `RenderWindow::fail` takes, rather than a second copy of
                // "settle, then close" that a later edit can leave half done.
                fail_render(app, label, &sink, e);
            }
        }),
    )
}

/// Configure page size and start the asynchronous print.
///
/// The three steps are separate, and each `unsafe` block is one COM call
/// (#456). A single block over the whole body covered the safe half too — the
/// completion closure, the progress reports, the teardown — so nothing in it
/// carried a claim the compiler was asking for, and every SAFETY note applied
/// to a region rather than to a call.
fn print_to_pdf(
    core: &ICoreWebView2,
    output_path: &str,
    page: PageSpec,
    sink: Arc<RenderSink>,
    app: &AppHandle,
    label: &str,
) -> Result<(), CommandError> {
    let settings = print_settings_for(core, page)?;
    let handler = completion_handler(sink, app.clone(), label.to_string());
    let path = HSTRING::from(output_path);
    // `cast` is safe (a QueryInterface wrapper); only the call is not.
    let webview7 = core
        .cast::<ICoreWebView2_7>()
        .map_err(|e| com_error("ICoreWebView2_7", &e))?;
    // SAFETY: `core` is the live webview the navigation completed on, and this
    // runs on the UI thread that owns its controller (`windows_nav::attach`).
    // `settings` and `handler` are the objects built above; `path` outlives the
    // call it is borrowed for.
    unsafe { webview7.PrintToPdf(PCWSTR(path.as_ptr()), &settings, &handler) }
        .map_err(|e| com_error("PrintToPdf", &e))
}

/// Print settings carrying the page GEOMETRY, size only: orientation is
/// already baked into these numbers, and margins belong to the CSS
/// (ADR-PDF1a).
fn print_settings_for(
    core: &ICoreWebView2,
    page: PageSpec,
) -> Result<ICoreWebView2PrintSettings, CommandError> {
    // `cast` is a safe `QueryInterface` wrapper; the interface METHODS are the
    // unsafe part, so each one gets its own block and its own reason.
    let webview2 = core
        .cast::<ICoreWebView2_2>()
        .map_err(|e| com_error("environment", &e))?;
    // SAFETY: `core` is a live webview on the UI thread that owns it, which is
    // the apartment every call here requires (`windows_nav::attach`).
    let env = unsafe { webview2.Environment() }.map_err(|e| com_error("environment", &e))?;
    let env6 = env
        .cast::<ICoreWebView2Environment6>()
        .map_err(|e| com_error("print settings", &e))?;
    // SAFETY: `env6` is the environment the live webview just handed back.
    let settings: ICoreWebView2PrintSettings =
        unsafe { env6.CreatePrintSettings() }.map_err(|e| com_error("print settings", &e))?;

    let (w_in, h_in) = page.inches();
    // SAFETY: `settings` is the object `CreatePrintSettings` just returned;
    // these are plain property writes on it.
    unsafe {
        settings
            .SetPageWidth(w_in)
            .and_then(|()| settings.SetPageHeight(h_in))
            .and_then(|()| settings.SetShouldPrintBackgrounds(true))
    }
    .map_err(|e| com_error("print geometry", &e))?;
    Ok(settings)
}

/// What `PrintToPdf` calls when the job ends: report `Finishing` on success,
/// settle the sink, and close the render window. Safe Rust — it builds a
/// callback rather than performing a COM call.
fn completion_handler(
    sink: Arc<RenderSink>,
    app: AppHandle,
    label: String,
) -> webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintToPdfCompletedHandler {
    PrintToPdfCompletedHandler::create(Box::new(move |res, success| {
        let outcome = match (&res, success) {
            (Ok(()), true) => Ok(()),
            (Ok(()), false) => Err(localized_error!(ErrorCode::Io, "errors.pdf.printRefused")),
            (Err(e), _) => Err(com_error("print", e)),
        };
        if outcome.is_ok() {
            // Before settling, so the dialog sees "finishing" before
            // `export_pdf` resumes and emits "done" after post-processing.
            sink.progress(PdfProgress::Finishing);
        }
        sink.settle(outcome);
        close(&app, &label);
        Ok(())
    }))
}

/// Tear the render window down. Teardown is explicit because a timeout is not
/// cancellation (ADR-PDF7): without it an abandoned render leaks a hidden
/// window and its Edge process for the life of the app. Every settle path
/// calls it, and so does the caller's timeout, through the close
/// `windows_nav.rs` arms the sink with (#224, #227). Idempotent: a window
/// already gone is not found, and nothing is done.
pub(super) fn close(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        // Reported, not discarded (#458). This close is the only thing standing
        // between an abandoned render and a hidden window plus its Edge process
        // living for the rest of the session; a refusal that says nothing turns
        // that leak into an unexplainable memory report. The label is printed
        // with `{:?}` so it cannot forge a log line.
        if let Err(e) = w.close() {
            log::warn!("[PDF] could not close the render window {label:?}: {e}");
        }
    }
}

/// The ONE failure path for a render window: settle, then close (#454).
///
/// [`RenderWindow::fail`] is this function; so is the `on_loaded` body's
/// failure arm in `windows.rs`, which used to spell the same two statements
/// out for itself. Two spellings of one lifecycle rule is how the close comes
/// off one of them — and a hidden window plus its Edge process then outlive
/// the export, which is exactly what #234/#237/#239 were about. Callers that
/// hold only the `(app, label)` pair `OnLoaded` gives them use this directly.
pub(super) fn fail_render<T>(
    app: &AppHandle,
    label: &str,
    sink: &RenderSink<T>,
    err: CommandError,
) {
    sink.settle(Err(err));
    close(app, label);
}

pub(super) fn window_error(detail: &str) -> CommandError {
    localized_error!(
        ErrorCode::Internal,
        "errors.pdf.renderWindowFailed",
        detail = detail
    )
}

pub(super) fn com_error(stage: &str, e: &windows_core::Error) -> CommandError {
    localized_error!(
        ErrorCode::Internal,
        "errors.pdf.comFailed",
        stage = stage,
        detail = e.message()
    )
}

/// `file://` URL for a path, percent-encoding whatever must be encoded.
///
/// Naive concatenation breaks on spaces, `#`, `%` and every non-ASCII path,
/// and a malformed URL navigates nowhere — which surfaces as an empty PDF
/// rather than as an error.
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

#[cfg(test)]
#[path = "windows.test.rs"]
mod tests;
