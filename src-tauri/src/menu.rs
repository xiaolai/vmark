use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

/// Beta version string, read from version.txt at compile time.
const BETA_VERSION: &str = include_str!("../version.txt");

pub const RECENT_FILES_SUBMENU_ID: &str = "recent-files-submenu";

pub fn create_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // App menu (macOS only - shows as app name in menu bar)
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "VMark",
        true,
        &[
            &MenuItem::with_id(
                app,
                "preferences",
                "Settings...",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Services"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide VMark"))?,
            &PredefinedMenuItem::hide_others(app, Some("Hide Others"))?,
            &PredefinedMenuItem::show_all(app, Some("Show All"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit VMark"))?,
        ],
    )?;

    // Open Recent submenu (initially empty)
    let recent_submenu = Submenu::with_id_and_items(
        app,
        RECENT_FILES_SUBMENU_ID,
        "Open Recent",
        true,
        &[
            &MenuItem::with_id(app, "no-recent", "No Recent Files", false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-recent", "Clear Recent Files", true, None::<&str>)?,
        ],
    )?;

    // Export submenu
    let export_submenu = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &MenuItem::with_id(app, "export-html", "HTML...", true, Some("CmdOrCtrl+Shift+E"))?,
            &MenuItem::with_id(app, "save-pdf", "PDF...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export-pdf", "Print...", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "copy-html", "Copy as HTML", true, Some("Alt+CmdOrCtrl+C"))?,
        ],
    )?;

    // File menu
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &recent_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?,
        ],
    )?;

    // Document History submenu
    let history_submenu = Submenu::with_items(
        app,
        "Document History",
        true,
        &[
            &MenuItem::with_id(
                app,
                "view-history",
                "View History...",
                true,
                Some("CmdOrCtrl+Shift+H"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "clear-history",
                "Clear History...",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Selection submenu
    let selection_submenu = Submenu::with_items(
        app,
        "Selection",
        true,
        &[
            &MenuItem::with_id(app, "select-word", "Select Word", true, None::<&str>)?,
            &MenuItem::with_id(app, "select-line", "Select Line", true, Some("CmdOrCtrl+L"))?,
            &MenuItem::with_id(app, "select-block", "Select Block", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "expand-selection",
                "Expand Selection",
                true,
                Some("Ctrl+Shift+Up"),
            )?,
        ],
    )?;

    // Edit menu (use PredefinedMenuItem for native behavior)
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Undo"))?,
            &PredefinedMenuItem::redo(app, Some("Redo"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Cut"))?,
            &PredefinedMenuItem::copy(app, Some("Copy"))?,
            &PredefinedMenuItem::paste(app, Some("Paste"))?,
            &PredefinedMenuItem::select_all(app, Some("Select All"))?,
            &PredefinedMenuItem::separator(app)?,
            &selection_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "find-replace",
                "Find and Replace...",
                true,
                Some("CmdOrCtrl+F"),
            )?,
            &MenuItem::with_id(app, "find-next", "Find Next", true, Some("CmdOrCtrl+G"))?,
            &MenuItem::with_id(
                app,
                "find-prev",
                "Find Previous",
                true,
                Some("CmdOrCtrl+Shift+G"),
            )?,
            &MenuItem::with_id(
                app,
                "use-selection-find",
                "Use Selection for Find",
                true,
                Some("CmdOrCtrl+E"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
        ],
    )?;

    // View menu
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                "source-mode",
                "Source Code Mode",
                true,
                Some("F7"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "focus-mode", "Focus Mode", true, Some("F8"))?,
            &MenuItem::with_id(app, "typewriter-mode", "Typewriter Mode", true, Some("F9"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "word-wrap",
                "Toggle Word Wrap",
                true,
                Some("F10"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "sidebar",
                "Toggle Sidebar",
                true,
                Some("CmdOrCtrl+Shift+B"),
            )?,
            &MenuItem::with_id(
                app,
                "outline",
                "Toggle Outline",
                true,
                Some("Ctrl+CmdOrCtrl+1"),
            )?,
        ],
    )?;

    // Table submenu
    let table_submenu = Submenu::with_items(
        app,
        "Table",
        true,
        &[
            &MenuItem::with_id(
                app,
                "insert-table",
                "Insert Table",
                true,
                Some("Alt+CmdOrCtrl+T"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "add-row-before", "Add Row Above", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-row-after", "Add Row Below", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-before", "Add Column Before", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-after", "Add Column After", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "delete-selected-cells",
                "Delete Selected Cells",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "align-left", "Align Left", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-center", "Align Center", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-right", "Align Right", true, None::<&str>)?,
        ],
    )?;

    // Info Boxes submenu (GitHub-style alert blocks)
    let info_boxes_submenu = Submenu::with_items(
        app,
        "Info Boxes",
        true,
        &[
            &MenuItem::with_id(app, "info-note", "Note", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-tip", "Tip", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-important", "Important", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-warning", "Warning", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-caution", "Caution", true, None::<&str>)?,
        ],
    )?;

    // Paragraph menu
    let paragraph_menu = Submenu::with_items(
        app,
        "Paragraph",
        true,
        &[
            &MenuItem::with_id(app, "heading-1", "Heading 1", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "heading-2", "Heading 2", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "heading-3", "Heading 3", true, Some("CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "heading-4", "Heading 4", true, Some("CmdOrCtrl+4"))?,
            &MenuItem::with_id(app, "heading-5", "Heading 5", true, Some("CmdOrCtrl+5"))?,
            &MenuItem::with_id(app, "heading-6", "Heading 6", true, Some("CmdOrCtrl+6"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "paragraph", "Paragraph", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "increase-heading",
                "Increase Heading Level",
                true,
                Some("CmdOrCtrl+="),
            )?,
            &MenuItem::with_id(
                app,
                "decrease-heading",
                "Decrease Heading Level",
                true,
                Some("CmdOrCtrl+-"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &table_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quote", "Quote", true, Some("Alt+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "code-fences", "Code Fences", true, Some("Alt+CmdOrCtrl+C"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "ordered-list",
                "Ordered List",
                true,
                Some("Alt+CmdOrCtrl+O"),
            )?,
            &MenuItem::with_id(
                app,
                "unordered-list",
                "Unordered List",
                true,
                Some("Alt+CmdOrCtrl+U"),
            )?,
            &MenuItem::with_id(app, "task-list", "Task List", true, Some("Alt+CmdOrCtrl+X"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "indent", "Indent", true, Some("CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "outdent", "Outdent", true, Some("CmdOrCtrl+["))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "horizontal-line",
                "Horizontal Line",
                true,
                Some("Alt+CmdOrCtrl+-"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &info_boxes_submenu,
            &MenuItem::with_id(
                app,
                "collapsible-block",
                "Collapsible Block",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Format menu
    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &MenuItem::with_id(app, "bold", "Bold", true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "italic", "Italic", true, Some("CmdOrCtrl+I"))?,
            &MenuItem::with_id(
                app,
                "strikethrough",
                "Strikethrough",
                true,
                Some("CmdOrCtrl+Shift+X"),
            )?,
            &MenuItem::with_id(app, "code", "Inline Code", true, Some("CmdOrCtrl+`"))?,
            &MenuItem::with_id(app, "subscript", "Subscript", true, None::<&str>)?,
            &MenuItem::with_id(app, "superscript", "Superscript", true, None::<&str>)?,
            &MenuItem::with_id(app, "highlight", "Highlight", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "link", "Insert Link", true, Some("CmdOrCtrl+K"))?,
            &MenuItem::with_id(app, "image", "Insert Image...", true, Some("Alt+CmdOrCtrl+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "clear-format",
                "Clear Format",
                true,
                Some("CmdOrCtrl+\\"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "format-cjk",
                "Format CJK Text",
                true,
                Some("CmdOrCtrl+Shift+F"),
            )?,
            &MenuItem::with_id(
                app,
                "format-cjk-file",
                "Format Entire File",
                true,
                Some("Alt+CmdOrCtrl+Shift+F"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "remove-trailing-spaces",
                "Remove Trailing Spaces",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "collapse-blank-lines",
                "Collapse Blank Lines",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Help menu - About dialog shows beta version
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("VMark"))
        .version(Some(BETA_VERSION.trim()))
        .build();
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About VMark"), Some(about_metadata))?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    return Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &paragraph_menu,
            &format_menu,
            &view_menu,
            &help_menu,
        ],
    );

    #[cfg(not(target_os = "macos"))]
    Menu::with_items(
        app,
        &[
            &file_menu,
            &edit_menu,
            &paragraph_menu,
            &format_menu,
            &view_menu,
            &help_menu,
        ],
    )
}

/// Update the Open Recent submenu with the given list of file paths
pub fn update_recent_files_menu(app: &AppHandle, files: Vec<String>) -> tauri::Result<()> {
    // Get the menu
    let Some(menu) = app.menu() else {
        return Ok(());
    };

    // Find the recent files submenu - it's nested inside File menu
    // Need to search through all submenus
    let mut submenu_opt = None;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item {
            // Check if this submenu contains our target
            if let Some(found) = sub.get(RECENT_FILES_SUBMENU_ID) {
                if let MenuItemKind::Submenu(recent) = found {
                    submenu_opt = Some(recent);
                    break;
                }
            }
        }
    }

    let Some(submenu) = submenu_opt else {
        return Ok(());
    };

    // Remove all existing items
    while let Some(item) = submenu.items()?.first() {
        submenu.remove(item)?;
    }

    // Add file items
    if files.is_empty() {
        let no_recent = MenuItem::with_id(app, "no-recent", "No Recent Files", false, None::<&str>)?;
        submenu.append(&no_recent)?;
    } else {
        for (index, path) in files.iter().enumerate() {
            // Extract filename from path
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path);

            let item_id = format!("recent-file-{}", index);
            let item = MenuItem::with_id(app, &item_id, filename, true, None::<&str>)?;
            submenu.append(&item)?;
        }
    }

    // Add separator and clear option
    let separator = PredefinedMenuItem::separator(app)?;
    submenu.append(&separator)?;

    let clear_item = MenuItem::with_id(app, "clear-recent", "Clear Recent Files", !files.is_empty(), None::<&str>)?;
    submenu.append(&clear_item)?;

    Ok(())
}

#[tauri::command]
pub fn update_recent_files(app: AppHandle, files: Vec<String>) -> Result<(), String> {
    update_recent_files_menu(&app, files).map_err(|e| e.to_string())
}
