use std::collections::HashMap;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

/// App version, pulled from Cargo package metadata at compile time.
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

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
            &MenuItem::with_id(app, "copy-html", "Copy as HTML", true, Some("CmdOrCtrl+Shift+C"))?,
        ],
    )?;

    // File menu
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+Shift+N"))?,
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(
                app,
                "open-folder",
                "Open Folder...",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &recent_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "close-workspace",
                "Close Workspace",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "cleanup-images", "Clean Up Unused Images...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?,
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

    // Find submenu (grouped for cleaner Edit menu)
    let find_submenu = Submenu::with_items(
        app,
        "Find",
        true,
        &[
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
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "use-selection-find",
                "Use Selection for Find",
                true,
                None::<&str>,
            )?,
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

    // Text Cleanup submenu
    let cleanup_submenu = Submenu::with_items(
        app,
        "Text Cleanup",
        true,
        &[
            &MenuItem::with_id(app, "remove-trailing-spaces", "Remove Trailing Spaces", true, None::<&str>)?,
            &MenuItem::with_id(app, "collapse-blank-lines", "Collapse Blank Lines", true, None::<&str>)?,
        ],
    )?;

    // Edit menu
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
            &find_submenu,
            &cleanup_submenu,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
        ],
    )?;

    // Block menu (block-level formatting only)
    let block_menu = Submenu::with_items(
        app,
        "Block",
        true,
        &[
            &MenuItem::with_id(app, "heading-1", "Heading 1", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "heading-2", "Heading 2", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "heading-3", "Heading 3", true, Some("CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "heading-4", "Heading 4", true, Some("CmdOrCtrl+4"))?,
            &MenuItem::with_id(app, "heading-5", "Heading 5", true, Some("CmdOrCtrl+5"))?,
            &MenuItem::with_id(app, "heading-6", "Heading 6", true, Some("CmdOrCtrl+6"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "paragraph", "Paragraph", true, Some("CmdOrCtrl+Shift+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "increase-heading",
                "Increase Heading Level",
                true,
                Some("Alt+CmdOrCtrl+]"),
            )?,
            &MenuItem::with_id(
                app,
                "decrease-heading",
                "Decrease Heading Level",
                true,
                Some("Alt+CmdOrCtrl+["),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quote", "Quote", true, Some("Alt+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "nest-quote", "Nest Quote", true, None::<&str>)?,
            &MenuItem::with_id(app, "unnest-quote", "Unnest Quote", true, None::<&str>)?,
            &MenuItem::with_id(app, "code-fences", "Code Block", true, Some("Alt+CmdOrCtrl+C"))?,
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
            &MenuItem::with_id(app, "remove-list", "Remove List", true, None::<&str>)?,
        ],
    )?;

    // CJK submenu (CJK-specific formatting)
    let cjk_submenu = Submenu::with_items(
        app,
        "CJK",
        true,
        &[
            &MenuItem::with_id(
                app,
                "format-cjk",
                "Format Selection",
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
        ],
    )?;

    // Format menu (inline formatting only)
    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &MenuItem::with_id(app, "bold", "Bold", true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "italic", "Italic", true, Some("CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "underline", "Underline", true, Some("CmdOrCtrl+U"))?,
            &MenuItem::with_id(
                app,
                "strikethrough",
                "Strikethrough",
                true,
                Some("CmdOrCtrl+Shift+X"),
            )?,
            &MenuItem::with_id(app, "code", "Inline Code", true, Some("CmdOrCtrl+Shift+`"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "subscript", "Subscript", true, Some("Alt+CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "superscript", "Superscript", true, Some("Alt+CmdOrCtrl+Shift+="))?,
            &MenuItem::with_id(app, "highlight", "Highlight", true, Some("CmdOrCtrl+Shift+M"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "clear-format",
                "Clear Format",
                true,
                Some("CmdOrCtrl+\\"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &cjk_submenu,
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
                Some("CmdOrCtrl+Shift+T"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "add-row-before", "Add Row Above", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-row-after", "Add Row Below", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-before", "Add Column Before", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-after", "Add Column After", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "delete-row", "Delete Row", true, None::<&str>)?,
            &MenuItem::with_id(app, "delete-col", "Delete Column", true, None::<&str>)?,
            &MenuItem::with_id(app, "delete-table", "Delete Table", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "align-left", "Align Left", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-center", "Align Center", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-right", "Align Right", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "align-all-left", "Align All Left", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-all-center", "Align All Center", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-all-right", "Align All Right", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "format-table", "Format Table", true, None::<&str>)?,
        ],
    )?;

    // Info Boxes submenu (GitHub-style alert blocks)
    let info_boxes_submenu = Submenu::with_items(
        app,
        "Info Box",
        true,
        &[
            &MenuItem::with_id(app, "info-note", "Note", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-tip", "Tip", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-important", "Important", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-warning", "Warning", true, None::<&str>)?,
            &MenuItem::with_id(app, "info-caution", "Caution", true, None::<&str>)?,
        ],
    )?;

    // Links submenu
    let links_submenu = Submenu::with_items(
        app,
        "Links",
        true,
        &[
            &MenuItem::with_id(app, "link", "Link", true, Some("CmdOrCtrl+K"))?,
            &MenuItem::with_id(app, "wiki-link", "Wiki Link", true, None::<&str>)?,
            &MenuItem::with_id(app, "bookmark", "Bookmark", true, None::<&str>)?,
        ],
    )?;

    // Insert menu (for insertable elements)
    let insert_menu = Submenu::with_items(
        app,
        "Insert",
        true,
        &[
            &links_submenu,
            &MenuItem::with_id(app, "image", "Image...", true, Some("Shift+CmdOrCtrl+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &table_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "horizontal-line",
                "Horizontal Line",
                true,
                Some("Alt+CmdOrCtrl+-"),
            )?,
            &MenuItem::with_id(
                app,
                "math-block",
                "Math Block",
                true,
                Some("Alt+CmdOrCtrl+Shift+M"),
            )?,
            &MenuItem::with_id(app, "footnote", "Footnote", true, None::<&str>)?,
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
                Some("CmdOrCtrl+/"),
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
                Some("Alt+Z"),
            )?,
            &MenuItem::with_id(
                app,
                "line-numbers",
                "Toggle Line Numbers",
                true,
                Some("CmdOrCtrl+Shift+N"),
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
                Some("Alt+CmdOrCtrl+1"),
            )?,
            &MenuItem::with_id(
                app,
                "terminal",
                "Toggle Terminal",
                true,
                Some("Ctrl+`"),
            )?,
        ],
    )?;

    // Help menu - About dialog shows beta version
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("VMark"))
        .version(Some(APP_VERSION))
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
            &block_menu,
            &format_menu,
            &insert_menu,
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
            &block_menu,
            &format_menu,
            &insert_menu,
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

/// Rebuild the application menu with custom keyboard shortcuts.
/// The shortcuts map is: menu_item_id -> accelerator_string (e.g., "bold" -> "CmdOrCtrl+B")
#[tauri::command]
pub fn rebuild_menu(app: AppHandle, shortcuts: HashMap<String, String>) -> Result<(), String> {
    let menu = create_menu_with_shortcuts(&app, &shortcuts).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// Create menu with custom keyboard shortcuts
fn create_menu_with_shortcuts(
    app: &AppHandle,
    shortcuts: &HashMap<String, String>,
) -> tauri::Result<Menu<tauri::Wry>> {
    // Helper to get shortcut for a menu item, falling back to default
    // Returns None if the resulting shortcut would be empty
    let get_accel = |id: &str, default: &str| -> Option<String> {
        let accel = shortcuts.get(id).map(|s| s.as_str()).unwrap_or(default);
        if accel.is_empty() {
            None
        } else {
            Some(accel.to_string())
        }
    };

    // App menu (macOS only)
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
                get_accel("preferences", "CmdOrCtrl+,"),
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

    // Open Recent submenu
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
            &MenuItem::with_id(app, "export-html", "HTML...", true, get_accel("export-html", "CmdOrCtrl+Shift+E"))?,
            &MenuItem::with_id(app, "save-pdf", "PDF...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export-pdf", "Print...", true, get_accel("export-pdf", "CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "copy-html", "Copy as HTML", true, get_accel("copy-html", "CmdOrCtrl+Shift+C"))?,
        ],
    )?;

    // File menu
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, get_accel("new", "CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", "New Window", true, get_accel("new-window", "CmdOrCtrl+Shift+N"))?,
            &MenuItem::with_id(app, "open", "Open...", true, get_accel("open", "CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open-folder", "Open Folder...", true, get_accel("open-folder", "CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close-workspace", "Close Workspace", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, get_accel("save", "CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, get_accel("save-as", "CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "cleanup-images", "Clean Up Unused Images...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, get_accel("close", "CmdOrCtrl+W"))?,
        ],
    )?;

    // Selection submenu
    let selection_submenu = Submenu::with_items(
        app,
        "Selection",
        true,
        &[
            &MenuItem::with_id(app, "select-word", "Select Word", true, None::<&str>)?,
            &MenuItem::with_id(app, "select-line", "Select Line", true, get_accel("select-line", "CmdOrCtrl+L"))?,
            &MenuItem::with_id(app, "select-block", "Select Block", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "expand-selection", "Expand Selection", true, get_accel("expand-selection", "Ctrl+Shift+Up"))?,
        ],
    )?;

    // Find submenu
    let find_submenu = Submenu::with_items(
        app,
        "Find",
        true,
        &[
            &MenuItem::with_id(app, "find-replace", "Find and Replace...", true, get_accel("find-replace", "CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "find-next", "Find Next", true, get_accel("find-next", "CmdOrCtrl+G"))?,
            &MenuItem::with_id(app, "find-prev", "Find Previous", true, get_accel("find-prev", "CmdOrCtrl+Shift+G"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "use-selection-find", "Use Selection for Find", true, get_accel("use-selection-find", ""))?,
        ],
    )?;

    // Document History submenu
    let history_submenu = Submenu::with_items(
        app,
        "Document History",
        true,
        &[
            &MenuItem::with_id(app, "view-history", "View History...", true, get_accel("view-history", "CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-history", "Clear History...", true, None::<&str>)?,
        ],
    )?;

    // Line Endings submenu
    let line_endings_submenu = Submenu::with_items(
        app,
        "Line Endings",
        true,
        &[
            &MenuItem::with_id(app, "line-endings-lf", "Convert to LF", true, None::<&str>)?,
            &MenuItem::with_id(app, "line-endings-crlf", "Convert to CRLF", true, None::<&str>)?,
        ],
    )?;

    // Text Cleanup submenu
    let cleanup_submenu = Submenu::with_items(
        app,
        "Text Cleanup",
        true,
        &[
            &MenuItem::with_id(app, "remove-trailing-spaces", "Remove Trailing Spaces", true, None::<&str>)?,
            &MenuItem::with_id(app, "collapse-blank-lines", "Collapse Blank Lines", true, None::<&str>)?,
        ],
    )?;

    // Edit menu
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
            &find_submenu,
            &line_endings_submenu,
            &cleanup_submenu,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
        ],
    )?;

    // Block menu
    let block_menu = Submenu::with_items(
        app,
        "Block",
        true,
        &[
            &MenuItem::with_id(app, "heading-1", "Heading 1", true, get_accel("heading-1", "CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "heading-2", "Heading 2", true, get_accel("heading-2", "CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "heading-3", "Heading 3", true, get_accel("heading-3", "CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "heading-4", "Heading 4", true, get_accel("heading-4", "CmdOrCtrl+4"))?,
            &MenuItem::with_id(app, "heading-5", "Heading 5", true, get_accel("heading-5", "CmdOrCtrl+5"))?,
            &MenuItem::with_id(app, "heading-6", "Heading 6", true, get_accel("heading-6", "CmdOrCtrl+6"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "paragraph", "Paragraph", true, get_accel("paragraph", "CmdOrCtrl+Shift+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "increase-heading", "Increase Heading Level", true, get_accel("increase-heading", "Alt+CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "decrease-heading", "Decrease Heading Level", true, get_accel("decrease-heading", "Alt+CmdOrCtrl+["))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quote", "Quote", true, get_accel("quote", "Alt+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "nest-quote", "Nest Quote", true, None::<&str>)?,
            &MenuItem::with_id(app, "unnest-quote", "Unnest Quote", true, None::<&str>)?,
            &MenuItem::with_id(app, "code-fences", "Code Block", true, get_accel("code-fences", "Alt+CmdOrCtrl+C"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "ordered-list", "Ordered List", true, get_accel("ordered-list", "Alt+CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "unordered-list", "Unordered List", true, get_accel("unordered-list", "Alt+CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "task-list", "Task List", true, get_accel("task-list", "Alt+CmdOrCtrl+X"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "indent", "Indent", true, get_accel("indent", "CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "outdent", "Outdent", true, get_accel("outdent", "CmdOrCtrl+["))?,
            &MenuItem::with_id(app, "remove-list", "Remove List", true, None::<&str>)?,
        ],
    )?;

    // CJK submenu (CJK-specific formatting)
    let cjk_submenu = Submenu::with_items(
        app,
        "CJK",
        true,
        &[
            &MenuItem::with_id(app, "format-cjk", "Format Selection", true, get_accel("format-cjk", "CmdOrCtrl+Shift+F"))?,
            &MenuItem::with_id(app, "format-cjk-file", "Format Entire File", true, get_accel("format-cjk-file", "Alt+CmdOrCtrl+Shift+F"))?,
        ],
    )?;

    // Format menu
    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &MenuItem::with_id(app, "bold", "Bold", true, get_accel("bold", "CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "italic", "Italic", true, get_accel("italic", "CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "underline", "Underline", true, get_accel("underline", "CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "strikethrough", "Strikethrough", true, get_accel("strikethrough", "CmdOrCtrl+Shift+X"))?,
            &MenuItem::with_id(app, "code", "Inline Code", true, get_accel("code", "CmdOrCtrl+Shift+`"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "subscript", "Subscript", true, get_accel("subscript", "Alt+CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "superscript", "Superscript", true, get_accel("superscript", "Alt+CmdOrCtrl+Shift+="))?,
            &MenuItem::with_id(app, "highlight", "Highlight", true, get_accel("highlight", "CmdOrCtrl+Shift+M"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-format", "Clear Format", true, get_accel("clear-format", "CmdOrCtrl+\\"))?,
            &PredefinedMenuItem::separator(app)?,
            &cjk_submenu,
        ],
    )?;

    // Table submenu
    let table_submenu = Submenu::with_items(
        app,
        "Table",
        true,
        &[
            &MenuItem::with_id(app, "insert-table", "Insert Table", true, get_accel("insert-table", "CmdOrCtrl+Shift+T"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "add-row-before", "Add Row Above", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-row-after", "Add Row Below", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-before", "Add Column Before", true, None::<&str>)?,
            &MenuItem::with_id(app, "add-col-after", "Add Column After", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "delete-row", "Delete Row", true, None::<&str>)?,
            &MenuItem::with_id(app, "delete-col", "Delete Column", true, None::<&str>)?,
            &MenuItem::with_id(app, "delete-table", "Delete Table", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "align-left", "Align Left", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-center", "Align Center", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-right", "Align Right", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "align-all-left", "Align All Left", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-all-center", "Align All Center", true, None::<&str>)?,
            &MenuItem::with_id(app, "align-all-right", "Align All Right", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "format-table", "Format Table", true, None::<&str>)?,
        ],
    )?;

    // Info Boxes submenu
    let info_boxes_submenu = Submenu::with_items(
        app,
        "Info Box",
        true,
        &[
            &MenuItem::with_id(app, "info-note", "Note", true, get_accel("info-note", ""))?,
            &MenuItem::with_id(app, "info-tip", "Tip", true, get_accel("info-tip", ""))?,
            &MenuItem::with_id(app, "info-important", "Important", true, get_accel("info-important", ""))?,
            &MenuItem::with_id(app, "info-warning", "Warning", true, get_accel("info-warning", ""))?,
            &MenuItem::with_id(app, "info-caution", "Caution", true, get_accel("info-caution", ""))?,
        ],
    )?;

    // Links submenu
    let links_submenu = Submenu::with_items(
        app,
        "Links",
        true,
        &[
            &MenuItem::with_id(app, "link", "Link", true, get_accel("link", "CmdOrCtrl+K"))?,
            &MenuItem::with_id(app, "wiki-link", "Wiki Link", true, None::<&str>)?,
            &MenuItem::with_id(app, "bookmark", "Bookmark", true, None::<&str>)?,
        ],
    )?;

    // Insert menu
    let insert_menu = Submenu::with_items(
        app,
        "Insert",
        true,
        &[
            &links_submenu,
            &MenuItem::with_id(app, "image", "Image...", true, get_accel("image", "Shift+CmdOrCtrl+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &table_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "horizontal-line", "Horizontal Line", true, get_accel("horizontal-line", "Alt+CmdOrCtrl+-"))?,
            &MenuItem::with_id(app, "math-block", "Math Block", true, get_accel("math-block", "Alt+CmdOrCtrl+Shift+M"))?,
            &MenuItem::with_id(app, "footnote", "Footnote", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &info_boxes_submenu,
            &MenuItem::with_id(app, "collapsible-block", "Collapsible Block", true, get_accel("collapsible-block", ""))?,
        ],
    )?;

    // View menu
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "source-mode", "Source Code Mode", true, get_accel("source-mode", "CmdOrCtrl+/"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "focus-mode", "Focus Mode", true, get_accel("focus-mode", "F8"))?,
            &MenuItem::with_id(app, "typewriter-mode", "Typewriter Mode", true, get_accel("typewriter-mode", "F9"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "word-wrap", "Toggle Word Wrap", true, get_accel("word-wrap", "Alt+Z"))?,
            &MenuItem::with_id(app, "line-numbers", "Toggle Line Numbers", true, get_accel("line-numbers", "CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sidebar", "Toggle Sidebar", true, get_accel("sidebar", "CmdOrCtrl+Shift+B"))?,
            &MenuItem::with_id(app, "outline", "Toggle Outline", true, get_accel("outline", "Alt+CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "terminal", "Toggle Terminal", true, get_accel("terminal", "Ctrl+`"))?,
        ],
    )?;

    // Help menu
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("VMark"))
        .version(Some(APP_VERSION))
        .build();
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[&PredefinedMenuItem::about(app, Some("About VMark"), Some(about_metadata))?],
    )?;

    #[cfg(target_os = "macos")]
    return Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &block_menu,
            &format_menu,
            &insert_menu,
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
            &block_menu,
            &format_menu,
            &insert_menu,
            &view_menu,
            &help_menu,
        ],
    )
}
