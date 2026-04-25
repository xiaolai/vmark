//! Runtime menu updates (recent files, workspaces, genies).
//!
//! Purpose: Dynamically updates submenu contents without rebuilding the entire menu bar.
//! Called by Tauri commands when the frontend notifies of list changes.
//!
//! @coordinates-with `mod.rs` (snapshot Mutexes and submenu ID constants)
//! @coordinates-with `menu_events.rs` (resolves snapshot paths on click)

use std::collections::HashMap;

use rust_i18n::t;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

use super::{
    GENIES_SNAPSHOT, GENIES_SUBMENU_ID, RECENT_FILES_SNAPSHOT, RECENT_FILES_SUBMENU_ID,
    RECENT_WORKSPACES_SNAPSHOT, RECENT_WORKSPACES_SUBMENU_ID,
};

/// Update the Open Recent submenu with the given list of file paths.
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
            if let Some(MenuItemKind::Submenu(recent)) = sub.get(RECENT_FILES_SUBMENU_ID) {
                submenu_opt = Some(recent);
                break;
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
        let no_recent =
            MenuItem::with_id(app, "no-recent", &t!("menu.recentFiles.empty").to_string(), false, None::<&str>)?;
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

    let clear_item = MenuItem::with_id(
        app,
        "clear-recent",
        &t!("menu.recentFiles.clear").to_string(),
        !files.is_empty(),
        None::<&str>,
    )?;
    submenu.append(&clear_item)?;

    Ok(())
}

/// Update the Open Recent Workspace submenu with the given list of workspace paths.
pub fn update_recent_workspaces_menu(
    app: &AppHandle,
    workspaces: Vec<String>,
) -> tauri::Result<()> {
    if let Ok(mut snapshot) = RECENT_WORKSPACES_SNAPSHOT.lock() {
        *snapshot = workspaces.clone();
    }

    let Some(menu) = app.menu() else {
        return Ok(());
    };

    let mut submenu_opt = None;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item {
            if let Some(MenuItemKind::Submenu(recent)) = sub.get(RECENT_WORKSPACES_SUBMENU_ID) {
                submenu_opt = Some(recent);
                break;
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
        let no_recent = MenuItem::with_id(
            app,
            "no-recent-workspace",
            &t!("menu.recentWorkspaces.empty").to_string(),
            false,
            None::<&str>,
        )?;
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

    let clear_item = MenuItem::with_id(
        app,
        "clear-recent-workspaces",
        &t!("menu.recentWorkspaces.clear").to_string(),
        !workspaces.is_empty(),
        None::<&str>,
    )?;
    submenu.append(&clear_item)?;

    Ok(())
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

/// Refresh the Genies submenu by scanning global and workspace genie directories.
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

    let mut snapshot: Vec<String> = Vec::new();

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
            Submenu::with_id_and_items(&app, GENIES_SUBMENU_ID, &t!("menu.genies").to_string(), true, &[])
                .map_err(|e| e.to_string())?;
        edit_menu
            .append(&new_sub)
            .map_err(|e| e.to_string())?;
        new_sub
    };

    // "Search Genies..." at top -- opens the picker
    // When shortcuts map is provided, use its value (empty = unbound).
    // When no shortcuts map is provided, fall back to default.
    let accel: Option<String> = match &shortcuts {
        Some(s) => match s.get("search-genies") {
            Some(v) if v.is_empty() => None, // explicitly unbound
            Some(v) => Some(v.clone()),
            None => Some("CmdOrCtrl+Y".to_string()), // key absent from map
        },
        None => Some("CmdOrCtrl+Y".to_string()), // no map at all
    };
    let search_item =
        MenuItem::with_id(&app, "search-genies", &t!("menu.genies.search").to_string(), true, accel.as_deref())
            .map_err(|e| e.to_string())?;
    submenu
        .append(&search_item)
        .map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    submenu.append(&sep).map_err(|e| e.to_string())?;

    if global_entries.is_empty() {
        let no_genies =
            MenuItem::with_id(&app, "no-genies", &t!("menu.genies.empty").to_string(), false, None::<&str>)
                .map_err(|e| e.to_string())?;
        submenu
            .append(&no_genies)
            .map_err(|e| e.to_string())?;
    } else {
        append_genie_entries(&app, &submenu, &global_entries, &mut snapshot)?;
    }

    // Separator before folder action
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    submenu.append(&sep).map_err(|e| e.to_string())?;

    // Reload Genies
    let reload =
        MenuItem::with_id(&app, "reload-genies", &t!("menu.genies.reload").to_string(), true, None::<&str>)
            .map_err(|e| e.to_string())?;
    submenu.append(&reload).map_err(|e| e.to_string())?;

    // Open Genies Folder
    let open_folder = MenuItem::with_id(
        &app,
        "open-genies-folder",
        &t!("menu.genies.openFolder").to_string(),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    submenu
        .append(&open_folder)
        .map_err(|e| e.to_string())?;

    // Update snapshot
    if let Ok(mut s) = GENIES_SNAPSHOT.lock() {
        *s = snapshot;
    }

    // Re-apply SF Symbol icons to cover newly added genie items
    #[cfg(target_os = "macos")]
    crate::macos_menu::apply_menu_icons(&app);

    Ok(())
}

/// Remove the Genies submenu from the Edit menu.
/// Called when the feature is toggled off (useGenieShortcuts unmounts).
#[tauri::command]
pub fn hide_genies_menu(app: AppHandle) -> Result<(), String> {
    let menu = app.menu().ok_or("No menu")?;
    let edit_menu = find_edit_submenu(&menu).ok_or("Edit menu not found")?;

    // Find and remove the Genies submenu
    let was_present = if let Some(genies_sub) = find_genies_submenu(&edit_menu) {
        edit_menu
            .remove(&genies_sub)
            .map_err(|e| e.to_string())?;
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
    if let Ok(mut s) = GENIES_SNAPSHOT.lock() {
        s.clear();
    }

    Ok(())
}

/// Append genie entries to a submenu: root-level items flat, categorized items as group submenus.
fn append_genie_entries(
    app: &AppHandle,
    parent: &Submenu<tauri::Wry>,
    entries: &[crate::genies::GenieMenuEntry],
    snapshot: &mut Vec<String>,
) -> Result<(), String> {
    // Separate root-level entries from categorized entries
    let mut root_entries = Vec::new();
    let mut groups: HashMap<String, Vec<&crate::genies::GenieMenuEntry>> = HashMap::new();

    for entry in entries {
        if let Some(ref cat) = entry.category {
            groups.entry(cat.clone()).or_default().push(entry);
        } else {
            root_entries.push(entry);
        }
    }

    // Add root-level entries first
    for entry in &root_entries {
        let index = snapshot.len();
        let item_id = format!("genie-item-{}", index);
        let item = MenuItem::with_id(app, &item_id, &entry.title, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        parent.append(&item).map_err(|e| e.to_string())?;
        snapshot.push(entry.path.clone());
    }

    // Add group submenus (sorted by name)
    let mut group_names: Vec<String> = groups.keys().cloned().collect();
    group_names.sort();

    for group_name in &group_names {
        let group_entries = &groups[group_name];
        let group_sub =
            Submenu::new(app, group_name, true).map_err(|e| e.to_string())?;

        for entry in group_entries {
            let index = snapshot.len();
            let item_id = format!("genie-item-{}", index);
            let item = MenuItem::with_id(app, &item_id, &entry.title, true, None::<&str>)
                .map_err(|e| e.to_string())?;
            group_sub.append(&item).map_err(|e| e.to_string())?;
            snapshot.push(entry.path.clone());
        }

        parent
            .append(&group_sub)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
