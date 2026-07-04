//! Format-menu block submenus: Headings, Lists, Blockquote.
//!
//! Purpose: Builds the block-level child submenus of the Format menu for
//! `create_localized_menu`. Extracted verbatim from `localized.rs` to keep
//! that file under the size gate. Text-transform submenus live in
//! `format_menu.rs` alongside the Format menu assembly.

use rust_i18n::t;
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the Headings submenu.
pub(super) fn headings(
    app: &tauri::AppHandle,
    accel: &AccelFn,
) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "headings-submenu",
        &t!("menu.format.headings"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "heading-1",
                &t!("menu.format.headings.h1"),
                true,
                accel("heading-1", "CmdOrCtrl+1"),
            )?,
            &MenuItem::with_id(
                app,
                "heading-2",
                &t!("menu.format.headings.h2"),
                true,
                accel("heading-2", "CmdOrCtrl+2"),
            )?,
            &MenuItem::with_id(
                app,
                "heading-3",
                &t!("menu.format.headings.h3"),
                true,
                accel("heading-3", "CmdOrCtrl+3"),
            )?,
            &MenuItem::with_id(
                app,
                "heading-4",
                &t!("menu.format.headings.h4"),
                true,
                accel("heading-4", "CmdOrCtrl+4"),
            )?,
            &MenuItem::with_id(
                app,
                "heading-5",
                &t!("menu.format.headings.h5"),
                true,
                accel("heading-5", "CmdOrCtrl+5"),
            )?,
            &MenuItem::with_id(
                app,
                "heading-6",
                &t!("menu.format.headings.h6"),
                true,
                accel("heading-6", "CmdOrCtrl+6"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "paragraph",
                &t!("menu.format.headings.paragraph"),
                true,
                accel("paragraph", "CmdOrCtrl+Shift+0"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "increase-heading",
                &t!("menu.format.headings.increase"),
                true,
                accel("increase-heading", "CmdOrCtrl+Alt+]"),
            )?,
            &MenuItem::with_id(
                app,
                "decrease-heading",
                &t!("menu.format.headings.decrease"),
                true,
                accel("decrease-heading", "CmdOrCtrl+Alt+["),
            )?,
        ],
    )
}

/// Build the Lists submenu.
pub(super) fn lists(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "lists-submenu",
        &t!("menu.format.lists"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "ordered-list",
                &t!("menu.format.lists.ordered"),
                true,
                accel("ordered-list", "Alt+CmdOrCtrl+O"),
            )?,
            &MenuItem::with_id(
                app,
                "unordered-list",
                &t!("menu.format.lists.unordered"),
                true,
                accel("unordered-list", "Alt+CmdOrCtrl+U"),
            )?,
            &MenuItem::with_id(
                app,
                "task-list",
                &t!("menu.format.lists.task"),
                true,
                accel("task-list", "Alt+CmdOrCtrl+X"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "indent",
                &t!("menu.format.lists.indent"),
                true,
                accel("indent", "CmdOrCtrl+]"),
            )?,
            &MenuItem::with_id(
                app,
                "outdent",
                &t!("menu.format.lists.outdent"),
                true,
                accel("outdent", "CmdOrCtrl+["),
            )?,
            &MenuItem::with_id(
                app,
                "remove-list",
                &t!("menu.format.lists.remove"),
                true,
                None::<&str>,
            )?,
        ],
    )
}

/// Build the Blockquote submenu.
pub(super) fn blockquote(
    app: &tauri::AppHandle,
    accel: &AccelFn,
) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "blockquote-submenu",
        &t!("menu.format.blockquote"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "quote",
                &t!("menu.format.blockquote.toggle"),
                true,
                accel("quote", "Alt+CmdOrCtrl+Q"),
            )?,
            &MenuItem::with_id(
                app,
                "nest-blockquote",
                &t!("menu.format.blockquote.nest"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "unnest-blockquote",
                &t!("menu.format.blockquote.unnest"),
                true,
                None::<&str>,
            )?,
        ],
    )
}
