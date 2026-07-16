//! macOS-specific menu fixes.
//!
//! Applies SF Symbol icons to menu items and registers Help/Window menus
//! with NSApplication for native macOS behavior.
//!
//! All lookups use stable menu item IDs (not translated titles) for i18n safety (see muda PR #322).

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

// SF Symbol icon tables live in a sibling data module to keep this file small.
#[path = "macos_menu_icons.rs"]
mod icons;
use icons::{MENU_ICONS, PREDEFINED_ICONS};

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

/// Insert `title -> icon` for a leaf item (plain or checkmarked), resolving by
/// id then falling back. Lets the View editor-mode `Check` trio keep icons.
fn record_leaf_icon(
    map: &mut HashMap<String, &'static str>,
    id: &str,
    title: Result<String, tauri::Error>,
    fallback: Option<&'static str>,
) {
    if let (Some(icon), Ok(title)) = (icon_for_id(id).or(fallback), title) {
        map.insert(title, icon);
    }
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
        MenuItemKind::MenuItem(mi) => record_leaf_icon(map, mi.id().0.as_str(), mi.text(), None),
        MenuItemKind::Check(ci) => record_leaf_icon(map, ci.id().0.as_str(), ci.text(), None),
        MenuItemKind::Predefined(pi) => {
            // PredefinedMenuItems (Cut, Copy, etc.) match by title text.
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
    let fallback = fallback_for_submenu_id(Some(submenu_id));
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
            record_leaf_icon(map, mi.id().0.as_str(), mi.text(), fallback)
        }
        MenuItemKind::Check(ci) => record_leaf_icon(map, ci.id().0.as_str(), ci.text(), fallback),
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
