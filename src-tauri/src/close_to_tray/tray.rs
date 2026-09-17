//! # The tray icon itself (Windows only, #1419)
//!
//! Compiled only on Windows because `tauri::tray` exists only with the
//! `tray-icon` feature, which `Cargo.toml` enables for that target alone.
//!
//! Every operation here is idempotent, keyed on one tray id: the webview pushes
//! the preference on mount and on every change, so "install" and "remove" are
//! routinely asked for something that is already true.
//!
//! @coordinates-with close_to_tray/mod.rs — `set_close_to_tray` calls `apply`
//! @coordinates-with quit.rs — `start_quit` calls `restore_hidden_windows`
//! @module close_to_tray/tray

use rust_i18n::t;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::command_error::CommandError;

/// The one tray icon this feature owns.
const TRAY_ID: &str = "vmark-close-to-tray";
const MENU_SHOW: &str = "tray-show";
const MENU_QUIT: &str = "tray-quit";

/// Install or remove the tray to match the preference.
///
/// Removing restores any parked window FIRST. Turning the setting off while
/// the last window sits in the tray would otherwise delete the only way back
/// to it, leaving a running app with no window and no icon.
pub(super) fn apply(app: &AppHandle, enabled: bool) -> Result<(), CommandError> {
    if enabled {
        return install(app);
    }
    restore_hidden_windows(app);
    let _ = app.remove_tray_by_id(TRAY_ID);
    Ok(())
}

fn install(app: &AppHandle) -> Result<(), CommandError> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let tray_failed = |e: tauri::Error| CommandError::internal(format!("tray icon: {e}"));

    let show = MenuItem::with_id(app, MENU_SHOW, &t!("tray.show"), true, None::<&str>)
        .map_err(tray_failed)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, &t!("menu.app.quit"), true, None::<&str>)
        .map_err(tray_failed)?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(tray_failed)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(&t!("menu.app"))
        .menu(&menu)
        // Left click brings the window back — the gesture every tray app uses.
        // The menu stays on right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => restore_hidden_windows(app),
            // Straight to the quit flow, past the double-press gate: that gate
            // guards an accidental keystroke, and this is a deliberate menu
            // choice. `start_quit` restores the parked window itself first.
            MENU_QUIT => crate::quit::start_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_hidden_windows(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app).map_err(tray_failed)?;
    Ok(())
}

/// Bring every document window back into view and focus it.
///
/// Called before any quit as well as from the tray: quit asks each document
/// window to run its save flow, and an unsaved-changes prompt raised by a
/// HIDDEN window is one nobody can answer — the quit would hang on it.
pub(crate) fn restore_hidden_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if !crate::quit::is_document_window_label(&label) {
            continue;
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
