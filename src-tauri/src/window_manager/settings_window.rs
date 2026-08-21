//! Settings window singleton: create, re-focus, and section navigation.
//!
//! Key decision: the settings window is a singleton — re-shown and focused
//! if already open, with `settings:navigate` emitted for section jumps.
//!
//! Key decision: creation is IDEMPOTENT, not merely guarded by the
//! exists-check at the top. Once `open_settings_window` became
//! `#[tauri::command(async)]` (see `mod.rs` — the Windows deadlock), two rapid
//! clicks stopped being serialized by the IPC loop and can now both observe
//! "no settings window" before either builds. Exactly one `build()` wins,
//! because labels are registered on the main thread; the loser focuses the
//! winner's window instead of surfacing `WindowLabelAlreadyExists` as an error
//! the user cannot act on. A mutex around check-then-create would have been the
//! obvious alternative and is the WRONG one: the non-macOS branch calls
//! `Menu::new`, which blocks on the main thread, so a worker holding the lock
//! while the main thread runs the menu's own Preferences handler would deadlock
//! — reintroducing, from the other side, the bug this file was changed to fix.

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Create or focus the settings window.
/// If settings window exists, focuses it. Otherwise creates a new one.
/// Returns the window label on success.
pub fn show_settings_window(app: &AppHandle) -> Result<String, tauri::Error> {
    show_settings_window_section(app, None)
}

/// Tauri command wrapper for frontend Settings entry points.
/// `(async)` is required: a sync command creates the window on the main thread,
/// which deadlocks WebView2 on Windows (#1301). See `window_manager/mod.rs`.
#[tauri::command(async)]
pub fn open_settings_window(app: AppHandle, section: Option<String>) -> Result<String, String> {
    show_settings_window_section(&app, section.as_deref().filter(|s| !s.is_empty()))
        .map_err(|e| e.to_string())
}

/// Build the Settings window URL for an optional section.
///
/// The section is percent-encoded so a value containing reserved characters
/// (`&`, `?`, `#`) cannot corrupt the query or append a fragment.
fn settings_url(section: Option<&str>) -> String {
    match section {
        Some(s) => format!("/settings?section={}", urlencoding::encode(s)),
        None => "/settings".to_string(),
    }
}

/// The singleton's window label.
pub(super) const SETTINGS_LABEL: &str = "settings";

/// Reveal an already-open Settings window and jump to `section`.
///
/// Returns `false` when there is no such window, so a caller can tell "focused
/// it" from "nothing to focus" without a second lookup.
fn focus_existing<R: Runtime>(app: &AppHandle<R>, section: Option<&str>) -> bool {
    use tauri::Emitter;

    let Some(window) = app.get_webview_window(SETTINGS_LABEL) else {
        return false;
    };
    // Unminimize if minimized
    if window.is_minimized().unwrap_or(false) {
        log::debug!("[window_manager] Settings was minimized, unminimizing");
        let _ = window.unminimize();
    }
    // Show and focus
    let _ = window.show();
    let _ = window.set_focus();
    // Navigate to section if specified
    if let Some(s) = section {
        let _ = window.emit("settings:navigate", s);
    }
    true
}

/// Create or focus the settings window, optionally navigating to a specific section.
/// If settings window exists, focuses it and navigates to the section.
/// Otherwise creates a new one with the section in the URL.
///
/// Generic over the runtime so a mock app can exercise the concurrent-create
/// path (`settings_window.test.rs`); the `#[tauri::command]` wrapper above is
/// unaffected and still resolves to `Wry`.
pub fn show_settings_window_section<R: Runtime>(
    app: &AppHandle<R>,
    section: Option<&str>,
) -> Result<String, tauri::Error> {
    const SETTINGS_WIDTH: f64 = 760.0;
    const SETTINGS_HEIGHT: f64 = 540.0;
    const SETTINGS_MIN_WIDTH: f64 = 600.0;
    const SETTINGS_MIN_HEIGHT: f64 = 400.0;

    // If settings window exists, bring it to front, focus, and navigate to section
    if focus_existing(app, section) {
        log::debug!("[window_manager] Settings window exists, focusing it");
        return Ok(SETTINGS_LABEL.to_string());
    }

    log::debug!("[window_manager] Creating new settings window");

    let url = settings_url(section);

    // Create new settings window.
    //
    // On Linux/GTK, creating the window hidden and then changing size/position
    // before show can leave the native titlebar hit-test region stale until the
    // first maximize/unmaximize cycle. Create non-macOS settings windows with
    // their final geometry up front so close/minimize/maximize respond
    // immediately.
    let settings_title = rust_i18n::t!("window.settings.title").to_string();
    let mut builder = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App(url.into()))
        .title(&settings_title)
        .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
        .min_inner_size(SETTINGS_MIN_WIDTH, SETTINGS_MIN_HEIGHT)
        .resizable(true)
        // Match the OS-drawn title bar to the in-app theme from the first
        // frame. Setting it after build would flash a light title bar on a
        // dark theme; on macOS this is a no-op (overlay title bar).
        .theme(Some(super::current_theme()))
        .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            // A runtime-built window does not inherit tauri.conf.json's window
            // entry, so the buttons have to be placed here too — see
            // super::TRAFFIC_LIGHT_POSITION.
            .traffic_light_position(super::TRAFFIC_LIGHT_POSITION)
            .visible(false);
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder
            .menu(tauri::menu::Menu::new(app)?)
            .center()
            .visible(true);
    }

    let window = match builder.build() {
        Ok(window) => window,
        // A concurrent call already built it (see the module header). The
        // window the user asked for exists, so this is success, not an error —
        // and the section they asked for still has to be delivered.
        Err(e) => {
            return if focus_existing(app, section) {
                log::debug!("[window_manager] Settings was created concurrently, focusing it");
                Ok(SETTINGS_LABEL.to_string())
            } else {
                Err(e)
            };
        }
    };

    #[cfg(target_os = "macos")]
    {
        // Override any restored state by explicitly setting size and centering.
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: SETTINGS_WIDTH,
            height: SETTINGS_HEIGHT,
        }));
        let _ = window.center();
        let _ = window.show();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;

    Ok(SETTINGS_LABEL.to_string())
}

#[cfg(test)]
#[path = "settings_window.test.rs"]
mod tests;
