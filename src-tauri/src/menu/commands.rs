//! Tauri command wrappers for menu operations.
//!
//! Purpose: Thin `#[tauri::command]` shims that delegate to the real
//! implementations in `dynamic.rs`, `localized.rs`, and `accelerators.rs`
//! (differential accelerator updates for Issue #825). Keeps command
//! registration in `lib.rs` simple.
//!
//! @coordinates-with `lib.rs` (registers these commands in `generate_handler!`)

use std::collections::HashMap;

use tauri::AppHandle;

use super::accelerators::apply_accelerator_diff;
use super::dynamic::{update_recent_files_menu, update_recent_workspaces_menu};
use super::localized::create_localized_menu;

/// Update the Open Recent submenu with the given file paths.
#[tauri::command]
pub fn update_recent_files(app: AppHandle, files: Vec<String>) -> Result<(), String> {
    update_recent_files_menu(&app, files).map_err(|e| e.to_string())
}

/// Update the Open Recent Workspace submenu with the given workspace paths.
#[tauri::command]
pub fn update_recent_workspaces(app: AppHandle, workspaces: Vec<String>) -> Result<(), String> {
    update_recent_workspaces_menu(&app, workspaces).map_err(|e| e.to_string())
}

/// Rebuild the application menu with custom keyboard shortcuts.
/// The shortcuts map is: menu_item_id -> accelerator_string (e.g., "bold" -> "CmdOrCtrl+B")
///
/// Use this for label-changing events (locale switch, Pandoc detect, startup).
/// For pure accelerator edits, prefer `update_menu_accelerators` — it skips the
/// full rebuild and only touches the items whose bindings actually changed.
#[tauri::command]
pub fn rebuild_menu(app: AppHandle, shortcuts: HashMap<String, String>) -> Result<(), String> {
    // create_localized_menu calls accelerators::begin_rebuild() up-front and
    // records every applied accelerator into the cache, so we don't seed here.
    let menu = create_localized_menu(&app, Some(&shortcuts)).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    crate::macos_menu::apply_menu_fixes(&app);

    Ok(())
}

/// Update only the accelerators that changed since the last rebuild or diff.
/// The shortcuts map is the same shape as `rebuild_menu`'s: menu_item_id ->
/// accelerator_string (empty string clears the accelerator).
///
/// This path avoids rebuilding the full menu tree (~130 MenuItems + submenus,
/// ~150 main-thread hops total) which on Windows takes long enough to freeze
/// the Settings window (Issue #825). A single shortcut edit costs one
/// main-thread hop once the item cache is warm.
#[tauri::command]
pub fn update_menu_accelerators(
    app: AppHandle,
    shortcuts: HashMap<String, String>,
) -> Result<(), String> {
    apply_accelerator_diff(&app, &shortcuts).map(|_| ())
}
