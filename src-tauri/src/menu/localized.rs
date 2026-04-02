//! Localized menu builder (unified).
//!
//! Purpose: Creates the application menu with localized labels and optional custom
//! keyboard shortcuts. Replaces both `default_menu.rs` and `custom_menu.rs` with
//! a single code path.
//!
//! @coordinates-with `en.yml` (locale strings)
//! @coordinates-with `macos_menu.rs` (applies SF Symbol icons post-build)
//! @coordinates-with `commands.rs` (calls this on rebuild)

use std::collections::HashMap;

use rust_i18n::t;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

use super::{RECENT_FILES_SUBMENU_ID, RECENT_WORKSPACES_SUBMENU_ID};

/// Build the application menu with localized labels and optional custom shortcuts.
///
/// When `custom_shortcuts` is `None`, default accelerators are used (startup path).
/// When `Some`, the map overrides defaults: `menu_item_id -> accelerator_string`.
pub fn create_localized_menu(
    app: &tauri::AppHandle,
    custom_shortcuts: Option<&HashMap<String, String>>,
) -> tauri::Result<Menu<tauri::Wry>> {
    // Helper: resolve accelerator from custom map or use default.
    // Returns `Some(accel)` or `None` if the resolved string is empty.
    let accel = |id: &str, default: &str| -> Option<String> {
        let value = custom_shortcuts
            .and_then(|map| map.get(id).map(|s| s.as_str()))
            .unwrap_or(default);
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    };

    // ========================================================================
    // App menu (macOS only)
    // ========================================================================
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_id_and_items(
        app,
        "app-menu",
        &t!("menu.app").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "about", &t!("menu.app.about").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "preferences", &t!("menu.app.settings").to_string(), true, accel("preferences", "CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save-all-quit", &t!("menu.app.saveAllQuit").to_string(), true, accel("save-all-quit", "Alt+Shift+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "quit", &t!("menu.app.quit").to_string(), true, accel("quit", "CmdOrCtrl+Q"))?,
        ],
    )?;

    // ========================================================================
    // File menu
    // ========================================================================
    let recent_submenu = Submenu::with_id_and_items(
        app,
        RECENT_FILES_SUBMENU_ID,
        &t!("menu.file.openRecent").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "no-recent", &t!("menu.recentFiles.empty").to_string(), false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-recent", &t!("menu.recentFiles.clear").to_string(), true, None::<&str>)?,
        ],
    )?;

    let recent_workspaces_submenu = Submenu::with_id_and_items(
        app,
        RECENT_WORKSPACES_SUBMENU_ID,
        &t!("menu.file.openRecentWorkspace").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "no-recent-workspace", &t!("menu.recentWorkspaces.empty").to_string(), false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-recent-workspaces", &t!("menu.recentWorkspaces.clear").to_string(), true, None::<&str>)?,
        ],
    )?;

    let export_submenu = Submenu::with_id_and_items(
        app,
        "export-submenu",
        &t!("menu.file.export").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "export-html", &t!("menu.file.export.html").to_string(), true, accel("export-html", ""))?,
            &MenuItem::with_id(app, "export-pdf-native", &t!("menu.file.export.pdf").to_string(), true, accel("export-pdf-native", ""))?,
            &{
                let mut items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = vec![
                    Box::new(MenuItem::with_id(app, "export-pandoc-docx", &t!("menu.file.export.pandocDocx").to_string(), true, accel("export-pandoc-docx", ""))?),
                    Box::new(MenuItem::with_id(app, "export-pandoc-epub", &t!("menu.file.export.pandocEpub").to_string(), true, accel("export-pandoc-epub", ""))?),
                    Box::new(MenuItem::with_id(app, "export-pandoc-latex", &t!("menu.file.export.pandocLatex").to_string(), true, accel("export-pandoc-latex", ""))?),
                    Box::new(MenuItem::with_id(app, "export-pandoc-odt", &t!("menu.file.export.pandocOdt").to_string(), true, accel("export-pandoc-odt", ""))?),
                    Box::new(MenuItem::with_id(app, "export-pandoc-rtf", &t!("menu.file.export.pandocRtf").to_string(), true, accel("export-pandoc-rtf", ""))?),
                    Box::new(MenuItem::with_id(app, "export-pandoc-txt", &t!("menu.file.export.pandocTxt").to_string(), true, accel("export-pandoc-txt", ""))?),
                ];
                if crate::pandoc::commands::resolve_pandoc_path().is_none() {
                    items.push(Box::new(PredefinedMenuItem::separator(app)?));
                    items.push(Box::new(MenuItem::with_id(app, "export-pandoc-hint", &t!("menu.file.export.pandocHint").to_string(), true, None::<&str>)?));
                }
                let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|i| &**i).collect();
                Submenu::with_id_and_items(app, "other-formats-submenu", &t!("menu.file.export.otherFormats").to_string(), true, &refs)?
            },
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "copy-html", &t!("menu.file.export.copyHtml").to_string(), true, accel("copy-html", "CmdOrCtrl+Shift+C"))?,
        ],
    )?;

    let history_submenu = Submenu::with_id_and_items(
        app,
        "doc-history-submenu",
        &t!("menu.file.docHistory").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "clear-workspace-history", &t!("menu.file.docHistory.clearWorkspace").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "clear-history", &t!("menu.file.docHistory.clearAll").to_string(), true, None::<&str>)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let file_menu = Submenu::with_id_and_items(
        app,
        "file-menu",
        &t!("menu.file").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "new", &t!("menu.file.new").to_string(), true, accel("new", "CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", &t!("menu.file.newWindow").to_string(), true, accel("new-window", "CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quick-open", &t!("menu.file.quickOpen").to_string(), true, accel("quick-open", "CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open", &t!("menu.file.openFile").to_string(), true, accel("open", ""))?,
            &MenuItem::with_id(app, "open-folder", &t!("menu.file.openWorkspace").to_string(), true, accel("open-folder", "CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &recent_workspaces_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", &t!("menu.file.close").to_string(), true, accel("close", "CmdOrCtrl+W"))?,
            &MenuItem::with_id(app, "close-workspace", &t!("menu.file.closeWorkspace").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", &t!("menu.file.save").to_string(), true, accel("save", "CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", &t!("menu.file.saveAs").to_string(), true, accel("save-as", "CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "move-to", &t!("menu.file.moveTo").to_string(), true, accel("move-to", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &MenuItem::with_id(app, "export-pdf", &t!("menu.file.print").to_string(), true, accel("export-pdf", "CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let file_menu = Submenu::with_id_and_items(
        app,
        "file-menu",
        &t!("menu.file").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "new", &t!("menu.file.new").to_string(), true, accel("new", "CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", &t!("menu.file.newWindow").to_string(), true, accel("new-window", "CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quick-open", &t!("menu.file.quickOpen").to_string(), true, accel("quick-open", "CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open", &t!("menu.file.openFile").to_string(), true, accel("open", ""))?,
            &MenuItem::with_id(app, "open-folder", &t!("menu.file.openWorkspace").to_string(), true, accel("open-folder", "CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &recent_workspaces_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", &t!("menu.file.close").to_string(), true, accel("close", "CmdOrCtrl+W"))?,
            &MenuItem::with_id(app, "close-workspace", &t!("menu.file.closeWorkspace").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", &t!("menu.file.save").to_string(), true, accel("save", "CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", &t!("menu.file.saveAs").to_string(), true, accel("save-as", "CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "move-to", &t!("menu.file.moveTo").to_string(), true, accel("move-to", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &MenuItem::with_id(app, "export-pdf", &t!("menu.file.print").to_string(), true, accel("export-pdf", "CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "preferences", &t!("menu.app.settings").to_string(), true, accel("preferences", "CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save-all-quit", &t!("menu.file.saveAllExit").to_string(), true, accel("save-all-quit", "Alt+Shift+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "quit", &t!("menu.file.exit").to_string(), true, accel("quit", "CmdOrCtrl+Q"))?,
        ],
    )?;

    // ========================================================================
    // Edit menu
    // ========================================================================
    let find_submenu = Submenu::with_id_and_items(
        app,
        "find-submenu",
        &t!("menu.edit.find").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "find-replace", &t!("menu.edit.findReplace").to_string(), true, accel("find-replace", "CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "find-next", &t!("menu.edit.findNext").to_string(), true, accel("find-next", "CmdOrCtrl+G"))?,
            &MenuItem::with_id(app, "find-prev", &t!("menu.edit.findPrev").to_string(), true, accel("find-prev", "CmdOrCtrl+Shift+G"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "use-selection-find", &t!("menu.edit.useSelectionFind").to_string(), true, accel("use-selection-find", "CmdOrCtrl+E"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "find-in-files", &t!("menu.edit.findInFiles").to_string(), true, accel("find-in-files", "CmdOrCtrl+Shift+H"))?,
        ],
    )?;

    let selection_submenu = Submenu::with_id_and_items(
        app,
        "selection-submenu",
        &t!("menu.edit.selection").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "select-word", &t!("menu.edit.selection.word").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "select-line", &t!("menu.edit.selection.line").to_string(), true, accel("select-line", "CmdOrCtrl+L"))?,
            &MenuItem::with_id(app, "select-block", &t!("menu.edit.selection.block").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "expand-selection", &t!("menu.edit.selection.expand").to_string(), true, accel("expand-selection", "Ctrl+Shift+Up"))?,
        ],
    )?;

    let lines_submenu = Submenu::with_id_and_items(
        app,
        "lines-submenu",
        &t!("menu.edit.lines").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "move-line-up", &t!("menu.edit.lines.moveUp").to_string(), true, accel("move-line-up", "Alt+Up"))?,
            &MenuItem::with_id(app, "move-line-down", &t!("menu.edit.lines.moveDown").to_string(), true, accel("move-line-down", "Alt+Down"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "duplicate-line", &t!("menu.edit.lines.duplicate").to_string(), true, accel("duplicate-line", "Shift+Alt+Down"))?,
            &MenuItem::with_id(app, "delete-line", &t!("menu.edit.lines.delete").to_string(), true, accel("delete-line", "CmdOrCtrl+Shift+K"))?,
            &MenuItem::with_id(app, "join-lines", &t!("menu.edit.lines.join").to_string(), true, accel("join-lines", "CmdOrCtrl+J"))?,
            &MenuItem::with_id(app, "remove-blank-lines", &t!("menu.edit.lines.removeBlank").to_string(), true, accel("remove-blank-lines", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sort-lines-asc", &t!("menu.edit.lines.sortAsc").to_string(), true, accel("sort-lines-asc", "F4"))?,
            &MenuItem::with_id(app, "sort-lines-desc", &t!("menu.edit.lines.sortDesc").to_string(), true, accel("sort-lines-desc", "Shift+F4"))?,
        ],
    )?;

    let line_endings_submenu = Submenu::with_id_and_items(
        app,
        "line-endings-submenu",
        &t!("menu.edit.lineEndings").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "line-endings-lf", &t!("menu.edit.lineEndings.lf").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "line-endings-crlf", &t!("menu.edit.lineEndings.crlf").to_string(), true, None::<&str>)?,
        ],
    )?;

    let edit_menu = Submenu::with_id_and_items(
        app,
        "edit-menu",
        &t!("menu.edit").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "undo", &t!("menu.edit.undo").to_string(), true, accel("undo", "CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", &t!("menu.edit.redo").to_string(), true, accel("redo", "CmdOrCtrl+Shift+Z"))?,
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
    )?;

    // ========================================================================
    // Format menu (merged: Block + Format + Tools)
    // ========================================================================
    let headings_submenu = Submenu::with_id_and_items(
        app,
        "headings-submenu",
        &t!("menu.format.headings").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "heading-1", &t!("menu.format.headings.h1").to_string(), true, accel("heading-1", "CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "heading-2", &t!("menu.format.headings.h2").to_string(), true, accel("heading-2", "CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "heading-3", &t!("menu.format.headings.h3").to_string(), true, accel("heading-3", "CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "heading-4", &t!("menu.format.headings.h4").to_string(), true, accel("heading-4", "CmdOrCtrl+4"))?,
            &MenuItem::with_id(app, "heading-5", &t!("menu.format.headings.h5").to_string(), true, accel("heading-5", "CmdOrCtrl+5"))?,
            &MenuItem::with_id(app, "heading-6", &t!("menu.format.headings.h6").to_string(), true, accel("heading-6", "CmdOrCtrl+6"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "paragraph", &t!("menu.format.headings.paragraph").to_string(), true, accel("paragraph", "CmdOrCtrl+Shift+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "increase-heading", &t!("menu.format.headings.increase").to_string(), true, accel("increase-heading", "Alt+CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "decrease-heading", &t!("menu.format.headings.decrease").to_string(), true, accel("decrease-heading", "Alt+CmdOrCtrl+["))?,
        ],
    )?;

    let lists_submenu = Submenu::with_id_and_items(
        app,
        "lists-submenu",
        &t!("menu.format.lists").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "ordered-list", &t!("menu.format.lists.ordered").to_string(), true, accel("ordered-list", "Alt+CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "unordered-list", &t!("menu.format.lists.unordered").to_string(), true, accel("unordered-list", "Alt+CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "task-list", &t!("menu.format.lists.task").to_string(), true, accel("task-list", "Alt+CmdOrCtrl+X"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "indent", &t!("menu.format.lists.indent").to_string(), true, accel("indent", "CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "outdent", &t!("menu.format.lists.outdent").to_string(), true, accel("outdent", "CmdOrCtrl+["))?,
            &MenuItem::with_id(app, "remove-list", &t!("menu.format.lists.remove").to_string(), true, None::<&str>)?,
        ],
    )?;

    let blockquote_submenu = Submenu::with_id_and_items(
        app,
        "blockquote-submenu",
        &t!("menu.format.blockquote").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "quote", &t!("menu.format.blockquote.toggle").to_string(), true, accel("quote", "Alt+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "nest-blockquote", &t!("menu.format.blockquote.nest").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "unnest-blockquote", &t!("menu.format.blockquote.unnest").to_string(), true, None::<&str>)?,
        ],
    )?;

    let transform_submenu = Submenu::with_id_and_items(
        app,
        "transform-submenu",
        &t!("menu.format.transform").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "transform-uppercase", &t!("menu.format.transform.uppercase").to_string(), true, accel("transform-uppercase", if cfg!(target_os = "macos") { "Ctrl+Shift+U" } else { "Alt+Shift+U" }))?,
            &MenuItem::with_id(app, "transform-lowercase", &t!("menu.format.transform.lowercase").to_string(), true, accel("transform-lowercase", if cfg!(target_os = "macos") { "Ctrl+Shift+L" } else { "Alt+Shift+L" }))?,
            &MenuItem::with_id(app, "transform-title-case", &t!("menu.format.transform.titleCase").to_string(), true, accel("transform-title-case", if cfg!(target_os = "macos") { "Ctrl+Shift+T" } else { "Alt+Shift+T" }))?,
            &MenuItem::with_id(app, "transform-toggle-case", &t!("menu.format.transform.toggleCase").to_string(), true, accel("transform-toggle-case", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "toggle-quote-style", &t!("menu.format.transform.toggleQuoteStyle").to_string(), true, accel("toggle-quote-style", "CmdOrCtrl+Shift+'"))?,
        ],
    )?;

    let cjk_submenu = Submenu::with_id_and_items(
        app,
        "cjk-submenu",
        &t!("menu.format.cjk").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "format-cjk", &t!("menu.format.cjk.selection").to_string(), true, accel("format-cjk", "CmdOrCtrl+Shift+F"))?,
            &MenuItem::with_id(app, "format-cjk-file", &t!("menu.format.cjk.file").to_string(), true, accel("format-cjk-file", "Alt+CmdOrCtrl+Shift+F"))?,
        ],
    )?;

    let cleanup_submenu = Submenu::with_id_and_items(
        app,
        "text-cleanup-submenu",
        &t!("menu.format.cleanup").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "remove-trailing-spaces", &t!("menu.format.cleanup.trailingSpaces").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "collapse-blank-lines", &t!("menu.format.cleanup.collapseBlankLines").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "cleanup-images", &t!("menu.format.cleanup.images").to_string(), true, None::<&str>)?,
        ],
    )?;

    let format_menu = Submenu::with_id_and_items(
        app,
        "format-menu",
        &t!("menu.format").to_string(),
        true,
        &[
            &headings_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bold", &t!("menu.format.bold").to_string(), true, accel("bold", "CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "italic", &t!("menu.format.italic").to_string(), true, accel("italic", "CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "underline", &t!("menu.format.underline").to_string(), true, accel("underline", "CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "strikethrough", &t!("menu.format.strikethrough").to_string(), true, accel("strikethrough", "CmdOrCtrl+Shift+X"))?,
            &MenuItem::with_id(app, "code", &t!("menu.format.inlineCode").to_string(), true, accel("code", "CmdOrCtrl+Shift+`"))?,
            &MenuItem::with_id(app, "highlight", &t!("menu.format.highlight").to_string(), true, accel("highlight", "CmdOrCtrl+Shift+M"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "subscript", &t!("menu.format.subscript").to_string(), true, accel("subscript", "Alt+CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "superscript", &t!("menu.format.superscript").to_string(), true, accel("superscript", "Alt+CmdOrCtrl+Shift+="))?,
            &PredefinedMenuItem::separator(app)?,
            &lists_submenu,
            &blockquote_submenu,
            &PredefinedMenuItem::separator(app)?,
            &transform_submenu,
            &cjk_submenu,
            &cleanup_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-format", &t!("menu.format.clearFormat").to_string(), true, accel("clear-format", "CmdOrCtrl+\\"))?,
        ],
    )?;

    // ========================================================================
    // Insert menu
    // ========================================================================
    let links_submenu = Submenu::with_id_and_items(
        app,
        "links-submenu",
        &t!("menu.insert.links").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "link", &t!("menu.insert.links.link").to_string(), true, accel("link", "CmdOrCtrl+K"))?,
            &MenuItem::with_id(app, "wiki-link", &t!("menu.insert.links.wikiLink").to_string(), true, accel("wiki-link", "Alt+CmdOrCtrl+K"))?,
            &MenuItem::with_id(app, "bookmark", &t!("menu.insert.links.bookmark").to_string(), true, accel("bookmark", "Alt+CmdOrCtrl+B"))?,
        ],
    )?;

    let table_submenu = Submenu::with_id_and_items(
        app,
        "table-submenu",
        &t!("menu.insert.table").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "insert-table", &t!("menu.insert.table.insert").to_string(), true, accel("insert-table", "CmdOrCtrl+Shift+T"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "add-row-before", &t!("menu.insert.table.addRowAbove").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "add-row-after", &t!("menu.insert.table.addRowBelow").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-before", &t!("menu.insert.table.addColBefore").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-after", &t!("menu.insert.table.addColAfter").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "delete-row", &t!("menu.insert.table.deleteRow").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "delete-col", &t!("menu.insert.table.deleteCol").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "delete-table", &t!("menu.insert.table.deleteTable").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "align-left", &t!("menu.insert.table.alignLeft").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "align-center", &t!("menu.insert.table.alignCenter").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "align-right", &t!("menu.insert.table.alignRight").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "align-all-left", &t!("menu.insert.table.alignAllLeft").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "align-all-center", &t!("menu.insert.table.alignAllCenter").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "align-all-right", &t!("menu.insert.table.alignAllRight").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "format-table", &t!("menu.insert.table.format").to_string(), true, accel("format-table", "Alt+CmdOrCtrl+T"))?,
        ],
    )?;

    let info_boxes_submenu = Submenu::with_id_and_items(
        app,
        "info-box-submenu",
        &t!("menu.insert.infoBox").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "info-note", &t!("menu.insert.infoBox.note").to_string(), true, accel("info-note", "Alt+CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "info-tip", &t!("menu.insert.infoBox.tip").to_string(), true, accel("info-tip", "Alt+Shift+CmdOrCtrl+T"))?,
            &MenuItem::with_id(app, "info-important", &t!("menu.insert.infoBox.important").to_string(), true, accel("info-important", "Alt+Shift+CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "info-warning", &t!("menu.insert.infoBox.warning").to_string(), true, accel("info-warning", "CmdOrCtrl+Shift+W"))?,
            &MenuItem::with_id(app, "info-caution", &t!("menu.insert.infoBox.caution").to_string(), true, accel("info-caution", "CmdOrCtrl+Shift+U"))?,
        ],
    )?;

    let insert_menu = Submenu::with_id_and_items(
        app,
        "insert-menu",
        &t!("menu.insert").to_string(),
        true,
        &[
            &links_submenu,
            &MenuItem::with_id(app, "image", &t!("menu.insert.image").to_string(), true, accel("image", "Shift+CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "video", &t!("menu.insert.video").to_string(), true, accel("video", ""))?,
            &MenuItem::with_id(app, "audio", &t!("menu.insert.audio").to_string(), true, accel("audio", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &table_submenu,
            &MenuItem::with_id(app, "code-fences", &t!("menu.insert.codeBlock").to_string(), true, accel("code-fences", "Alt+CmdOrCtrl+C"))?,
            &MenuItem::with_id(app, "math-block", &t!("menu.insert.mathBlock").to_string(), true, accel("math-block", "Alt+CmdOrCtrl+Shift+M"))?,
            &MenuItem::with_id(app, "diagram", &t!("menu.insert.diagram").to_string(), true, accel("diagram", "Alt+Shift+CmdOrCtrl+D"))?,
            &MenuItem::with_id(app, "mindmap", &t!("menu.insert.mindmap").to_string(), true, accel("mindmap", "Alt+Shift+CmdOrCtrl+K"))?,
            &MenuItem::with_id(app, "horizontal-line", &t!("menu.insert.horizontalLine").to_string(), true, accel("horizontal-line", "Alt+CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "footnote", &t!("menu.insert.footnote").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "collapsible-block", &t!("menu.insert.collapsible").to_string(), true, accel("collapsible-block", "Alt+CmdOrCtrl+D"))?,
            &info_boxes_submenu,
        ],
    )?;

    // ========================================================================
    // View menu
    // ========================================================================
    let view_menu = Submenu::with_id_and_items(
        app,
        "view-menu",
        &t!("menu.view").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "source-mode", &t!("menu.view.sourceMode").to_string(), true, accel("source-mode", "F6"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "focus-mode", &t!("menu.view.focusMode").to_string(), true, accel("focus-mode", "F8"))?,
            &MenuItem::with_id(app, "typewriter-mode", &t!("menu.view.typewriterMode").to_string(), true, accel("typewriter-mode", "F9"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "zoom-actual", &t!("menu.view.actualSize").to_string(), true, accel("zoom-actual", "CmdOrCtrl+0"))?,
            &MenuItem::with_id(app, "zoom-in", &t!("menu.view.zoomIn").to_string(), true, accel("zoom-in", "CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "zoom-out", &t!("menu.view.zoomOut").to_string(), true, accel("zoom-out", "CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "word-wrap", &t!("menu.view.wordWrap").to_string(), true, accel("word-wrap", "Alt+Z"))?,
            &MenuItem::with_id(app, "line-numbers", &t!("menu.view.lineNumbers").to_string(), true, accel("line-numbers", "Alt+CmdOrCtrl+L"))?,
            &MenuItem::with_id(app, "diagram-preview", &t!("menu.view.diagramPreview").to_string(), true, accel("diagram-preview", "Alt+CmdOrCtrl+P"))?,
            &MenuItem::with_id(app, "fit-tables", &t!("menu.view.fitTables").to_string(), true, accel("fit-tables", ""))?,
            &MenuItem::with_id(app, "read-only", &t!("menu.view.readOnly").to_string(), true, accel("read-only", "F10"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "outline", &t!("menu.view.outline").to_string(), true, accel("outline", "Ctrl+Shift+1"))?,
            &MenuItem::with_id(app, "file-explorer", &t!("menu.view.fileExplorer").to_string(), true, accel("file-explorer", "Ctrl+Shift+2"))?,
            &MenuItem::with_id(app, "view-history", &t!("menu.view.history").to_string(), true, accel("view-history", "Ctrl+Shift+3"))?,
            &MenuItem::with_id(app, "toggle-terminal", &t!("menu.view.terminal").to_string(), true, accel("toggle-terminal", "Ctrl+`"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "check-markdown", &t!("menu.view.checkMarkdown").to_string(), true, accel("check-markdown", "Alt+CmdOrCtrl+V"))?,
            &MenuItem::with_id(app, "lint-next", &t!("menu.view.lintNext").to_string(), true, accel("lint-next", "F2"))?,
            &MenuItem::with_id(app, "lint-prev", &t!("menu.view.lintPrev").to_string(), true, accel("lint-prev", "Shift+F2"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    // ========================================================================
    // Window menu
    // ========================================================================
    #[cfg(target_os = "macos")]
    let window_menu = Submenu::with_id_and_items(
        app,
        "window-menu",
        &t!("menu.window").to_string(),
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bring-all-to-front", &t!("menu.window.bringAllToFront").to_string(), true, None::<&str>)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let window_menu = Submenu::with_id_and_items(
        app,
        "window-menu",
        &t!("menu.window").to_string(),
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;

    // ========================================================================
    // Help menu
    // ========================================================================
    #[cfg(target_os = "macos")]
    let help_menu = Submenu::with_id_and_items(
        app,
        "help-menu",
        &t!("menu.help").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "vmark-help", &t!("menu.help.vmarkHelp").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "keyboard-shortcuts", &t!("menu.help.keyboardShortcuts").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "install-cli", &t!("menu.help.installCli").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "report-issue", &t!("menu.help.reportIssue").to_string(), true, None::<&str>)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = Submenu::with_id_and_items(
        app,
        "help-menu",
        &t!("menu.help").to_string(),
        true,
        &[
            &MenuItem::with_id(app, "vmark-help", &t!("menu.help.vmarkHelp").to_string(), true, None::<&str>)?,
            &MenuItem::with_id(app, "keyboard-shortcuts", &t!("menu.help.keyboardShortcuts").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "report-issue", &t!("menu.help.reportIssue").to_string(), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "about", &t!("menu.app.about").to_string(), true, None::<&str>)?,
        ],
    )?;

    // ========================================================================
    // Assemble the menu bar
    // ========================================================================
    #[cfg(target_os = "macos")]
    return Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &insert_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    );

    #[cfg(not(target_os = "macos"))]
    Menu::with_items(
        app,
        &[
            &file_menu,
            &edit_menu,
            &format_menu,
            &insert_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

/// Set the active locale for Rust-side translations.
///
/// After calling this, the next `rebuild_menu` will use the new locale's strings.
/// The frontend is responsible for triggering the menu rebuild.
#[tauri::command]
pub fn set_locale(_app: tauri::AppHandle, locale: String) -> Result<(), String> {
    rust_i18n::set_locale(&locale);
    Ok(())
}
