//! App menu (macOS only): About, Settings, Services, Hide/Show, Quit.
//!
//! Purpose: Builds the macOS application menu section for
//! `create_localized_menu`. Extracted verbatim from `localized.rs` to keep
//! that file under the size gate.

use rust_i18n::t;
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the macOS App menu.
pub(super) fn build(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "app-menu",
        &t!("menu.app"),
        true,
        &[
            &MenuItem::with_id(app, "about", &t!("menu.app.about"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "preferences",
                &t!("menu.app.settings"),
                true,
                accel("preferences", "CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "save-all-quit",
                &t!("menu.app.saveAllQuit"),
                true,
                accel("save-all-quit", "Alt+CmdOrCtrl+Shift+Q"),
            )?,
            &MenuItem::with_id(
                app,
                "quit",
                &t!("menu.app.quit"),
                true,
                accel("quit", "CmdOrCtrl+Q"),
            )?,
        ],
    )
}
