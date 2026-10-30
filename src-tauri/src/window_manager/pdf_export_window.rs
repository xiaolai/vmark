//! Export-PDF window: built in Rust so it can be given an EMPTY menu.
//!
//! Key decision: this window is created here rather than from the frontend
//! (#1377). It used to be `new WebviewWindow("pdf-export", …)` in
//! `services/navigation/pdfExportWindow.ts`, and Tauri's JS window options
//! carry no `menu` field — so on Linux and Windows, where the menu bar belongs
//! to each window rather than to the app, a 440x640 utility dialog opened with
//! the whole File/Edit/Format/Insert/View/Help bar attached. None of those
//! actions apply to it.
//!
//! The Settings window never had that problem because it is built in Rust and
//! passes `.menu(Menu::new(app)?)` — an empty menu — under
//! `cfg(not(target_os = "macos"))`. That is the mechanism, and this file exists
//! to reuse it.
//!
//! On macOS the menu bar is app-global, so there is nothing to suppress and no
//! `.menu()` call — passing one there would replace the application menu.
//!
//! Key decision: `(async)`, like every other window-creating command here. A
//! sync command runs on the thread that delivered the IPC message, which on
//! Windows is inside WebView2's `WebMessageReceived` callback, and building a
//! webview there is the reentrancy case WebView2 forbids (#1301, #1302). See
//! `window_manager/mod.rs`.
//!
//! Key decision: the singleton is CLOSE-then-recreate, not focus-existing. The
//! window renders one specific document's HTML, handed to it as a temp-file
//! path, so re-focusing a stale one would show the previous export. This
//! preserves the behaviour the TypeScript had.
//!
//! Key decision: the recreate WAITS for the close. `close()` only posts a
//! request, and the label stays registered until Tauri delivers `Destroyed`;
//! building before that fails with `WindowLabelAlreadyExists`. The wait is
//! bounded and its expiry is an error the caller sees. The label itself stays
//! fixed — the capability file, the progress events, the window-state denylist
//! and the page's own close handler all address the window by this name — and
//! the build goes through `ensure_window` like every other fixed label.
//!
//! @coordinates-with services/navigation/pdfExportWindow.ts — the caller
//! @coordinates-with pdf_export/renderer/progress.rs — PROGRESS_WINDOW is this label
//! @coordinates-with window_creation.rs — check-and-build as one step
//! @coordinates-with temp_html.rs — the HTML hand-off, discarded on `Destroyed`

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{ensure_window, Ensured};
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::temp_html::{discard_temp_html, temp_html_dir};

/// The window label. `pdf_export::renderer::progress` emits to this same name,
/// and `app_plugins.rs` denylists it from window-state persistence.
pub const PDF_EXPORT_LABEL: &str = "pdf-export";

const PDF_EXPORT_WIDTH: f64 = 440.0;
const PDF_EXPORT_HEIGHT: f64 = 640.0;
const PDF_EXPORT_MIN_WIDTH: f64 = 380.0;
const PDF_EXPORT_MIN_HEIGHT: f64 = 480.0;

/// Build the page URL. Both values are percent-encoded, so a path or document
/// title containing `&`, `?` or `#` cannot corrupt the query or append a
/// fragment — the same reasoning as `settings_url`.
fn pdf_export_url(html_path: &str, default_name: Option<&str>) -> String {
    let mut url = format!("/pdf-export?htmlPath={}", urlencoding::encode(html_path));
    if let Some(name) = default_name.filter(|n| !n.is_empty()) {
        url.push_str(&format!("&defaultName={}", urlencoding::encode(name)));
    }
    url
}

/// Open the Export PDF window on `html_path`, replacing any existing one.
///
/// `x`/`y` are logical coordinates for centring over the calling window; when
/// absent the window centres itself. Tauri decides between explicit placement
/// and its own default by whether a position was set at all, so the two are
/// mutually exclusive rather than both being applied.
#[tauri::command(async)]
pub fn open_pdf_export_window(
    app: AppHandle,
    html_path: String,
    default_name: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, CommandError> {
    let url = pdf_export_url(&html_path, default_name.as_deref());
    let label = open_export_window(&app, url, x.zip(y), PREVIOUS_WINDOW_CLOSE_LIMIT)?;
    if let (Some(window), Ok(dir)) = (app.get_webview_window(&label), temp_html_dir(&app)) {
        let path = PathBuf::from(html_path);
        window.on_window_event(move |event| discard_html_when_destroyed(event, &dir, &path));
    }
    Ok(label)
}

/// The window's HTML is a one-reader hand-off: once the window is gone,
/// nothing reads the file again, so it is removed then rather than left for
/// the hour-old sweep in `temp_html`. Waiting for `Destroyed` (not deleting
/// after the page's first read) keeps a page reload able to read it again.
fn discard_html_when_destroyed(event: &tauri::WindowEvent, dir: &Path, path: &Path) {
    if matches!(event, tauri::WindowEvent::Destroyed) {
        discard_temp_html(dir, path);
    }
}

/// How long the previous export window may take to go away. Destruction takes
/// milliseconds; this bounds a window that refuses to close, so the command
/// fails with a reason instead of hanging.
const PREVIOUS_WINDOW_CLOSE_LIMIT: Duration = Duration::from_secs(5);

/// "The Export PDF window could not be opened", with the reason.
fn open_failed(code: ErrorCode, detail: String) -> CommandError {
    localized_error!(code, "errors.window.pdfExportCreate", detail = detail)
}

/// The command's body, generic over the runtime and with the close limit a
/// parameter so `pdf_export_window.test.rs` can drive it on a mock app.
///
/// Must not run on the main thread: it waits for a `Destroyed` event that is
/// delivered there. The command is `async`, so it runs on a worker.
fn open_export_window<R: Runtime>(
    app: &AppHandle<R>,
    url: String,
    position: Option<(f64, f64)>,
    close_limit: Duration,
) -> Result<String, CommandError> {
    // Close any previous export window first: it holds the PREVIOUS document's
    // rendered HTML, so focusing it would silently export the wrong file.
    if let Some(previous) = app.get_webview_window(PDF_EXPORT_LABEL) {
        close_and_await_destroyed(&previous, close_limit)?;
    }

    // THE FIX for #1377. Off macOS the menu bar is per-window, so a window
    // built without one inherits the application menu. An empty menu is what
    // the Settings window uses to stay bare.
    #[cfg(not(target_os = "macos"))]
    let menu = tauri::menu::Menu::new(app).map_err(|e| {
        localized_error!(
            ErrorCode::Internal,
            "errors.window.pdfExportMenu",
            detail = e.to_string()
        )
    })?;

    let ensured = ensure_window(app, PDF_EXPORT_LABEL, move |app, label| {
        let title = rust_i18n::t!("window.pdfExport.title").to_string();
        let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
            .title(&title)
            .inner_size(PDF_EXPORT_WIDTH, PDF_EXPORT_HEIGHT)
            .min_inner_size(PDF_EXPORT_MIN_WIDTH, PDF_EXPORT_MIN_HEIGHT)
            .resizable(true)
            .theme(Some(super::current_theme()))
            .focused(true);

        builder = match position {
            Some((x, y)) => builder.position(x, y),
            None => builder.center(),
        };

        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                // A runtime-built window does not inherit tauri.conf.json's
                // window entry, so the buttons have to be placed here too.
                .traffic_light_position(super::TRAFFIC_LIGHT_POSITION);
        }

        #[cfg(not(target_os = "macos"))]
        {
            builder = builder.menu(menu);
        }

        builder.build()
    })
    .map_err(|e| open_failed(ErrorCode::Internal, e.to_string()))?;

    match ensured {
        Ensured::Created(_) => Ok(PDF_EXPORT_LABEL.to_string()),
        // The label is held by a window this call did not build: one that
        // outlived its close, or another export opened in the same instant.
        // Showing it would show the wrong document, so say so instead.
        Ensured::Existing(_) | Ensured::Pending => Err(open_failed(
            ErrorCode::Conflict,
            "another Export PDF window still holds the label".to_string(),
        )),
    }
}

/// Ask the previous export window to close and wait until Tauri reports it
/// destroyed, which is when its label is free again.
///
/// `close()` only posts a request to the event loop. Rebuilding the label
/// straight after it raced the old window's teardown and failed, some of the
/// time, with `WindowLabelAlreadyExists`.
fn close_and_await_destroyed<R: Runtime>(
    window: &WebviewWindow<R>,
    limit: Duration,
) -> Result<(), CommandError> {
    let (destroyed, gone) = mpsc::channel();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = destroyed.send(());
        }
    });
    window
        .close()
        .map_err(|e| open_failed(ErrorCode::Internal, e.to_string()))?;
    await_destroyed(&gone, limit)
}

/// Wait up to `limit` for the `Destroyed` signal.
fn await_destroyed(gone: &mpsc::Receiver<()>, limit: Duration) -> Result<(), CommandError> {
    match gone.recv_timeout(limit) {
        // Destroyed — or its listeners were dropped without the event, which
        // only a window that is already gone does. Either way the label check
        // in `ensure_window` is what decides whether to build.
        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => Ok(()),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(open_failed(
            ErrorCode::Timeout,
            format!(
                "the previous Export PDF window did not close within {} ms",
                limit.as_millis()
            ),
        )),
    }
}

#[cfg(test)]
#[path = "pdf_export_window.test.rs"]
mod tests;
