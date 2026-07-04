//! Window menu (macOS only) and Help menu (both platforms).
//!
//! Purpose: Builds the Window and Help menu sections for
//! `create_localized_menu`. The Help menu is a single ordered item list with
//! cfg-gated insertions: Install CLI is macOS-only, and on non-macOS the
//! About item lives here because there is no App menu.

use rust_i18n::t;
use tauri::menu::{IsMenuItem, MenuItem, PredefinedMenuItem, Submenu};

/// Build the macOS Window menu.
#[cfg(target_os = "macos")]
pub(super) fn build_window_menu(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "window-menu",
        &t!("menu.window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "window-status",
                &t!("menu.window.status"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "bring-all-to-front",
                &t!("menu.window.bringAllToFront"),
                true,
                None::<&str>,
            )?,
        ],
    )
}

/// Build the Help menu.
pub(super) fn build_help_menu(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(
            app,
            "vmark-help",
            &t!("menu.help.vmarkHelp"),
            true,
            None::<&str>,
        )?),
        Box::new(MenuItem::with_id(
            app,
            "keyboard-shortcuts",
            &t!("menu.help.keyboardShortcuts"),
            true,
            None::<&str>,
        )?),
        Box::new(PredefinedMenuItem::separator(app)?),
    ];

    // The `vmark` shell-command installer is a macOS-only dialog flow.
    #[cfg(target_os = "macos")]
    {
        items.push(Box::new(MenuItem::with_id(
            app,
            "install-cli",
            &t!("menu.help.installCli"),
            true,
            None::<&str>,
        )?));
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }

    items.push(Box::new(MenuItem::with_id(
        app,
        "report-issue",
        &t!("menu.help.reportIssue"),
        true,
        None::<&str>,
    )?));

    // Non-macOS: About lives here because there is no App menu.
    #[cfg(not(target_os = "macos"))]
    {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(MenuItem::with_id(
            app,
            "about",
            &t!("menu.app.about"),
            true,
            None::<&str>,
        )?));
    }

    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|i| &**i).collect();
    Submenu::with_id_and_items(app, "help-menu", &t!("menu.help"), true, &refs)
}
