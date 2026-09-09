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
//! @coordinates-with services/navigation/pdfExportWindow.ts — the caller
//! @coordinates-with pdf_export/renderer/progress.rs — PROGRESS_WINDOW is this label

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

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
    // Close any previous export window first: it holds the PREVIOUS document's
    // rendered HTML, so focusing it would silently export the wrong file.
    if let Some(existing) = app.get_webview_window(PDF_EXPORT_LABEL) {
        let _ = existing.close();
    }

    let url = pdf_export_url(&html_path, default_name.as_deref());
    let title = rust_i18n::t!("window.pdfExport.title").to_string();

    let mut builder =
        WebviewWindowBuilder::new(&app, PDF_EXPORT_LABEL, WebviewUrl::App(url.into()))
            .title(&title)
            .inner_size(PDF_EXPORT_WIDTH, PDF_EXPORT_HEIGHT)
            .min_inner_size(PDF_EXPORT_MIN_WIDTH, PDF_EXPORT_MIN_HEIGHT)
            .resizable(true)
            .theme(Some(super::current_theme()))
            .focused(true);

    builder = match (x, y) {
        (Some(x), Some(y)) => builder.position(x, y),
        _ => builder.center(),
    };

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            // A runtime-built window does not inherit tauri.conf.json's window
            // entry, so the buttons have to be placed here too.
            .traffic_light_position(super::TRAFFIC_LIGHT_POSITION);
    }

    // THE FIX for #1377. Off macOS the menu bar is per-window, so a window
    // built without one inherits the application menu. An empty menu is what
    // the Settings window uses to stay bare.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.menu(tauri::menu::Menu::new(&app).map_err(|e| {
            localized_error!(
                ErrorCode::Internal,
                "errors.window.pdfExportMenu",
                detail = e.to_string()
            )
        })?);
    }

    builder.build().map_err(|e| {
        localized_error!(
            ErrorCode::Internal,
            "errors.window.pdfExportCreate",
            detail = e.to_string()
        )
    })?;

    Ok(PDF_EXPORT_LABEL.to_string())
}

#[cfg(test)]
#[path = "pdf_export_window.test.rs"]
mod tests;
