//! Tauri command wrappers for menu operations.
//!
//! Purpose: Thin `#[tauri::command]` shims that delegate to the real implementations
//! in `dynamic.rs` and `custom_menu.rs`. Keeps command registration in `lib.rs` simple.
//!
//! @coordinates-with `lib.rs` (registers these commands in `generate_handler!`)

use std::collections::HashMap;

use tauri::AppHandle;

use super::custom_menu::create_menu_with_shortcuts;
use super::dynamic::{update_recent_files_menu, update_recent_workspaces_menu};

#[tauri::command]
pub fn update_recent_files(app: AppHandle, files: Vec<String>) -> Result<(), String> {
    update_recent_files_menu(&app, files).map_err(|e| e.to_string())
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
