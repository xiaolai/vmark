//! Format menu (merged: Block + Format + Tools).
//!
//! Purpose: Builds the Format menu section for `create_localized_menu`.
//! Extracted verbatim from `localized.rs` to keep that file under the size
//! gate. Block-level child submenus (Headings, Lists, Blockquote) come from
//! `format_submenus`; the Transform/CJK/Cleanup submenus are built here.

use rust_i18n::t;
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the Format menu.
pub(super) fn build(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    let headings_submenu = super::format_submenus::headings(app, accel)?;
    let lists_submenu = super::format_submenus::lists(app, accel)?;
    let blockquote_submenu = super::format_submenus::blockquote(app, accel)?;

    let transform_submenu = Submenu::with_id_and_items(
        app,
        "transform-submenu",
        &t!("menu.format.transform"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "transform-uppercase",
                &t!("menu.format.transform.uppercase"),
                true,
                accel(
                    "transform-uppercase",
                    if cfg!(target_os = "macos") {
                        "Ctrl+Shift+U"
                    } else {
                        "Alt+Shift+U"
                    },
                ),
            )?,
            &MenuItem::with_id(
                app,
                "transform-lowercase",
                &t!("menu.format.transform.lowercase"),
                true,
                accel(
                    "transform-lowercase",
                    if cfg!(target_os = "macos") {
                        "Ctrl+Shift+L"
                    } else {
                        "Alt+Shift+L"
                    },
                ),
            )?,
            &MenuItem::with_id(
                app,
                "transform-title-case",
                &t!("menu.format.transform.titleCase"),
                true,
                accel(
                    "transform-title-case",
                    if cfg!(target_os = "macos") {
                        "Ctrl+Shift+T"
                    } else {
                        "Alt+Shift+T"
                    },
                ),
            )?,
            &MenuItem::with_id(
                app,
                "transform-toggle-case",
                &t!("menu.format.transform.toggleCase"),
                true,
                accel("transform-toggle-case", ""),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "toggle-quote-style",
                &t!("menu.format.transform.toggleQuoteStyle"),
                true,
                accel("toggle-quote-style", "Shift+CmdOrCtrl+'"),
            )?,
        ],
    )?;

    let cjk_submenu = Submenu::with_id_and_items(
        app,
        "cjk-submenu",
        &t!("menu.format.cjk"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "format-cjk",
                &t!("menu.format.cjk.selection"),
                true,
                accel("format-cjk", "CmdOrCtrl+Shift+F"),
            )?,
            &MenuItem::with_id(
                app,
                "format-cjk-file",
                &t!("menu.format.cjk.file"),
                true,
                accel("format-cjk-file", "Alt+CmdOrCtrl+Shift+F"),
            )?,
        ],
    )?;

    let cleanup_submenu = Submenu::with_id_and_items(
        app,
        "text-cleanup-submenu",
        &t!("menu.format.cleanup"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "remove-trailing-spaces",
                &t!("menu.format.cleanup.trailingSpaces"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "collapse-blank-lines",
                &t!("menu.format.cleanup.collapseBlankLines"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "cleanup-images",
                &t!("menu.format.cleanup.images"),
                true,
                None::<&str>,
            )?,
        ],
    )?;

    Submenu::with_id_and_items(
        app,
        "format-menu",
        &t!("menu.format"),
        true,
        &[
            &headings_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "bold",
                &t!("menu.format.bold"),
                true,
                accel("bold", "CmdOrCtrl+B"),
            )?,
            &MenuItem::with_id(
                app,
                "italic",
                &t!("menu.format.italic"),
                true,
                accel("italic", "CmdOrCtrl+I"),
            )?,
            &MenuItem::with_id(
                app,
                "underline",
                &t!("menu.format.underline"),
                true,
                accel("underline", "CmdOrCtrl+U"),
            )?,
            &MenuItem::with_id(
                app,
                "strikethrough",
                &t!("menu.format.strikethrough"),
                true,
                accel("strikethrough", "CmdOrCtrl+Shift+X"),
            )?,
            &MenuItem::with_id(
                app,
                "code",
                &t!("menu.format.inlineCode"),
                true,
                accel("code", "CmdOrCtrl+Shift+`"),
            )?,
            &MenuItem::with_id(
                app,
                "highlight",
                &t!("menu.format.highlight"),
                true,
                accel("highlight", "CmdOrCtrl+Shift+M"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "subscript",
                &t!("menu.format.subscript"),
                true,
                accel("subscript", "Alt+CmdOrCtrl+="),
            )?,
            &MenuItem::with_id(
                app,
                "superscript",
                &t!("menu.format.superscript"),
                true,
                accel("superscript", "Alt+CmdOrCtrl+Shift+="),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &lists_submenu,
            &blockquote_submenu,
            &PredefinedMenuItem::separator(app)?,
            &transform_submenu,
            &cjk_submenu,
            &cleanup_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "clear-format",
                &t!("menu.format.clearFormat"),
                true,
                accel("clear-format", "CmdOrCtrl+\\"),
            )?,
        ],
    )
}
