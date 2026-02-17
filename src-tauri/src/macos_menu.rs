//! macOS-specific menu fixes.
//!
//! Workaround for muda's broken `set_as_help_menu_for_nsapp()`.
//! See: https://github.com/tauri-apps/muda/pull/322

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSImage, NSMenu};
use objc2_foundation::NSString;

/// Fix the Help menu on macOS.
///
/// This finds the "Help" submenu in the app's main menu and properly registers it
/// with NSApplication so macOS shows the native search field.
///
/// Must be called after `app.set_menu()`.
pub fn fix_help_menu() {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[macos_menu] Not on main thread, cannot fix Help menu");
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        eprintln!("[macos_menu] No main menu found");
        return;
    };

    // Find the Help menu by title
    let help_title = NSString::from_str("Help");
    let Some(help_item) = main_menu.itemWithTitle(&help_title) else {
        eprintln!("[macos_menu] No 'Help' menu item found");
        return;
    };

    let Some(help_submenu) = help_item.submenu() else {
        eprintln!("[macos_menu] Help item has no submenu");
        return;
    };

    // Register as the Help menu — this enables the native search field
    app.setHelpMenu(Some(&help_submenu));

    #[cfg(debug_assertions)]
    eprintln!("[macos_menu] Help menu registered with search field");
}

/// Fix the Window menu on macOS.
///
/// This finds the "Window" submenu and registers it with NSApplication
/// so macOS adds native window management items.
pub fn fix_window_menu() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        return;
    };

    let window_title = NSString::from_str("Window");
    let Some(window_item) = main_menu.itemWithTitle(&window_title) else {
        // Window menu is optional
        return;
    };

    let Some(window_submenu) = window_item.submenu() else {
        return;
    };

    app.setWindowsMenu(Some(&window_submenu));

    #[cfg(debug_assertions)]
    eprintln!("[macos_menu] Window menu registered");
}

// ============================================================================
// SF Symbol Menu Icons
// ============================================================================

/// Maps menu item titles to SF Symbol names.
/// Only leaf items (not submenus) are matched.
const MENU_ICONS: &[(&str, &str)] = &[
    // ── App menu ──
    ("About VMark", "info.circle"),
    ("Settings...", "gearshape"),
    ("Hide VMark", "eye.slash"),
    ("Hide Others", "eye.slash.circle"),
    ("Show All", "eye"),
    ("Save All and Quit", "rectangle.portrait.and.arrow.right"),
    ("Save All and Exit", "rectangle.portrait.and.arrow.right"),
    ("Quit VMark", "power"),
    ("Exit", "power"),
    // ── File menu ──
    ("New", "doc.badge.plus"),
    ("New Window", "macwindow.badge.plus"),
    ("Open...", "folder"),
    ("Open Workspace...", "folder.badge.gearshape"),
    ("Close", "xmark"),
    ("Close Workspace", "xmark.square"),
    ("Save", "arrow.down.doc"),
    ("Save As...", "arrow.down.doc.fill"),
    ("Move to...", "folder.badge.questionmark"),
    // Export
    ("HTML...", "doc.richtext"),
    ("Print...", "printer"),
    ("Copy as HTML", "doc.text"),
    // History
    ("View History...", "clock"),
    ("Clear Workspace History...", "clock.badge.xmark"),
    ("Clear All History...", "clock.badge.xmark"),
    // Recent
    ("Clear Recent Files", "trash"),
    ("Clear Recent Workspaces", "trash"),
    // ── Edit menu ──
    ("Undo", "arrow.uturn.backward"),
    ("Redo", "arrow.uturn.forward"),
    ("Cut", "scissors"),
    ("Copy", "doc.on.doc"),
    ("Paste", "doc.on.clipboard"),
    ("Select All", "checkmark.square"),
    // Find
    ("Find and Replace...", "magnifyingglass"),
    ("Find Next", "chevron.down"),
    ("Find Previous", "chevron.up"),
    ("Use Selection for Find", "text.magnifyingglass"),
    // Selection
    ("Select Word", "textformat.abc"),
    ("Select Line", "arrow.left.and.line.vertical.and.arrow.right"),
    ("Select Block", "rectangle.dashed"),
    ("Expand Selection", "arrow.up.left.and.arrow.down.right"),
    // Lines
    ("Move Line Up", "arrow.up"),
    ("Move Line Down", "arrow.down"),
    ("Duplicate Line", "plus.square.on.square"),
    ("Delete Line", "trash"),
    ("Join Lines", "text.justify"),
    ("Remove Blank Lines", "line.3.horizontal.decrease"),
    ("Sort Lines Ascending", "arrow.up.right"),
    ("Sort Lines Descending", "arrow.down.right"),
    // Line Endings
    ("Convert to LF", "l.circle"),
    ("Convert to CRLF", "c.circle"),
    // ── Format menu ──
    ("Bold", "bold"),
    ("Italic", "italic"),
    ("Underline", "underline"),
    ("Strikethrough", "strikethrough"),
    ("Inline Code", "chevron.left.forwardslash.chevron.right"),
    ("Highlight", "highlighter"),
    ("Subscript", "textformat.subscript"),
    ("Superscript", "textformat.superscript"),
    ("Clear Format", "paintbrush"),
    // Headings
    ("Heading 1", "1.circle"),
    ("Heading 2", "2.circle"),
    ("Heading 3", "3.circle"),
    ("Heading 4", "4.circle"),
    ("Heading 5", "5.circle"),
    ("Heading 6", "6.circle"),
    ("Paragraph", "paragraph"),
    ("Increase Heading Level", "plus.circle"),
    ("Decrease Heading Level", "minus.circle"),
    // Lists
    ("Ordered List", "list.number"),
    ("Unordered List", "list.bullet"),
    ("Task List", "checklist"),
    ("Indent", "increase.indent"),
    ("Outdent", "decrease.indent"),
    ("Remove List", "xmark.circle"),
    // Blockquote
    ("Blockquote", "text.quote"),
    ("Nest Blockquote", "increase.indent"),
    ("Unnest Blockquote", "decrease.indent"),
    // Transform
    ("UPPERCASE", "textformat.size.larger"),
    ("lowercase", "textformat.size.smaller"),
    ("Title Case", "textformat"),
    ("Toggle Case", "arrow.up.arrow.down"),
    ("Toggle Quote Style", "quote.opening"),
    // CJK
    ("Format Selection", "globe.asia.australia"),
    ("Format Entire File", "doc.text.magnifyingglass"),
    // Text Cleanup
    ("Remove Trailing Spaces", "eraser"),
    ("Collapse Blank Lines", "rectangle.compress.vertical"),
    ("Clean Up Unused Images...", "photo.badge.minus"),
    // ── Insert menu ──
    ("Link", "link"),
    ("Wiki Link", "link.badge.plus"),
    ("Bookmark", "bookmark"),
    ("Image...", "photo"),
    ("Video...", "video"),
    ("Audio...", "waveform"),
    ("Insert Table", "tablecells"),
    ("Code Block", "curlybraces"),
    ("Math Block", "function"),
    ("Diagram", "chart.xyaxis.line"),
    ("Horizontal Line", "minus"),
    ("Footnote", "note.text"),
    ("Collapsible Block", "chevron.down.square"),
    ("Mindmap", "brain"),
    // Table
    ("Add Row Above", "arrow.up.to.line"),
    ("Add Row Below", "arrow.down.to.line"),
    ("Add Column Before", "arrow.left.to.line"),
    ("Add Column After", "arrow.right.to.line"),
    ("Delete Row", "minus.rectangle"),
    ("Delete Column", "minus.rectangle.portrait"),
    ("Delete Table", "trash"),
    ("Align Left", "text.alignleft"),
    ("Align Center", "text.aligncenter"),
    ("Align Right", "text.alignright"),
    ("Align All Left", "text.alignleft"),
    ("Align All Center", "text.aligncenter"),
    ("Align All Right", "text.alignright"),
    ("Format Table", "wand.and.stars"),
    // Info Box
    ("Note", "note.text"),
    ("Tip", "lightbulb"),
    ("Important", "exclamationmark.circle"),
    ("Warning", "exclamationmark.triangle"),
    ("Caution", "flame"),
    // ── View menu ──
    ("Source Code Mode", "chevron.left.forwardslash.chevron.right"),
    ("Focus Mode", "eye"),
    ("Typewriter Mode", "character.cursor.ibeam"),
    ("Actual Size", "1.magnifyingglass"),
    ("Zoom In", "plus.magnifyingglass"),
    ("Zoom Out", "minus.magnifyingglass"),
    ("Toggle Word Wrap", "arrow.right.to.line"),
    ("Toggle Line Numbers", "number"),
    ("Toggle Diagram Preview", "eye.square"),
    ("Fit Tables to Width", "arrow.left.and.right.righttriangle.left.righttriangle.right"),
    ("Toggle Outline", "list.bullet.indent"),
    ("Toggle File Explorer", "folder"),
    ("Toggle History", "clock.arrow.circlepath"),
    ("Toggle Terminal", "terminal"),
    ("Enter Full Screen", "arrow.up.left.and.arrow.down.right"),
    // ── Window menu ──
    ("Minimize", "minus.square"),
    ("Zoom", "arrow.up.left.and.arrow.down.right"),
    ("Maximize", "arrow.up.left.and.arrow.down.right"),
    ("Bring All to Front", "macwindow.on.rectangle"),
    // ── Help menu ──
    ("VMark Help", "questionmark.circle"),
    ("Keyboard Shortcuts", "keyboard"),
    ("Report an Issue...", "exclamationmark.bubble"),
    // ── Genies menu (structural items) ──
    ("Search Genies\u{2026}", "sparkles"),
    ("No Genies", "sparkles"),
    ("Reload Genies", "arrow.clockwise"),
    ("Open Genies Folder", "folder"),
];

/// Look up the SF Symbol name for a menu item title.
fn icon_for_title(title: &str) -> Option<&'static str> {
    MENU_ICONS
        .iter()
        .find(|(t, _)| *t == title)
        .map(|(_, icon)| *icon)
        .filter(|s| !s.is_empty())
}

/// Apply SF Symbol icons to all menu items (leaf items only, not submenus).
/// Walks the entire menu tree recursively.
pub fn apply_menu_icons() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        return;
    };

    apply_icons_to_menu(&main_menu, None);

    #[cfg(debug_assertions)]
    eprintln!("[macos_menu] Menu icons applied");
}

/// Fallback icon for dynamic menu items based on which submenu they're in.
fn fallback_for_submenu_id(id: Option<&str>) -> Option<&'static str> {
    match id {
        Some(crate::menu::RECENT_FILES_SUBMENU_ID) => Some("doc"),
        Some(crate::menu::RECENT_WORKSPACES_SUBMENU_ID) => Some("folder"),
        Some(crate::menu::GENIES_SUBMENU_ID) => Some("sparkles"),
        _ => None,
    }
}

/// Recursively walk an NSMenu and set SF Symbol icons on leaf items.
/// `submenu_id` tracks the Tauri submenu ID for context-aware fallback icons.
fn apply_icons_to_menu(menu: &NSMenu, submenu_id: Option<&str>) {
    let count = menu.numberOfItems();

    for i in 0..count {
        let Some(item) = menu.itemAtIndex(i) else {
            continue;
        };

        // Skip separators
        if item.isSeparatorItem() {
            continue;
        }

        // If item has a submenu, recurse with the submenu's title as context.
        // Tauri submenu IDs aren't exposed on NSMenuItem, so we match by title
        // for known submenus that need context-aware fallbacks.
        if let Some(child_menu) = item.submenu() {
            let child_id = submenu_title_to_id(&item.title().to_string());
            apply_icons_to_menu(&child_menu, child_id.as_deref());
            continue;
        }

        // Already has an icon — skip
        if item.image().is_some() {
            continue;
        }

        let title = item.title();
        let title_str = title.to_string();

        let symbol_name = match icon_for_title(&title_str) {
            Some(name) => name,
            None => match fallback_for_submenu_id(submenu_id) {
                Some(fallback) => fallback,
                None => continue, // No icon for unrecognized dynamic items
            },
        };

        let ns_name = NSString::from_str(symbol_name);
        if let Some(image) =
            NSImage::imageWithSystemSymbolName_accessibilityDescription(&ns_name, None)
        {
            item.setImage(Some(&image));
        }
    }
}

/// Map known submenu titles to their Tauri submenu IDs.
fn submenu_title_to_id(title: &str) -> Option<String> {
    match title {
        "Open Recent" => Some(crate::menu::RECENT_FILES_SUBMENU_ID.to_string()),
        "Open Recent Workspace" => Some(crate::menu::RECENT_WORKSPACES_SUBMENU_ID.to_string()),
        "Genies" => Some(crate::menu::GENIES_SUBMENU_ID.to_string()),
        _ => None,
    }
}

/// Apply all macOS menu fixes.
pub fn apply_menu_fixes() {
    fix_help_menu();
    fix_window_menu();
    apply_menu_icons();
}
