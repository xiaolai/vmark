//! # Application Menu
//!
//! Purpose: Builds the native application menu bar with keyboard accelerators.
//!
//! Pipeline: `lib.rs` setup -> `create_menu()` -> Tauri `app.set_menu()`.
//! When user customizes shortcuts: frontend `rebuild_menu` invoke -> `create_menu_with_shortcuts()`.
//!
//! Key decisions:
//!   - TWO menu creation functions exist: `create_menu` (defaults) and
//!     `create_menu_with_shortcuts` (custom). Both MUST be updated in sync.
//!   - Recent files/workspaces and genies use snapshot Mutexes so menu-click
//!     handlers always resolve the correct path even if the store changed.
//!   - Genies submenu is created dynamically inside Edit (not at build time)
//!     so it can be toggled on/off without rebuilding the entire menu.
//!
//! Known limitations:
//!   - Menu structure is duplicated across macOS and non-macOS variants
//!     due to platform-specific items (App menu, Services, etc.).
//!
//! @coordinates-with `menu_events.rs` (dispatches click events to frontend)
//! @coordinates-with `macos_menu.rs` (applies SF Symbol icons and workarounds)
//! @coordinates-with `lib.rs` (registers Tauri commands and builds initial menu)

mod commands;
mod custom_menu;
mod default_menu;
mod dynamic;

use std::sync::Mutex;

pub const RECENT_FILES_SUBMENU_ID: &str = "recent-files-submenu";
pub const RECENT_WORKSPACES_SUBMENU_ID: &str = "recent-workspaces-submenu";
pub const GENIES_SUBMENU_ID: &str = "genies-submenu";

/// Stores the recent files list snapshot at menu build time.
/// This ensures that when a menu item is clicked, we can look up
/// the correct path even if the store changed since menu creation.
pub(crate) static RECENT_FILES_SNAPSHOT: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Stores the recent workspaces list snapshot at menu build time.
pub(crate) static RECENT_WORKSPACES_SNAPSHOT: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Stores genie file paths for lookup when a genie menu item is clicked.
/// Index corresponds to `genie-item-{index}` menu item IDs.
pub(crate) static GENIES_SNAPSHOT: Mutex<Vec<String>> = Mutex::new(Vec::new());

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

/// Get the file path for a genie by its menu index.
/// Returns None if index is out of bounds.
pub fn get_genie_path(index: usize) -> Option<String> {
    GENIES_SNAPSHOT
        .lock()
        .ok()
        .and_then(|paths| paths.get(index).cloned())
}

// Re-export public items so `menu::create_menu`, `menu::rebuild_menu`, etc. keep working.
// Wildcard re-exports are required for `#[tauri::command]` functions because the macro
// generates hidden items (`__cmd__*`) that `generate_handler!` in `lib.rs` must resolve.
pub use commands::*;
pub use default_menu::create_menu;
pub use dynamic::*;
