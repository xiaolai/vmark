//! Tauri command wrappers for menu operations.
//!
//! Purpose: Thin `#[tauri::command]` shims that delegate to the real
//! implementations in `dynamic.rs`, `localized.rs`, `accelerators.rs`
//! (differential accelerator updates for Issue #825), and `browser_menu_item.rs`.
//! Keeps command registration in `lib.rs` simple.
//!
//! `rebuild_menu` is not purely a shim: it must re-apply browser-item visibility
//! after `set_menu`, because a rebuild replaces the tree and strands any handle
//! into the old one.
//!
//! Key decisions:
//!
//! - **Error contract (WI-DP2.4).** These commands return
//!   `Result<T, CommandError>` (rule 50 §10). Menu-tree work — building a tree,
//!   attaching it, walking it, re-applying visibility — is `internal`: the
//!   caller neither caused it nor can act on it.
//!
//! - **`internal` here is a decision, not a default.** `update_menu_accelerators`
//!   passes a caller-supplied chord map down to `set_accelerator`, which PARSES
//!   those strings, so a malformed shortcut is the user's input and not VMark's
//!   fault. `accelerators::apply_accelerator_diff` therefore classifies that one
//!   case as `invalid-input` (with the menu id and offending chord in `detail`)
//!   and everything else as `internal`. A first pass blanket-mapped the whole
//!   module to `internal` and would have reported "a bad shortcut you typed" as
//!   an internal VMark failure.
//!
//! - **One residual, stated rather than papered over.** `rebuild_menu` resolves
//!   the same caller-supplied chords through `create_localized_menu`, which
//!   returns a flat `tauri::Error`. A parse failure and a genuine platform
//!   failure are indistinguishable at that boundary, so both are `internal`.
//!   Splitting them means typing `create_localized_menu`, which is a larger
//!   change than this work item; until then, a bad chord reaching `rebuild_menu`
//!   is misreported, and that is a known gap rather than a claim of correctness.
//!
//! @coordinates-with `lib.rs` (registers these commands in `generate_handler!`)
//! @coordinates-with `accelerators.rs` (owns the invalid-chord classification)

use std::collections::HashMap;

use tauri::AppHandle;

use crate::command_error::CommandError;

use super::accelerators::apply_accelerator_diff;
use super::dynamic::{update_recent_files_menu, update_recent_workspaces_menu};
use super::localized::create_localized_menu;

/// Update the Open Recent submenu with the given file paths.
#[tauri::command]
pub fn update_recent_files(app: AppHandle, files: Vec<String>) -> Result<(), CommandError> {
    update_recent_files_menu(&app, files).map_err(|e| CommandError::internal(e.to_string()))
}

/// Update the Open Recent Workspace submenu with the given workspace paths.
#[tauri::command]
pub fn update_recent_workspaces(
    app: AppHandle,
    workspaces: Vec<String>,
) -> Result<(), CommandError> {
    update_recent_workspaces_menu(&app, workspaces)
        .map_err(|e| CommandError::internal(e.to_string()))
}

/// Rebuild the application menu with custom keyboard shortcuts.
/// The shortcuts map is: menu_item_id -> accelerator_string (e.g., "bold" -> "CmdOrCtrl+B")
///
/// Use this for label-changing events (locale switch, Pandoc detect, startup).
/// For pure accelerator edits, prefer `update_menu_accelerators` — it skips the
/// full rebuild and only touches the items whose bindings actually changed.
#[tauri::command]
pub fn rebuild_menu(
    app: AppHandle,
    shortcuts: HashMap<String, String>,
) -> Result<(), CommandError> {
    // create_localized_menu commits the full accelerator snapshot to the
    // cache once the menu tree is built, so we don't seed anything here.
    let menu = create_localized_menu(&app, Some(&shortcuts))
        .map_err(|e| CommandError::internal(e.to_string()))?;
    app.set_menu(menu)
        .map_err(|e| CommandError::internal(e.to_string()))?;
    // The fresh tree has its own `new-browser-tab`, built to its default state, and
    // any stashed handle now points into the discarded tree. Re-apply the desired
    // visibility and drop the stale handle — otherwise a locale switch either
    // resurrects a hidden item or leaves a dead duplicate to be inserted later.
    super::browser_menu_item::reapply_browser_menu_visibility(&app)
        .map_err(CommandError::internal)?;

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
) -> Result<(), CommandError> {
    apply_accelerator_diff(&app, &shortcuts).map(|_| ())
}
