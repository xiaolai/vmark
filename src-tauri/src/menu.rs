use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

pub fn create_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // File menu
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?,
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
            &MenuItem::with_id(
                app,
                "preferences",
                "Preferences...",
                true,
                Some("CmdOrCtrl+,"),
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
        ],
    )?;

    // Help menu
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "about", "About VMark", true, None::<&str>)?,
        ],
    )?;

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
