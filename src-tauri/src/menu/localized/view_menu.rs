//! View menu: editor modes, zoom, panels, lint navigation, fullscreen.
//!
//! Purpose: Builds the View menu section for `create_localized_menu`.
//! Extracted verbatim from `localized.rs` to keep that file under the size
//! gate. The mode items (`wysiwyg-mode`, `source-mode`, `markdown-split`)
//! are `CheckMenuItem`s whose checkmarks are kept in sync by
//! `menu::menu_state`.

use rust_i18n::t;
use tauri::menu::{CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Build the View menu.
pub(super) fn build(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    Submenu::with_id_and_items(
        app,
        "view-menu",
        &t!("menu.view"),
        true,
        &[
            &CheckMenuItem::with_id(
                app,
                "wysiwyg-mode",
                &t!("menu.view.wysiwygMode"),
                true,
                true,
                accel("wysiwyg-mode", ""),
            )?,
            &CheckMenuItem::with_id(
                app,
                "source-mode",
                &t!("menu.view.sourceMode"),
                true,
                false,
                accel("source-mode", "F6"),
            )?,
            &CheckMenuItem::with_id(
                app,
                "markdown-split",
                &t!("menu.view.markdownSplit"),
                true,
                false,
                accel("markdown-split", "Shift+F6"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "focus-mode",
                &t!("menu.view.focusMode"),
                true,
                accel("focus-mode", "F8"),
            )?,
            &MenuItem::with_id(
                app,
                "typewriter-mode",
                &t!("menu.view.typewriterMode"),
                true,
                accel("typewriter-mode", "F9"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "zoom-actual",
                &t!("menu.view.actualSize"),
                true,
                accel("zoom-actual", "CmdOrCtrl+0"),
            )?,
            &MenuItem::with_id(
                app,
                "zoom-in",
                &t!("menu.view.zoomIn"),
                true,
                accel("zoom-in", "CmdOrCtrl+="),
            )?,
            &MenuItem::with_id(
                app,
                "zoom-out",
                &t!("menu.view.zoomOut"),
                true,
                accel("zoom-out", "CmdOrCtrl+-"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "word-wrap",
                &t!("menu.view.wordWrap"),
                true,
                accel("word-wrap", "Alt+Z"),
            )?,
            &MenuItem::with_id(
                app,
                "line-numbers",
                &t!("menu.view.lineNumbers"),
                true,
                accel("line-numbers", "Alt+CmdOrCtrl+L"),
            )?,
            &MenuItem::with_id(
                app,
                "diagram-preview",
                &t!("menu.view.diagramPreview"),
                true,
                accel("diagram-preview", "Alt+CmdOrCtrl+P"),
            )?,
            &MenuItem::with_id(
                app,
                "fit-tables",
                &t!("menu.view.fitTables"),
                true,
                accel("fit-tables", ""),
            )?,
            &MenuItem::with_id(
                app,
                "read-only",
                &t!("menu.view.readOnly"),
                true,
                accel("read-only", "F10"),
            )?,
            &MenuItem::with_id(
                app,
                "show-invisibles",
                &t!("menu.view.showInvisibles"),
                true,
                accel("show-invisibles", "F3"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "outline",
                &t!("menu.view.outline"),
                true,
                accel("outline", "Ctrl+Shift+1"),
            )?,
            &MenuItem::with_id(
                app,
                "file-explorer",
                &t!("menu.view.fileExplorer"),
                true,
                accel("file-explorer", "Ctrl+Shift+2"),
            )?,
            &MenuItem::with_id(
                app,
                "view-history",
                &t!("menu.view.history"),
                true,
                accel("view-history", "Ctrl+Shift+3"),
            )?,
            &MenuItem::with_id(
                app,
                "knowledge-base",
                &t!("menu.view.knowledgeBase"),
                true,
                accel("knowledge-base", "Ctrl+Shift+4"),
            )?,
            &MenuItem::with_id(
                app,
                "toggle-terminal",
                &t!("menu.view.terminal"),
                true,
                accel("toggle-terminal", "Ctrl+`"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "check-markdown",
                &t!("menu.view.checkMarkdown"),
                true,
                accel("check-markdown", "Alt+CmdOrCtrl+V"),
            )?,
            &MenuItem::with_id(
                app,
                "lint-next",
                &t!("menu.view.lintNext"),
                true,
                accel("lint-next", "F2"),
            )?,
            &MenuItem::with_id(
                app,
                "lint-prev",
                &t!("menu.view.lintPrev"),
                true,
                accel("lint-prev", "Shift+F2"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )
}
