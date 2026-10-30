//! Runtime menu updates (recent files, workspaces, genies).
//!
//! Purpose: Dynamically updates submenu contents without rebuilding the entire menu bar.
//! Called by Tauri commands when the frontend notifies of list changes.
//!
//! @coordinates-with `mod.rs` (snapshot Mutexes and submenu ID constants)
//! @coordinates-with `events.rs` (resolves snapshot paths on click)
//! @coordinates-with `dynamic_layout.rs` (the ids, labels and grouping built here)

use std::collections::HashMap;

use rust_i18n::t;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

#[path = "dynamic_layout.rs"]
mod layout;
use layout::{
    genie_layout, recent_submenu, search_genies_accelerator, GenieLayout, RecentMenu, RecentRow,
    RECENT_FILES_MENU, RECENT_WORKSPACES_MENU,
};

use super::{
    replace_snapshot, GENIES_SNAPSHOT, GENIES_SUBMENU_ID, RECENT_FILES_SNAPSHOT,
    RECENT_FILES_SUBMENU_ID, RECENT_WORKSPACES_SNAPSHOT, RECENT_WORKSPACES_SUBMENU_ID,
};

/// Update the Open Recent submenu with the given list of file paths.
pub fn update_recent_files_menu(app: &AppHandle, files: Vec<String>) -> tauri::Result<()> {
    // Store snapshot of files for lookup when menu items are clicked
    replace_snapshot(&RECENT_FILES_SNAPSHOT, files.clone());
    fill_recent_submenu(app, RECENT_FILES_SUBMENU_ID, &RECENT_FILES_MENU, &files)
}

/// Update the Open Recent Workspace submenu with the given list of workspace paths.
pub fn update_recent_workspaces_menu(
    app: &AppHandle,
    workspaces: Vec<String>,
) -> tauri::Result<()> {
    replace_snapshot(&RECENT_WORKSPACES_SNAPSHOT, workspaces.clone());
    fill_recent_submenu(
        app,
        RECENT_WORKSPACES_SUBMENU_ID,
        &RECENT_WORKSPACES_MENU,
        &workspaces,
    )
}

/// Replace the items of recent submenu `submenu_id` with the rows
/// `recent_submenu` lays out. No menu yet, or no such submenu, is not an error:
/// the snapshot is already stored and the next build reads it.
fn fill_recent_submenu(
    app: &AppHandle,
    submenu_id: &str,
    kind: &RecentMenu,
    paths: &[String],
) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(submenu) = find_nested_submenu(&menu, submenu_id)? else {
        return Ok(());
    };
    while let Some(item) = submenu.items()?.first() {
        submenu.remove(item)?;
    }
    for row in recent_submenu(kind, paths) {
        match row {
            RecentRow::Item { id, label, enabled } => {
                submenu.append(&MenuItem::with_id(app, &id, label, enabled, None::<&str>)?)?;
            }
            RecentRow::Separator => submenu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(())
}

/// The submenu `id` nested one level under any top-level menu, if present.
fn find_nested_submenu(
    menu: &Menu<tauri::Wry>,
    id: &str,
) -> tauri::Result<Option<Submenu<tauri::Wry>>> {
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item {
            if let Some(MenuItemKind::Submenu(found)) = sub.get(id) {
                return Ok(Some(found));
            }
        }
    }
    Ok(None)
}

/// Find the Edit submenu from the top-level menu by ID.
fn find_edit_submenu(menu: &Menu<tauri::Wry>) -> Option<Submenu<tauri::Wry>> {
    for item in menu.items().ok()? {
        if let MenuItemKind::Submenu(top) = item {
            if top.id().0.as_str() == "edit-menu" {
                return Some(top);
            }
        }
    }
    None
}

/// Find the Genies submenu inside a parent submenu by ID.
fn find_genies_submenu(parent: &Submenu<tauri::Wry>) -> Option<Submenu<tauri::Wry>> {
    if let Some(MenuItemKind::Submenu(found)) = parent.get(GENIES_SUBMENU_ID) {
        return Some(found);
    }
    None
}

/// Refresh the Genies submenu by scanning the global genie directory.
/// Called by frontend on mount and when workspace changes.
/// Creates the submenu dynamically inside Edit if it doesn't already exist.
/// Accepts optional shortcuts map to resolve custom accelerators (e.g., "search-genies").
#[tauri::command]
pub fn refresh_genies_menu(
    app: AppHandle,
    shortcuts: Option<HashMap<String, String>>,
) -> Result<(), String> {
    use crate::genies;

    let global_dir = genies::global_genies_dir(&app)?;
    let global_entries = if global_dir.is_dir() {
        genies::scan_genies_with_titles(&global_dir)
    } else {
        Vec::new()
    };
    let layout = genie_layout(&global_entries);

    let menu = app.menu().ok_or("No menu")?;
    let edit_menu = find_edit_submenu(&menu).ok_or("Edit menu not found")?;

    // Find or create the Genies submenu
    let submenu = if let Some(existing) = find_genies_submenu(&edit_menu) {
        // Clear existing items
        while let Some(item) = existing.items().map_err(|e| e.to_string())?.first() {
            existing.remove(item).map_err(|e| e.to_string())?;
        }
        existing
    } else {
        // Create new submenu and append to Edit
        let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
        edit_menu.append(&sep).map_err(|e| e.to_string())?;
        let new_sub =
            Submenu::with_id_and_items(&app, GENIES_SUBMENU_ID, &t!("menu.genies"), true, &[])
                .map_err(|e| e.to_string())?;
        edit_menu.append(&new_sub).map_err(|e| e.to_string())?;
        new_sub
    };

    // "Search Genies..." at top -- opens the picker
    let accel = search_genies_accelerator(shortcuts.as_ref());
    let search_item = MenuItem::with_id(
        &app,
        "search-genies",
        &t!("menu.genies.search"),
        true,
        accel.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    submenu.append(&search_item).map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    submenu.append(&sep).map_err(|e| e.to_string())?;

    if global_entries.is_empty() {
        let no_genies = MenuItem::with_id(
            &app,
            "no-genies",
            &t!("menu.genies.empty"),
            false,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        submenu.append(&no_genies).map_err(|e| e.to_string())?;
    } else {
        append_genie_entries(&app, &submenu, &layout)?;
    }

    // Separator before folder action
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    submenu.append(&sep).map_err(|e| e.to_string())?;

    // Reload Genies
    let reload = MenuItem::with_id(
        &app,
        "reload-genies",
        &t!("menu.genies.reload"),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    submenu.append(&reload).map_err(|e| e.to_string())?;

    // Open Genies Folder
    let open_folder = MenuItem::with_id(
        &app,
        "open-genies-folder",
        &t!("menu.genies.openFolder"),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    submenu.append(&open_folder).map_err(|e| e.to_string())?;

    // Update snapshot
    replace_snapshot(&GENIES_SNAPSHOT, layout.snapshot);

    // Re-apply SF Symbol icons to cover newly added genie items
    #[cfg(target_os = "macos")]
    crate::macos_menu::apply_menu_icons(&app);

    Ok(())
}

/// Remove the Genies submenu from the Edit menu.
/// Called when `useGenieShortcuts` unmounts, which happens with the main window.
#[tauri::command]
pub fn hide_genies_menu(app: AppHandle) -> Result<(), String> {
    let menu = app.menu().ok_or("No menu")?;
    let edit_menu = find_edit_submenu(&menu).ok_or("Edit menu not found")?;

    // Find and remove the Genies submenu
    let was_present = if let Some(genies_sub) = find_genies_submenu(&edit_menu) {
        edit_menu.remove(&genies_sub).map_err(|e| e.to_string())?;
        true
    } else {
        false
    };

    // Remove the separator that refresh_genies_menu prepended before the submenu.
    // Only attempt this when we actually removed the submenu above, so we never
    // accidentally strip a real menu item (Cut/Copy/Paste are also Predefined).
    if was_present {
        if let Some(last) = edit_menu.items().map_err(|e| e.to_string())?.last() {
            if matches!(last, MenuItemKind::Predefined(_)) {
                edit_menu.remove(last).map_err(|e| e.to_string())?;
            }
        }
    }

    // Clear stale snapshot so removed menu items can't resolve genie paths
    replace_snapshot(&GENIES_SNAPSHOT, Vec::new());

    Ok(())
}

/// Append the laid-out genies to a submenu: root items flat, then one
/// submenu per category.
fn append_genie_entries(
    app: &AppHandle,
    parent: &Submenu<tauri::Wry>,
    layout: &GenieLayout<'_>,
) -> Result<(), String> {
    for (item_id, title) in &layout.root {
        let item = MenuItem::with_id(app, item_id, title, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        parent.append(&item).map_err(|e| e.to_string())?;
    }
    for (group_name, items) in &layout.groups {
        let group_sub = Submenu::new(app, group_name, true).map_err(|e| e.to_string())?;
        for (item_id, title) in items {
            let item = MenuItem::with_id(app, item_id, title, true, None::<&str>)
                .map_err(|e| e.to_string())?;
            group_sub.append(&item).map_err(|e| e.to_string())?;
        }
        parent.append(&group_sub).map_err(|e| e.to_string())?;
    }
    Ok(())
}
