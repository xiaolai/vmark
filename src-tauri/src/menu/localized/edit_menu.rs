//! Edit menu: undo/redo, clipboard, Find, Selection, Lines, Line Endings.
//!
//! Purpose: Builds the Edit menu section for `create_localized_menu`.
//! Extracted verbatim from `localized.rs` to keep that file under the size
//! gate.

use rust_i18n::t;
use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the Edit menu.
pub(super) fn build(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    let find_submenu = Submenu::with_id_and_items(
        app,
        "find-submenu",
        &t!("menu.edit.find"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "find-replace",
                &t!("menu.edit.findReplace"),
                true,
                accel("find-replace", "CmdOrCtrl+F"),
            )?,
            &MenuItem::with_id(
                app,
                "find-next",
                &t!("menu.edit.findNext"),
                true,
                accel("find-next", "CmdOrCtrl+G"),
            )?,
            &MenuItem::with_id(
                app,
                "find-prev",
                &t!("menu.edit.findPrev"),
                true,
                accel("find-prev", "CmdOrCtrl+Shift+G"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "use-selection-find",
                &t!("menu.edit.useSelectionFind"),
                true,
                accel("use-selection-find", "CmdOrCtrl+E"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "find-in-files",
                &t!("menu.edit.findInFiles"),
                true,
                accel("find-in-files", "CmdOrCtrl+Shift+H"),
            )?,
        ],
    )?;

    let selection_submenu = Submenu::with_id_and_items(
        app,
        "selection-submenu",
        &t!("menu.edit.selection"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "select-word",
                &t!("menu.edit.selection.word"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "select-line",
                &t!("menu.edit.selection.line"),
                true,
                accel("select-line", "CmdOrCtrl+L"),
            )?,
            &MenuItem::with_id(
                app,
                "select-block",
                &t!("menu.edit.selection.block"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "expand-selection",
                &t!("menu.edit.selection.expand"),
                true,
                accel("expand-selection", "Ctrl+Shift+Up"),
            )?,
        ],
    )?;

    let lines_submenu = Submenu::with_id_and_items(
        app,
        "lines-submenu",
        &t!("menu.edit.lines"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "move-line-up",
                &t!("menu.edit.lines.moveUp"),
                true,
                accel("move-line-up", "Alt+Up"),
            )?,
            &MenuItem::with_id(
                app,
                "move-line-down",
                &t!("menu.edit.lines.moveDown"),
                true,
                accel("move-line-down", "Alt+Down"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "duplicate-line",
                &t!("menu.edit.lines.duplicate"),
                true,
                accel("duplicate-line", "Shift+Alt+Down"),
            )?,
            &MenuItem::with_id(
                app,
                "delete-line",
                &t!("menu.edit.lines.delete"),
                true,
                accel("delete-line", "CmdOrCtrl+Shift+K"),
            )?,
            &MenuItem::with_id(
                app,
                "join-lines",
                &t!("menu.edit.lines.join"),
                true,
                accel("join-lines", "CmdOrCtrl+J"),
            )?,
            &MenuItem::with_id(
                app,
                "remove-blank-lines",
                &t!("menu.edit.lines.removeBlank"),
                true,
                accel("remove-blank-lines", ""),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "sort-lines-asc",
                &t!("menu.edit.lines.sortAsc"),
                true,
                accel("sort-lines-asc", "F4"),
            )?,
            &MenuItem::with_id(
                app,
                "sort-lines-desc",
                &t!("menu.edit.lines.sortDesc"),
                true,
                accel("sort-lines-desc", "Shift+F4"),
            )?,
        ],
    )?;

    let line_endings_submenu = Submenu::with_id_and_items(
        app,
        "line-endings-submenu",
        &t!("menu.edit.lineEndings"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "line-endings-lf",
                &t!("menu.edit.lineEndings.lf"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "line-endings-crlf",
                &t!("menu.edit.lineEndings.crlf"),
                true,
                None::<&str>,
            )?,
        ],
    )?;

    Submenu::with_id_and_items(
        app,
        "edit-menu",
        &t!("menu.edit"),
        true,
        &[
            &MenuItem::with_id(
                app,
                "undo",
                &t!("menu.edit.undo"),
                true,
                accel("undo", "CmdOrCtrl+Z"),
            )?,
            &MenuItem::with_id(
                app,
                "redo",
                &t!("menu.edit.redo"),
                true,
                accel("redo", "CmdOrCtrl+Shift+Z"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &find_submenu,
            &selection_submenu,
            &lines_submenu,
            &line_endings_submenu,
        ],
    )
}
