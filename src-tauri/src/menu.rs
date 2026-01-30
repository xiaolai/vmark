use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

pub const RECENT_FILES_SUBMENU_ID: &str = "recent-files-submenu";
pub const RECENT_WORKSPACES_SUBMENU_ID: &str = "recent-workspaces-submenu";

/// Stores the recent files list snapshot at menu build time.
/// This ensures that when a menu item is clicked, we can look up
/// the correct path even if the store changed since menu creation.
static RECENT_FILES_SNAPSHOT: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Stores the recent workspaces list snapshot at menu build time.
static RECENT_WORKSPACES_SNAPSHOT: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Get the path for a recent file by its menu index.
/// Returns None if index is out of bounds.
pub fn get_recent_file_path(index: usize) -> Option<String> {
    RECENT_FILES_SNAPSHOT
        .lock()
        .ok()
        .and_then(|files| files.get(index).cloned())
}

/// Get the path for a recent workspace by its menu index.
/// Returns None if index is out of bounds.
pub fn get_recent_workspace_path(index: usize) -> Option<String> {
    RECENT_WORKSPACES_SNAPSHOT
        .lock()
        .ok()
        .and_then(|workspaces| workspaces.get(index).cloned())
}

// ============================================================================
// Menu Structure (8 menus on macOS, 7 on Windows/Linux):
//
// macOS:        VMark | File | Edit | Format | Insert | View | Window | Help
// Windows/Linux:        File | Edit | Format | Insert | View | Window | Help
//
// Key changes from previous structure:
// - Block menu merged into Format
// - Tools menu removed (CJK/Cleanup → Format)
// - Window menu added
// - About/Updates moved to App menu (macOS) or Help menu (others)
// ============================================================================

pub fn create_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // ========================================================================
    // App menu (macOS only)
    // ========================================================================
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "VMark",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About VMark"), None)?,
            &MenuItem::with_id(app, "check-updates", "Check for Updates...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "preferences", "Settings...", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Services"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide VMark"))?,
            &PredefinedMenuItem::hide_others(app, Some("Hide Others"))?,
            &PredefinedMenuItem::show_all(app, Some("Show All"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save-all-quit", "Save All and Quit", true, Some("Alt+Shift+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "quit", "Quit VMark", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    // ========================================================================
    // File menu
    // ========================================================================
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

    let recent_workspaces_submenu = Submenu::with_id_and_items(
        app,
        RECENT_WORKSPACES_SUBMENU_ID,
        "Open Recent Workspace",
        true,
        &[
            &MenuItem::with_id(app, "no-recent-workspace", "No Recent Workspaces", false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-recent-workspaces", "Clear Recent Workspaces", true, None::<&str>)?,
        ],
    )?;

    let export_submenu = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &MenuItem::with_id(app, "export-html", "HTML...", true, Some("Alt+CmdOrCtrl+E"))?,
            &MenuItem::with_id(app, "export-pdf", "Print...", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "copy-html", "Copy as HTML", true, Some("CmdOrCtrl+Shift+C"))?,
        ],
    )?;

    let history_submenu = Submenu::with_items(
        app,
        "Document History",
        true,
        &[
            &MenuItem::with_id(app, "view-history", "View History...", true, Some("CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-history", "Clear History...", true, None::<&str>)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open-folder", "Open Folder...", true, Some("CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &recent_workspaces_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?,
            &MenuItem::with_id(app, "close-workspace", "Close Workspace", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "move-to", "Move to...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open-folder", "Open Folder...", true, Some("CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &recent_workspaces_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?,
            &MenuItem::with_id(app, "close-workspace", "Close Workspace", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "move-to", "Move to...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "preferences", "Settings...", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save-all-quit", "Save All and Exit", true, Some("Alt+Shift+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "quit", "Exit", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    // ========================================================================
    // Edit menu
    // ========================================================================
    let find_submenu = Submenu::with_items(
        app,
        "Find",
        true,
        &[
            &MenuItem::with_id(app, "find-replace", "Find and Replace...", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "find-next", "Find Next", true, Some("CmdOrCtrl+G"))?,
            &MenuItem::with_id(app, "find-prev", "Find Previous", true, Some("CmdOrCtrl+Shift+G"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "use-selection-find", "Use Selection for Find", true, Some("CmdOrCtrl+E"))?,
        ],
    )?;

    let selection_submenu = Submenu::with_items(
        app,
        "Selection",
        true,
        &[
            &MenuItem::with_id(app, "select-word", "Select Word", true, None::<&str>)?,
            &MenuItem::with_id(app, "select-line", "Select Line", true, Some("CmdOrCtrl+L"))?,
            &MenuItem::with_id(app, "select-block", "Select Block", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "expand-selection", "Expand Selection", true, Some("Ctrl+Shift+Up"))?,
        ],
    )?;

    let lines_submenu = Submenu::with_items(
        app,
        "Lines",
        true,
        &[
            &MenuItem::with_id(app, "move-line-up", "Move Line Up", true, Some("Alt+Up"))?,
            &MenuItem::with_id(app, "move-line-down", "Move Line Down", true, Some("Alt+Down"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "duplicate-line", "Duplicate Line", true, Some("Shift+Alt+Down"))?,
            &MenuItem::with_id(app, "delete-line", "Delete Line", true, Some("CmdOrCtrl+Shift+K"))?,
            &MenuItem::with_id(app, "join-lines", "Join Lines", true, Some("CmdOrCtrl+J"))?,
            &MenuItem::with_id(app, "remove-blank-lines", "Remove Blank Lines", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sort-lines-asc", "Sort Lines Ascending", true, Some("F5"))?,
            &MenuItem::with_id(app, "sort-lines-desc", "Sort Lines Descending", true, Some("Shift+F5"))?,
        ],
    )?;

    let line_endings_submenu = Submenu::with_items(
        app,
        "Line Endings",
        true,
        &[
            &MenuItem::with_id(app, "line-endings-lf", "Convert to LF", true, None::<&str>)?,
            &MenuItem::with_id(app, "line-endings-crlf", "Convert to CRLF", true, None::<&str>)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Cut"))?,
            &PredefinedMenuItem::copy(app, Some("Copy"))?,
            &PredefinedMenuItem::paste(app, Some("Paste"))?,
            &PredefinedMenuItem::select_all(app, Some("Select All"))?,
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
    let headings_submenu = Submenu::with_items(
        app,
        "Headings",
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
            &MenuItem::with_id(app, "increase-heading", "Increase Heading Level", true, Some("Alt+CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "decrease-heading", "Decrease Heading Level", true, Some("Alt+CmdOrCtrl+["))?,
        ],
    )?;

    let lists_submenu = Submenu::with_items(
        app,
        "Lists",
        true,
        &[
            &MenuItem::with_id(app, "ordered-list", "Ordered List", true, Some("Alt+CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "unordered-list", "Unordered List", true, Some("Alt+CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "task-list", "Task List", true, Some("Alt+CmdOrCtrl+X"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "indent", "Indent", true, Some("CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "outdent", "Outdent", true, Some("CmdOrCtrl+["))?,
            &MenuItem::with_id(app, "remove-list", "Remove List", true, None::<&str>)?,
        ],
    )?;

    let quote_submenu = Submenu::with_items(
        app,
        "Quote",
        true,
        &[
            &MenuItem::with_id(app, "quote", "Quote", true, Some("Alt+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "nest-quote", "Nest Quote", true, None::<&str>)?,
            &MenuItem::with_id(app, "unnest-quote", "Unnest Quote", true, None::<&str>)?,
        ],
    )?;

    let transform_submenu = Submenu::with_items(
        app,
        "Transform",
        true,
        &[
            &MenuItem::with_id(app, "transform-uppercase", "UPPERCASE", true, Some("Ctrl+Shift+U"))?,
            &MenuItem::with_id(app, "transform-lowercase", "lowercase", true, Some("Ctrl+Shift+L"))?,
            &MenuItem::with_id(app, "transform-title-case", "Title Case", true, Some("Ctrl+Shift+T"))?,
            &MenuItem::with_id(app, "transform-toggle-case", "Toggle Case", true, None::<&str>)?,
        ],
    )?;

    let cjk_submenu = Submenu::with_items(
        app,
        "CJK",
        true,
        &[
            &MenuItem::with_id(app, "format-cjk", "Format Selection", true, Some("CmdOrCtrl+Shift+F"))?,
            &MenuItem::with_id(app, "format-cjk-file", "Format Entire File", true, Some("Alt+CmdOrCtrl+Shift+F"))?,
        ],
    )?;

    let cleanup_submenu = Submenu::with_items(
        app,
        "Text Cleanup",
        true,
        &[
            &MenuItem::with_id(app, "remove-trailing-spaces", "Remove Trailing Spaces", true, None::<&str>)?,
            &MenuItem::with_id(app, "collapse-blank-lines", "Collapse Blank Lines", true, None::<&str>)?,
        ],
    )?;

    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &headings_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bold", "Bold", true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "italic", "Italic", true, Some("CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "underline", "Underline", true, Some("CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "strikethrough", "Strikethrough", true, Some("CmdOrCtrl+Shift+X"))?,
            &MenuItem::with_id(app, "code", "Inline Code", true, Some("CmdOrCtrl+Shift+`"))?,
            &MenuItem::with_id(app, "highlight", "Highlight", true, Some("CmdOrCtrl+Shift+M"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "subscript", "Subscript", true, Some("Alt+CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "superscript", "Superscript", true, Some("Alt+CmdOrCtrl+Shift+="))?,
            &PredefinedMenuItem::separator(app)?,
            &lists_submenu,
            &quote_submenu,
            &PredefinedMenuItem::separator(app)?,
            &transform_submenu,
            &cjk_submenu,
            &cleanup_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-format", "Clear Format", true, Some("CmdOrCtrl+\\"))?,
        ],
    )?;

    // ========================================================================
    // Insert menu
    // ========================================================================
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

    let table_submenu = Submenu::with_items(
        app,
        "Table",
        true,
        &[
            &MenuItem::with_id(app, "insert-table", "Insert Table", true, Some("CmdOrCtrl+Shift+T"))?,
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

    let insert_menu = Submenu::with_items(
        app,
        "Insert",
        true,
        &[
            &links_submenu,
            &MenuItem::with_id(app, "image", "Image...", true, Some("Shift+CmdOrCtrl+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &table_submenu,
            &MenuItem::with_id(app, "code-fences", "Code Block", true, Some("Alt+CmdOrCtrl+C"))?,
            &MenuItem::with_id(app, "math-block", "Math Block", true, Some("Alt+CmdOrCtrl+Shift+M"))?,
            &MenuItem::with_id(app, "diagram", "Diagram", true, Some("Alt+Shift+CmdOrCtrl+D"))?,
            &MenuItem::with_id(app, "horizontal-line", "Horizontal Line", true, Some("Alt+CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "footnote", "Footnote", true, None::<&str>)?,
            &MenuItem::with_id(app, "collapsible-block", "Collapsible Block", true, None::<&str>)?,
            &info_boxes_submenu,
        ],
    )?;

    // ========================================================================
    // View menu
    // ========================================================================
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "source-mode", "Source Code Mode", true, Some("F6"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "focus-mode", "Focus Mode", true, Some("F8"))?,
            &MenuItem::with_id(app, "typewriter-mode", "Typewriter Mode", true, Some("F9"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "zoom-actual", "Actual Size", true, Some("CmdOrCtrl+0"))?,
            &MenuItem::with_id(app, "zoom-in", "Zoom In", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "word-wrap", "Toggle Word Wrap", true, Some("Alt+Z"))?,
            &MenuItem::with_id(app, "line-numbers", "Toggle Line Numbers", true, Some("Alt+CmdOrCtrl+L"))?,
            &MenuItem::with_id(app, "diagram-preview", "Toggle Diagram Preview", true, Some("Alt+CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+Shift+B"))?,
            &MenuItem::with_id(app, "outline", "Toggle Outline", true, Some("Alt+CmdOrCtrl+1"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("Enter Full Screen"))?,
        ],
    )?;

    // ========================================================================
    // Window menu
    // ========================================================================
    #[cfg(target_os = "macos")]
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bring-all-to-front", "Bring All to Front", true, None::<&str>)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(app, Some("Maximize"))?,
        ],
    )?;

    // ========================================================================
    // Help menu
    // ========================================================================
    #[cfg(target_os = "macos")]
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "vmark-help", "VMark Help", true, None::<&str>)?,
            &MenuItem::with_id(app, "keyboard-shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "report-issue", "Report an Issue...", true, None::<&str>)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "vmark-help", "VMark Help", true, None::<&str>)?,
            &MenuItem::with_id(app, "keyboard-shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "report-issue", "Report an Issue...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "check-updates", "Check for Updates...", true, None::<&str>)?,
            &PredefinedMenuItem::about(app, Some("About VMark"), None)?,
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

/// Update the Open Recent submenu with the given list of file paths
pub fn update_recent_files_menu(app: &AppHandle, files: Vec<String>) -> tauri::Result<()> {
    // Store snapshot of files for lookup when menu items are clicked
    if let Ok(mut snapshot) = RECENT_FILES_SNAPSHOT.lock() {
        *snapshot = files.clone();
    }

    let Some(menu) = app.menu() else {
        return Ok(());
    };

    // Find the recent files submenu
    let mut submenu_opt = None;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item {
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

/// Update the Open Recent Workspace submenu with the given list of workspace paths
pub fn update_recent_workspaces_menu(app: &AppHandle, workspaces: Vec<String>) -> tauri::Result<()> {
    if let Ok(mut snapshot) = RECENT_WORKSPACES_SNAPSHOT.lock() {
        *snapshot = workspaces.clone();
    }

    let Some(menu) = app.menu() else {
        return Ok(());
    };

    let mut submenu_opt = None;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item {
            if let Some(found) = sub.get(RECENT_WORKSPACES_SUBMENU_ID) {
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

    while let Some(item) = submenu.items()?.first() {
        submenu.remove(item)?;
    }

    if workspaces.is_empty() {
        let no_recent = MenuItem::with_id(app, "no-recent-workspace", "No Recent Workspaces", false, None::<&str>)?;
        submenu.append(&no_recent)?;
    } else {
        for (index, path) in workspaces.iter().enumerate() {
            let foldername = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path);

            let item_id = format!("recent-workspace-{}", index);
            let item = MenuItem::with_id(app, &item_id, foldername, true, None::<&str>)?;
            submenu.append(&item)?;
        }
    }

    let separator = PredefinedMenuItem::separator(app)?;
    submenu.append(&separator)?;

    let clear_item = MenuItem::with_id(app, "clear-recent-workspaces", "Clear Recent Workspaces", !workspaces.is_empty(), None::<&str>)?;
    submenu.append(&clear_item)?;

    Ok(())
}

#[tauri::command]
pub fn update_recent_workspaces(app: AppHandle, workspaces: Vec<String>) -> Result<(), String> {
    update_recent_workspaces_menu(&app, workspaces).map_err(|e| e.to_string())
}

/// Rebuild the application menu with custom keyboard shortcuts.
/// The shortcuts map is: menu_item_id -> accelerator_string (e.g., "bold" -> "CmdOrCtrl+B")
#[tauri::command]
pub fn rebuild_menu(app: AppHandle, shortcuts: HashMap<String, String>) -> Result<(), String> {
    let menu = create_menu_with_shortcuts(&app, &shortcuts).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    crate::macos_menu::apply_menu_fixes();

    Ok(())
}

/// Create menu with custom keyboard shortcuts
fn create_menu_with_shortcuts(
    app: &AppHandle,
    shortcuts: &HashMap<String, String>,
) -> tauri::Result<Menu<tauri::Wry>> {
    // Helper to get shortcut for a menu item, falling back to default
    let get_accel = |id: &str, default: &str| -> Option<String> {
        let accel = shortcuts.get(id).map(|s| s.as_str()).unwrap_or(default);
        if accel.is_empty() {
            None
        } else {
            Some(accel.to_string())
        }
    };

    // ========================================================================
    // App menu (macOS only)
    // ========================================================================
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "VMark",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About VMark"), None)?,
            &MenuItem::with_id(app, "check-updates", "Check for Updates...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "preferences", "Settings...", true, get_accel("preferences", "CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Services"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide VMark"))?,
            &PredefinedMenuItem::hide_others(app, Some("Hide Others"))?,
            &PredefinedMenuItem::show_all(app, Some("Show All"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save-all-quit", "Save All and Quit", true, get_accel("saveAllQuit", "Alt+Shift+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "quit", "Quit VMark", true, get_accel("quit", "CmdOrCtrl+Q"))?,
        ],
    )?;

    // ========================================================================
    // File menu
    // ========================================================================
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

    let recent_workspaces_submenu = Submenu::with_id_and_items(
        app,
        RECENT_WORKSPACES_SUBMENU_ID,
        "Open Recent Workspace",
        true,
        &[
            &MenuItem::with_id(app, "no-recent-workspace", "No Recent Workspaces", false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-recent-workspaces", "Clear Recent Workspaces", true, None::<&str>)?,
        ],
    )?;

    let export_submenu = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &MenuItem::with_id(app, "export-html", "HTML...", true, get_accel("export-html", "Alt+CmdOrCtrl+E"))?,
            &MenuItem::with_id(app, "export-pdf", "Print...", true, get_accel("export-pdf", "CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "copy-html", "Copy as HTML", true, get_accel("copy-html", "CmdOrCtrl+Shift+C"))?,
        ],
    )?;

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

    #[cfg(target_os = "macos")]
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, get_accel("new", "CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", "New Window", true, get_accel("new-window", "CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Open...", true, get_accel("open", "CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open-folder", "Open Folder...", true, get_accel("open-folder", "CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &recent_workspaces_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, get_accel("close", "CmdOrCtrl+W"))?,
            &MenuItem::with_id(app, "close-workspace", "Close Workspace", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, get_accel("save", "CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, get_accel("save-as", "CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "move-to", "Move to...", true, get_accel("move-to", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, get_accel("new", "CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-window", "New Window", true, get_accel("new-window", "CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Open...", true, get_accel("open", "CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open-folder", "Open Folder...", true, get_accel("open-folder", "CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &recent_workspaces_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, get_accel("close", "CmdOrCtrl+W"))?,
            &MenuItem::with_id(app, "close-workspace", "Close Workspace", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, get_accel("save", "CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, get_accel("save-as", "CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "move-to", "Move to...", true, get_accel("move-to", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &export_submenu,
            &PredefinedMenuItem::separator(app)?,
            &history_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "preferences", "Settings...", true, get_accel("preferences", "CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save-all-quit", "Save All and Exit", true, get_accel("save-all-quit", "Alt+Shift+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "quit", "Exit", true, get_accel("quit", "CmdOrCtrl+Q"))?,
        ],
    )?;

    // ========================================================================
    // Edit menu
    // ========================================================================
    let find_submenu = Submenu::with_items(
        app,
        "Find",
        true,
        &[
            &MenuItem::with_id(app, "find-replace", "Find and Replace...", true, get_accel("find-replace", "CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "find-next", "Find Next", true, get_accel("find-next", "CmdOrCtrl+G"))?,
            &MenuItem::with_id(app, "find-prev", "Find Previous", true, get_accel("find-prev", "CmdOrCtrl+Shift+G"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "use-selection-find", "Use Selection for Find", true, get_accel("use-selection-find", "CmdOrCtrl+E"))?,
        ],
    )?;

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

    let lines_submenu = Submenu::with_items(
        app,
        "Lines",
        true,
        &[
            &MenuItem::with_id(app, "move-line-up", "Move Line Up", true, get_accel("move-line-up", "Alt+Up"))?,
            &MenuItem::with_id(app, "move-line-down", "Move Line Down", true, get_accel("move-line-down", "Alt+Down"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "duplicate-line", "Duplicate Line", true, get_accel("duplicate-line", "Shift+Alt+Down"))?,
            &MenuItem::with_id(app, "delete-line", "Delete Line", true, get_accel("delete-line", "CmdOrCtrl+Shift+K"))?,
            &MenuItem::with_id(app, "join-lines", "Join Lines", true, get_accel("join-lines", "CmdOrCtrl+J"))?,
            &MenuItem::with_id(app, "remove-blank-lines", "Remove Blank Lines", true, get_accel("remove-blank-lines", ""))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sort-lines-asc", "Sort Lines Ascending", true, get_accel("sort-lines-asc", "F5"))?,
            &MenuItem::with_id(app, "sort-lines-desc", "Sort Lines Descending", true, get_accel("sort-lines-desc", "Shift+F5"))?,
        ],
    )?;

    let line_endings_submenu = Submenu::with_items(
        app,
        "Line Endings",
        true,
        &[
            &MenuItem::with_id(app, "line-endings-lf", "Convert to LF", true, None::<&str>)?,
            &MenuItem::with_id(app, "line-endings-crlf", "Convert to CRLF", true, None::<&str>)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "undo", "Undo", true, get_accel("undo", "CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", "Redo", true, get_accel("redo", "CmdOrCtrl+Shift+Z"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Cut"))?,
            &PredefinedMenuItem::copy(app, Some("Copy"))?,
            &PredefinedMenuItem::paste(app, Some("Paste"))?,
            &PredefinedMenuItem::select_all(app, Some("Select All"))?,
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
    let headings_submenu = Submenu::with_items(
        app,
        "Headings",
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
        ],
    )?;

    let lists_submenu = Submenu::with_items(
        app,
        "Lists",
        true,
        &[
            &MenuItem::with_id(app, "ordered-list", "Ordered List", true, get_accel("ordered-list", "Alt+CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "unordered-list", "Unordered List", true, get_accel("unordered-list", "Alt+CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "task-list", "Task List", true, get_accel("task-list", "Alt+CmdOrCtrl+X"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "indent", "Indent", true, get_accel("indent", "CmdOrCtrl+]"))?,
            &MenuItem::with_id(app, "outdent", "Outdent", true, get_accel("outdent", "CmdOrCtrl+["))?,
            &MenuItem::with_id(app, "remove-list", "Remove List", true, None::<&str>)?,
        ],
    )?;

    let quote_submenu = Submenu::with_items(
        app,
        "Quote",
        true,
        &[
            &MenuItem::with_id(app, "quote", "Quote", true, get_accel("quote", "Alt+CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, "nest-quote", "Nest Quote", true, None::<&str>)?,
            &MenuItem::with_id(app, "unnest-quote", "Unnest Quote", true, None::<&str>)?,
        ],
    )?;

    let transform_submenu = Submenu::with_items(
        app,
        "Transform",
        true,
        &[
            &MenuItem::with_id(app, "transform-uppercase", "UPPERCASE", true, get_accel("transform-uppercase", "Ctrl+Shift+U"))?,
            &MenuItem::with_id(app, "transform-lowercase", "lowercase", true, get_accel("transform-lowercase", "Ctrl+Shift+L"))?,
            &MenuItem::with_id(app, "transform-title-case", "Title Case", true, get_accel("transform-title-case", "Ctrl+Shift+T"))?,
            &MenuItem::with_id(app, "transform-toggle-case", "Toggle Case", true, get_accel("transform-toggle-case", ""))?,
        ],
    )?;

    let cjk_submenu = Submenu::with_items(
        app,
        "CJK",
        true,
        &[
            &MenuItem::with_id(app, "format-cjk", "Format Selection", true, get_accel("format-cjk", "CmdOrCtrl+Shift+F"))?,
            &MenuItem::with_id(app, "format-cjk-file", "Format Entire File", true, get_accel("format-cjk-file", "Alt+CmdOrCtrl+Shift+F"))?,
        ],
    )?;

    let cleanup_submenu = Submenu::with_items(
        app,
        "Text Cleanup",
        true,
        &[
            &MenuItem::with_id(app, "remove-trailing-spaces", "Remove Trailing Spaces", true, None::<&str>)?,
            &MenuItem::with_id(app, "collapse-blank-lines", "Collapse Blank Lines", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "cleanup-images", "Clean Up Unused Images...", true, None::<&str>)?,
        ],
    )?;

    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &headings_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bold", "Bold", true, get_accel("bold", "CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "italic", "Italic", true, get_accel("italic", "CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "underline", "Underline", true, get_accel("underline", "CmdOrCtrl+U"))?,
            &MenuItem::with_id(app, "strikethrough", "Strikethrough", true, get_accel("strikethrough", "CmdOrCtrl+Shift+X"))?,
            &MenuItem::with_id(app, "code", "Inline Code", true, get_accel("code", "CmdOrCtrl+Shift+`"))?,
            &MenuItem::with_id(app, "highlight", "Highlight", true, get_accel("highlight", "CmdOrCtrl+Shift+M"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "subscript", "Subscript", true, get_accel("subscript", "Alt+CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "superscript", "Superscript", true, get_accel("superscript", "Alt+CmdOrCtrl+Shift+="))?,
            &PredefinedMenuItem::separator(app)?,
            &lists_submenu,
            &quote_submenu,
            &PredefinedMenuItem::separator(app)?,
            &transform_submenu,
            &cjk_submenu,
            &cleanup_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear-format", "Clear Format", true, get_accel("clear-format", "CmdOrCtrl+\\"))?,
        ],
    )?;

    // ========================================================================
    // Insert menu
    // ========================================================================
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

    let insert_menu = Submenu::with_items(
        app,
        "Insert",
        true,
        &[
            &links_submenu,
            &MenuItem::with_id(app, "image", "Image...", true, get_accel("image", "Shift+CmdOrCtrl+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &table_submenu,
            &MenuItem::with_id(app, "code-fences", "Code Block", true, get_accel("code-fences", "Alt+CmdOrCtrl+C"))?,
            &MenuItem::with_id(app, "math-block", "Math Block", true, get_accel("math-block", "Alt+CmdOrCtrl+Shift+M"))?,
            &MenuItem::with_id(app, "diagram", "Diagram", true, get_accel("diagram", "Alt+Shift+CmdOrCtrl+D"))?,
            &MenuItem::with_id(app, "horizontal-line", "Horizontal Line", true, get_accel("horizontal-line", "Alt+CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "footnote", "Footnote", true, None::<&str>)?,
            &MenuItem::with_id(app, "collapsible-block", "Collapsible Block", true, get_accel("collapsible-block", ""))?,
            &info_boxes_submenu,
        ],
    )?;

    // ========================================================================
    // View menu
    // ========================================================================
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "source-mode", "Source Code Mode", true, get_accel("source-mode", "F6"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "focus-mode", "Focus Mode", true, get_accel("focus-mode", "F8"))?,
            &MenuItem::with_id(app, "typewriter-mode", "Typewriter Mode", true, get_accel("typewriter-mode", "F9"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "zoom-actual", "Actual Size", true, get_accel("zoom-actual", "CmdOrCtrl+0"))?,
            &MenuItem::with_id(app, "zoom-in", "Zoom In", true, get_accel("zoom-in", "CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "zoom-out", "Zoom Out", true, get_accel("zoom-out", "CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "word-wrap", "Toggle Word Wrap", true, get_accel("word-wrap", "Alt+Z"))?,
            &MenuItem::with_id(app, "line-numbers", "Toggle Line Numbers", true, get_accel("line-numbers", "Alt+CmdOrCtrl+L"))?,
            &MenuItem::with_id(app, "diagram-preview", "Toggle Diagram Preview", true, get_accel("diagram-preview", "Alt+CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sidebar", "Toggle Sidebar", true, get_accel("sidebar", "CmdOrCtrl+Shift+B"))?,
            &MenuItem::with_id(app, "outline", "Toggle Outline", true, get_accel("outline", "Alt+CmdOrCtrl+1"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("Enter Full Screen"))?,
        ],
    )?;

    // ========================================================================
    // Window menu
    // ========================================================================
    #[cfg(target_os = "macos")]
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bring-all-to-front", "Bring All to Front", true, None::<&str>)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(app, Some("Maximize"))?,
        ],
    )?;

    // ========================================================================
    // Help menu
    // ========================================================================
    #[cfg(target_os = "macos")]
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "vmark-help", "VMark Help", true, None::<&str>)?,
            &MenuItem::with_id(app, "keyboard-shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "report-issue", "Report an Issue...", true, None::<&str>)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "vmark-help", "VMark Help", true, None::<&str>)?,
            &MenuItem::with_id(app, "keyboard-shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "report-issue", "Report an Issue...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "check-updates", "Check for Updates...", true, None::<&str>)?,
            &PredefinedMenuItem::about(app, Some("About VMark"), None)?,
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
