//! macOS-specific menu fixes.
//!
//! Applies SF Symbol icons to menu items and registers Help/Window menus
//! with NSApplication for native macOS behavior.
//!
//! All lookups use stable menu item IDs (not translated titles) for i18n safety.
//! See: https://github.com/tauri-apps/muda/pull/322

use std::collections::HashMap;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSImage, NSMenu};
use objc2_foundation::NSString;
use tauri::menu::MenuItemKind;

/// Fix the Help menu on macOS.
///
/// Help is always the last top-level menu. Uses positional lookup
/// (not title matching) so it works regardless of UI language.
///
/// Must be called after `app.set_menu()`.
pub fn fix_help_menu() {
    let Some(mtm) = MainThreadMarker::new() else {
        log::warn!("[macos_menu] Not on main thread, cannot fix Help menu");
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        log::warn!("[macos_menu] No main menu found");
        return;
    };

    // Help menu is always the last top-level menu item on macOS
    let item_count = main_menu.numberOfItems();
    if item_count == 0 {
        log::warn!("[macos_menu] Main menu has no items");
        return;
    }

    let Some(help_item) = main_menu.itemAtIndex(item_count - 1) else {
        log::warn!("[macos_menu] Could not get last menu item");
        return;
    };

    let Some(help_submenu) = help_item.submenu() else {
        log::warn!("[macos_menu] Last menu item has no submenu");
        return;
    };

    // Register as the Help menu — this enables the native search field
    app.setHelpMenu(Some(&help_submenu));

    log::debug!("[macos_menu] Help menu registered with search field");
}

/// Fix the Window menu on macOS.
///
/// Window is always the second-to-last top-level menu. Uses positional lookup
/// (not title matching) so it works regardless of UI language.
pub fn fix_window_menu() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        return;
    };

    // Window menu is always second-to-last (before Help)
    let item_count = main_menu.numberOfItems();
    if item_count < 2 {
        return;
    }

    let Some(window_item) = main_menu.itemAtIndex(item_count - 2) else {
        return;
    };

    let Some(window_submenu) = window_item.submenu() else {
        return;
    };

    app.setWindowsMenu(Some(&window_submenu));

    log::debug!("[macos_menu] Window menu registered");
}

// ============================================================================
// SF Symbol Menu Icons
// ============================================================================

/// Maps menu item **IDs** to SF Symbol names.
/// Only leaf items (not submenus) are matched.
/// IDs come from `MenuItem::with_id(app, "THE-ID", ...)` in menu builders.
const MENU_ICONS: &[(&str, &str)] = &[
    // ── App menu ──
    ("about", "info.circle"),
    ("preferences", "gearshape"),
    ("save-all-quit", "rectangle.portrait.and.arrow.right"),
    ("quit", "power"),
    // ── File menu ──
    ("new", "doc.badge.plus"),
    ("new-window", "macwindow.badge.plus"),
    ("quick-open", "magnifyingglass"),
    ("open", "folder"),
    ("open-folder", "folder.badge.gearshape"),
    ("close", "xmark"),
    ("close-workspace", "xmark.square"),
    ("save", "arrow.down.doc"),
    ("save-as", "arrow.down.doc.fill"),
    ("move-to", "folder.badge.questionmark"),
    // Export
    ("export-html", "doc.richtext"),
    ("export-pdf", "printer"),
    ("export-pdf-native", "arrow.up.doc"),
    ("export-pandoc-docx", "doc.richtext.fill"),
    ("export-pandoc-epub", "book"),
    ("export-pandoc-latex", "function"),
    ("export-pandoc-odt", "doc.text"),
    ("export-pandoc-rtf", "doc.plaintext"),
    ("export-pandoc-txt", "doc"),
    ("export-pandoc-hint", "info.circle"),
    ("copy-html", "doc.text"),
    // History
    ("clear-workspace-history", "clock.badge.xmark"),
    ("clear-history", "clock.badge.xmark"),
    // Recent
    ("clear-recent", "trash"),
    ("clear-recent-workspaces", "trash"),
    // ── Edit menu ──
    ("undo", "arrow.uturn.backward"),
    ("redo", "arrow.uturn.forward"),
    // Find
    ("find-replace", "magnifyingglass"),
    ("find-next", "chevron.down"),
    ("find-prev", "chevron.up"),
    ("use-selection-find", "text.magnifyingglass"),
    ("find-in-files", "doc.text.magnifyingglass"),
    // Selection
    ("select-word", "textformat.abc"),
    ("select-line", "arrow.left.and.line.vertical.and.arrow.right"),
    ("select-block", "rectangle.dashed"),
    ("expand-selection", "arrow.up.left.and.arrow.down.right"),
    // Lines
    ("move-line-up", "arrow.up"),
    ("move-line-down", "arrow.down"),
    ("duplicate-line", "plus.square.on.square"),
    ("delete-line", "trash"),
    ("join-lines", "text.justify"),
    ("remove-blank-lines", "line.3.horizontal.decrease"),
    ("sort-lines-asc", "arrow.up.right"),
    ("sort-lines-desc", "arrow.down.right"),
    // Line Endings
    ("line-endings-lf", "l.circle"),
    ("line-endings-crlf", "c.circle"),
    // ── Format menu ──
    ("bold", "bold"),
    ("italic", "italic"),
    ("underline", "underline"),
    ("strikethrough", "strikethrough"),
    ("code", "chevron.left.forwardslash.chevron.right"),
    ("highlight", "highlighter"),
    ("subscript", "textformat.subscript"),
    ("superscript", "textformat.superscript"),
    ("clear-format", "paintbrush"),
    // Headings
    ("heading-1", "1.circle"),
    ("heading-2", "2.circle"),
    ("heading-3", "3.circle"),
    ("heading-4", "4.circle"),
    ("heading-5", "5.circle"),
    ("heading-6", "6.circle"),
    ("paragraph", "paragraph"),
    ("increase-heading", "plus.circle"),
    ("decrease-heading", "minus.circle"),
    // Lists
    ("ordered-list", "list.number"),
    ("unordered-list", "list.bullet"),
    ("task-list", "checklist"),
    ("indent", "increase.indent"),
    ("outdent", "decrease.indent"),
    ("remove-list", "xmark.circle"),
    // Blockquote
    ("quote", "text.quote"),
    ("nest-blockquote", "increase.indent"),
    ("unnest-blockquote", "decrease.indent"),
    // Transform
    ("transform-uppercase", "textformat.size.larger"),
    ("transform-lowercase", "textformat.size.smaller"),
    ("transform-title-case", "textformat"),
    ("transform-toggle-case", "arrow.up.arrow.down"),
    ("toggle-quote-style", "quote.opening"),
    // CJK
    ("format-cjk", "globe.asia.australia"),
    ("format-cjk-file", "doc.text.magnifyingglass"),
    // Text Cleanup
    ("remove-trailing-spaces", "eraser"),
    ("collapse-blank-lines", "rectangle.compress.vertical"),
    ("cleanup-images", "photo.badge.minus"),
    // ── Insert menu ──
    ("link", "link"),
    ("wiki-link", "link.badge.plus"),
    ("bookmark", "bookmark"),
    ("image", "photo"),
    ("video", "video"),
    ("audio", "waveform"),
    ("insert-table", "tablecells"),
    ("code-fences", "curlybraces"),
    ("math-block", "function"),
    ("diagram", "chart.xyaxis.line"),
    ("horizontal-line", "minus"),
    ("footnote", "note.text"),
    ("collapsible-block", "chevron.down.square"),
    ("mindmap", "brain"),
    // Table
    ("add-row-before", "arrow.up.to.line"),
    ("add-row-after", "arrow.down.to.line"),
    ("add-col-before", "arrow.left.to.line"),
    ("add-col-after", "arrow.right.to.line"),
    ("delete-row", "minus.rectangle"),
    ("delete-col", "minus.rectangle.portrait"),
    ("delete-table", "trash"),
    ("align-left", "text.alignleft"),
    ("align-center", "text.aligncenter"),
    ("align-right", "text.alignright"),
    ("align-all-left", "text.alignleft"),
    ("align-all-center", "text.aligncenter"),
    ("align-all-right", "text.alignright"),
    ("format-table", "wand.and.stars"),
    // Info Box
    ("info-note", "note.text"),
    ("info-tip", "lightbulb"),
    ("info-important", "exclamationmark.circle"),
    ("info-warning", "exclamationmark.triangle"),
    ("info-caution", "flame"),
    // ── View menu ──
    ("check-markdown", "checkmark.circle"),
    ("lint-next", "chevron.down"),
    ("lint-prev", "chevron.up"),
    ("source-mode", "chevron.left.forwardslash.chevron.right"),
    ("focus-mode", "eye"),
    ("typewriter-mode", "character.cursor.ibeam"),
    ("zoom-actual", "1.magnifyingglass"),
    ("zoom-in", "plus.magnifyingglass"),
    ("zoom-out", "minus.magnifyingglass"),
    ("word-wrap", "arrow.right.to.line"),
    ("line-numbers", "number"),
    ("diagram-preview", "eye.square"),
    ("fit-tables", "arrow.left.and.right.righttriangle.left.righttriangle.right"),
    ("read-only", "lock"),
    ("outline", "list.bullet.indent"),
    ("file-explorer", "folder"),
    ("view-history", "clock.arrow.circlepath"),
    ("toggle-terminal", "terminal"),
    // ── Window menu ──
    ("bring-all-to-front", "macwindow.on.rectangle"),
    // ── Help menu ──
    ("vmark-help", "questionmark.circle"),
    ("keyboard-shortcuts", "keyboard"),
    ("install-cli", "terminal"),
    ("report-issue", "exclamationmark.bubble"),
    // ── Genies menu (structural items) ──
    ("search-genies", "sparkles"),
    ("no-genies", "sparkles"),
    ("reload-genies", "arrow.clockwise"),
    ("open-genies-folder", "folder"),
];

/// Icons for PredefinedMenuItems (Cut, Copy, etc.) which don't have custom IDs.
/// Mapped by the muda default title text (after mnemonic stripping).
/// When `None` is passed to PredefinedMenuItem constructors, muda generates these
/// titles automatically. This is a best-effort match for English locale.
const PREDEFINED_ICONS: &[(&str, &str)] = &[
    ("Cut", "scissors"),
    ("Copy", "doc.on.doc"),
    ("Paste", "doc.on.clipboard"),
    ("Select All", "checkmark.square"),
    ("Services", "gear"),
    ("Hide VMark", "eye.slash"),
    ("Hide Others", "eye.slash.circle"),
    ("Show All", "eye"),
    ("Minimize", "minus.square"),
    ("Zoom", "arrow.up.left.and.arrow.down.right"),
    ("Maximize", "arrow.up.left.and.arrow.down.right"),
    ("Toggle Full Screen", "arrow.up.left.and.arrow.down.right"),
    ("Close Window", "xmark.square"),
];

/// Look up the SF Symbol name for a menu item ID.
fn icon_for_id(id: &str) -> Option<&'static str> {
    MENU_ICONS
        .iter()
        .find(|(i, _)| *i == id)
        .map(|(_, icon)| *icon)
        .filter(|s| !s.is_empty())
}

/// Look up the SF Symbol name for a PredefinedMenuItem by its title text.
fn icon_for_predefined_title(title: &str) -> Option<&'static str> {
    PREDEFINED_ICONS
        .iter()
        .find(|(t, _)| *t == title)
        .map(|(_, icon)| *icon)
}

/// Build a `title -> SF Symbol` map by walking the Tauri menu tree.
///
/// For each leaf item, looks up its ID in `MENU_ICONS` and records the mapping
/// from its current display title to the SF Symbol name. This decouples the
/// NSMenu icon application from hardcoded English titles — when titles are
/// translated, the ID-based lookup still resolves correctly.
fn build_title_icon_map(app_handle: &tauri::AppHandle) -> HashMap<String, &'static str> {
    let mut map = HashMap::new();

    let Some(menu) = app_handle.menu() else {
        return map;
    };

    let Ok(items) = menu.items() else {
        return map;
    };

    for item in items {
        collect_icons_from_item(&item, &mut map);
    }

    map
}

/// Recursively collect title -> icon mappings from a Tauri MenuItemKind.
fn collect_icons_from_item(
    item: &MenuItemKind<tauri::Wry>,
    map: &mut HashMap<String, &'static str>,
) {
    match item {
        MenuItemKind::Submenu(sub) => {
            // Record submenu ID for fallback icon resolution
            if let Ok(items) = sub.items() {
                let sub_id = sub.id().0.as_str();
                for child in &items {
                    collect_icons_from_item_in_submenu(child, sub_id, map);
                }
            }
        }
        MenuItemKind::MenuItem(mi) => {
            let id = mi.id().0.as_str();
            if let Some(icon) = icon_for_id(id) {
                if let Ok(title) = mi.text() {
                    map.insert(title, icon);
                }
            }
        }
        MenuItemKind::Predefined(pi) => {
            // PredefinedMenuItems (Cut, Copy, etc.) don't have custom IDs.
            // Match by their title text using the PREDEFINED_ICONS table.
            if let Ok(title) = pi.text() {
                if let Some(icon) = icon_for_predefined_title(&title) {
                    map.insert(title, icon);
                }
            }
        }
        _ => {}
    }
}

/// Collect icons within a known submenu context (for fallback icons).
fn collect_icons_from_item_in_submenu(
    item: &MenuItemKind<tauri::Wry>,
    submenu_id: &str,
    map: &mut HashMap<String, &'static str>,
) {
    match item {
        MenuItemKind::Submenu(sub) => {
            if let Ok(items) = sub.items() {
                let sub_id = sub.id().0.as_str();
                for child in &items {
                    collect_icons_from_item_in_submenu(child, sub_id, map);
                }
            }
        }
        MenuItemKind::MenuItem(mi) => {
            let id = mi.id().0.as_str();
            let icon = icon_for_id(id).or_else(|| fallback_for_submenu_id(Some(submenu_id)));
            if let Some(icon) = icon {
                if let Ok(title) = mi.text() {
                    map.insert(title, icon);
                }
            }
        }
        MenuItemKind::Predefined(pi) => {
            if let Ok(title) = pi.text() {
                if let Some(icon) = icon_for_predefined_title(&title) {
                    map.insert(title, icon);
                }
            }
        }
        _ => {}
    }
}

/// Apply SF Symbol icons to all menu items (leaf items only, not submenus).
/// Walks the Tauri menu tree to build an ID-based title->icon map, then
/// applies icons via NSMenu traversal.
pub fn apply_menu_icons(app_handle: &tauri::AppHandle) {
    let title_icon_map = build_title_icon_map(app_handle);

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let ns_app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = ns_app.mainMenu() else {
        return;
    };

    apply_icons_to_ns_menu(&main_menu, &title_icon_map);

    log::debug!("[macos_menu] Menu icons applied");
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
/// Uses the pre-built title->icon map for lookup.
fn apply_icons_to_ns_menu(menu: &NSMenu, title_icon_map: &HashMap<String, &'static str>) {
    let count = menu.numberOfItems();

    for i in 0..count {
        let Some(item) = menu.itemAtIndex(i) else {
            continue;
        };

        // Skip separators
        if item.isSeparatorItem() {
            continue;
        }

        // If item has a submenu, recurse
        if let Some(child_menu) = item.submenu() {
            apply_icons_to_ns_menu(&child_menu, title_icon_map);
            continue;
        }

        // Already has an icon — skip
        if item.image().is_some() {
            continue;
        }

        let title = item.title();
        let title_str = title.to_string();

        let Some(symbol_name) = title_icon_map.get(&title_str).copied() else {
            continue;
        };

        let ns_name = NSString::from_str(symbol_name);
        if let Some(image) =
            NSImage::imageWithSystemSymbolName_accessibilityDescription(&ns_name, None)
        {
            item.setImage(Some(&image));
        }
    }
}

/// Apply all macOS menu fixes.
pub fn apply_menu_fixes(app_handle: &tauri::AppHandle) {
    fix_help_menu();
    fix_window_menu();
    apply_menu_icons(app_handle);
}
