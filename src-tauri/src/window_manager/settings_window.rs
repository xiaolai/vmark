//! Settings window singleton: create, re-focus, and section navigation.
//!
//! Key decision: the settings window is a singleton — re-shown and focused
//! if already open, with `settings:navigate` emitted for section jumps.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Create or focus the settings window.
/// If settings window exists, focuses it. Otherwise creates a new one.
/// Returns the window label on success.
pub fn show_settings_window(app: &AppHandle) -> Result<String, tauri::Error> {
    show_settings_window_section(app, None)
}

/// Tauri command wrapper for frontend Settings entry points.
#[tauri::command]
pub fn open_settings_window(app: AppHandle, section: Option<String>) -> Result<String, String> {
    show_settings_window_section(&app, section.as_deref().filter(|s| !s.is_empty()))
        .map_err(|e| e.to_string())
}

/// Create or focus the settings window, optionally navigating to a specific section.
/// If settings window exists, focuses it and navigates to the section.
/// Otherwise creates a new one with the section in the URL.
pub fn show_settings_window_section(
    app: &AppHandle,
    section: Option<&str>,
) -> Result<String, tauri::Error> {
    use tauri::Emitter;

    const SETTINGS_LABEL: &str = "settings";
    const SETTINGS_WIDTH: f64 = 760.0;
    const SETTINGS_HEIGHT: f64 = 540.0;
    const SETTINGS_MIN_WIDTH: f64 = 600.0;
    const SETTINGS_MIN_HEIGHT: f64 = 400.0;

    // If settings window exists, bring it to front, focus, and navigate to section
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        log::debug!("[window_manager] Settings window exists, focusing it");
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
        return Ok(SETTINGS_LABEL.to_string());
    }

    log::debug!("[window_manager] Creating new settings window");

    // Build URL with optional section query param. Percent-encode the section
    // so a value containing reserved chars (&, ?, #) can't corrupt the query.
    let url = match section {
        Some(s) => format!("/settings?section={}", urlencoding::encode(s)),
        None => "/settings".to_string(),
    };

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
        .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .visible(false);
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder
            .menu(tauri::menu::Menu::new(app)?)
            .center()
            .visible(true);
    }

    let window = builder.build()?;

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

    Ok(SETTINGS_LABEL.to_string())
}
