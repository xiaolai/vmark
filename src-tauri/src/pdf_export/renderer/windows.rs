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
//!
//! @coordinates-with mod.rs — dispatches here and awaits the sink
//! @coordinates-with page_spec.rs — supplies the geometry, in inches
//! @module pdf_export/renderer/windows

use std::sync::Arc;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Environment6, ICoreWebView2PrintSettings, ICoreWebView2_2,
    ICoreWebView2_7,
};
use webview2_com::{NavigationCompletedEventHandler, PrintToPdfCompletedHandler};
use windows_core::{Interface, BOOL, HSTRING, PCWSTR};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::pdf_export::page_spec::PageSpec;

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
    let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let file_url = path_to_file_url(html_path)?;

    let blank = "about:blank".parse().expect("about:blank parses");
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(false)
        .title("VMark PDF render")
        .build()
        .map_err(|e| window_error(&e.to_string()))?;

    let out = output_path.to_string();
    let app_cb = app.clone();
    let label_cb = label.clone();

    window
        .with_webview(move |pw| {
            // SAFETY: `with_webview` runs on the UI thread that owns the
            // controller — the apartment every call below requires.
            let core = match unsafe { pw.controller().CoreWebView2() } {
                Ok(c) => c,
                Err(e) => {
                    sink.settle(Err(com_error("core", &e)));
                    close(&app_cb, &label_cb);
                    return;
                }
            };

            let sink_nav = sink.clone();
            let app_nav = app_cb.clone();
            let label_nav = label_cb.clone();
            let core_nav = core.clone();

            let handler =
                NavigationCompletedEventHandler::create(Box::new(move |_sender, args| {
                    // A FAILED navigation fires this too. Without the flag a
                    // missing file would print an empty document and report
                    // success — the shape of failure that is hardest to see.
                    let ok = args
                        .as_ref()
                        .map(|a| {
                            let mut success = BOOL::default();
                            unsafe { a.IsSuccess(&mut success) }.is_ok() && success.as_bool()
                        })
                        .unwrap_or(false);
                    if !ok {
                        sink_nav.settle(Err(localized_error!(
                            ErrorCode::Io,
                            "errors.pdf.loadFailed"
                        )));
                        close(&app_nav, &label_nav);
                        return Ok(());
                    }
                    if let Err(e) = print_to_pdf(
                        &core_nav,
                        &out,
                        page,
                        sink_nav.clone(),
                        &app_nav,
                        &label_nav,
                    ) {
                        sink_nav.settle(Err(e));
                        close(&app_nav, &label_nav);
                    }
                    Ok(())
                }));

            let mut token = Default::default();
            if let Err(e) = unsafe { core.add_NavigationCompleted(&handler, &mut token) } {
                sink.settle(Err(com_error("navigation handler", &e)));
                close(&app_cb, &label_cb);
                return;
            }

            let url = HSTRING::from(file_url.as_str());
            if let Err(e) = unsafe { core.Navigate(PCWSTR(url.as_ptr())) } {
                sink.settle(Err(com_error("navigate", &e)));
                close(&app_cb, &label_cb);
            }
        })
        .map_err(|e| window_error(&e.to_string()))?;

    Ok(())
}

/// Configure page size and start the asynchronous print.
fn print_to_pdf(
    core: &ICoreWebView2,
    output_path: &str,
    page: PageSpec,
    sink: Arc<RenderSink>,
    app: &AppHandle,
    label: &str,
) -> Result<(), CommandError> {
    unsafe {
        let env = core
            .cast::<ICoreWebView2_2>()
            .and_then(|v| v.Environment())
            .map_err(|e| com_error("environment", &e))?;
        let settings: ICoreWebView2PrintSettings = env
            .cast::<ICoreWebView2Environment6>()
            .and_then(|e6| e6.CreatePrintSettings())
            .map_err(|e| com_error("print settings", &e))?;

        // Size only. Orientation is already baked into these numbers, and
        // margins belong to the CSS (ADR-PDF1a).
        let (w_in, h_in) = page.inches();
        settings
            .SetPageWidth(w_in)
            .and_then(|()| settings.SetPageHeight(h_in))
            .and_then(|()| settings.SetShouldPrintBackgrounds(true))
            .map_err(|e| com_error("print geometry", &e))?;

        let app_done = app.clone();
        let label_done = label.to_string();
        let path = HSTRING::from(output_path);
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |res, success| {
            let outcome = match (&res, success) {
                (Ok(()), true) => Ok(()),
                (Ok(()), false) => Err(localized_error!(ErrorCode::Io, "errors.pdf.printRefused")),
                (Err(e), _) => Err(com_error("print", e)),
            };
            sink.settle(outcome);
            close(&app_done, &label_done);
            Ok(())
        }));

        core.cast::<ICoreWebView2_7>()
            .map_err(|e| com_error("ICoreWebView2_7", &e))?
            .PrintToPdf(PCWSTR(path.as_ptr()), &settings, &handler)
            .map_err(|e| com_error("PrintToPdf", &e))?;
    }
    Ok(())
}

/// Tear the render window down. Teardown is explicit because a timeout is not
/// cancellation (ADR-PDF7): without it an abandoned render leaks a hidden
/// window and its Edge process for the life of the app.
pub(super) fn close(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
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
