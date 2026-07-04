//! Localized menu builder (unified).
//!
//! Purpose: Creates the application menu with localized labels and optional custom keyboard shortcuts. Replaces both `default_menu.rs` and `custom_menu.rs` with
//! a single code path. `create_localized_menu` stays the single public entry
//! point; the per-section construction lives in the `localized/` submodules
//! (`app_menu`, `file_menu`, `edit_menu`, `format_menu`, `insert_menu`,
//! `view_menu`, `window_help_menu`), each receiving the shared `accel`
//! resolver. The Pandoc submenu (in `export_menu`) branches on Pandoc
//! availability: 6 format items when installed, 1 install-CTA item otherwise.
//! A sibling test module in `export_menu` guards the Pandoc menu-ID contract,
//! and `localized.test.rs` pins the default-accelerator and locale-key
//! contracts for the whole menu tree.
//!
//! Also seeds the differential-update baseline: the `accel()` closure records
//! every resolved accelerator into a local snapshot, and the snapshot is
//! committed to `ACCEL_CACHE` (via `accelerators::commit_rebuild`) only after
//! the menu tree is fully built. A construction failure therefore leaves the
//! previous baseline untouched, so the next `update_menu_accelerators` call
//! still diffs against the menu that is actually installed.
//!
//! @coordinates-with `en.yml` (locale strings)
//! @coordinates-with `macos_menu.rs` (applies SF Symbol icons post-build)
//! @coordinates-with `commands.rs` (calls this on rebuild)
//! @coordinates-with `accelerators.rs` (consumes the committed ACCEL_CACHE)

use std::cell::RefCell;
use std::collections::HashMap;

use tauri::menu::Menu;

#[cfg(target_os = "macos")]
mod app_menu;
mod edit_menu;
mod export_menu;
mod file_menu;
mod file_submenus;
mod format_menu;
mod format_submenus;
mod insert_menu;
mod insert_submenus;
mod view_menu;
mod window_help_menu;

/// Accelerator resolver shared by every per-section builder:
/// maps `(menu_item_id, default_accelerator)` to the final accelerator
/// (`None` when the resolved value is empty).
type AccelFn<'a> = dyn Fn(&str, &str) -> Option<String> + 'a;

/// Resolve an accelerator: the custom map wins over the default.
/// Pure so the precedence contract is directly testable.
fn resolve_accelerator<'a>(
    custom_shortcuts: Option<&'a HashMap<String, String>>,
    id: &str,
    default: &'a str,
) -> &'a str {
    custom_shortcuts
        .and_then(|map| map.get(id).map(String::as_str))
        .unwrap_or(default)
}

/// Build the application menu with localized labels and optional custom shortcuts.
///
/// When `custom_shortcuts` is `None`, default accelerators are used (startup path).
/// When `Some`, the map overrides defaults: `menu_item_id -> accelerator_string`.
pub fn create_localized_menu(
    app: &tauri::AppHandle,
    custom_shortcuts: Option<&HashMap<String, String>>,
) -> tauri::Result<Menu<tauri::Wry>> {
    // Drop the menu-state cache before rebuilding so the next sync re-applies
    // the real mode over the fresh menu's default checkmarks (#1070).
    super::menu_state::invalidate_cache();

    // Helper: resolve accelerator from custom map or default (`None` if
    // empty). Every resolved value is recorded into a local snapshot that is
    // committed to the accelerator baseline only after the whole menu tree
    // has been built — a failed build must not corrupt the baseline.
    let applied = RefCell::new(HashMap::new());
    let accel = |id: &str, default: &str| -> Option<String> {
        let value = resolve_accelerator(custom_shortcuts, id, default);
        applied
            .borrow_mut()
            .insert(id.to_string(), value.to_string());
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    };

    #[cfg(target_os = "macos")]
    let app_menu = app_menu::build(app, &accel)?;
    let file_menu = file_menu::build(app, &accel)?;
    let edit_menu = edit_menu::build(app, &accel)?;
    let format_menu = format_menu::build(app, &accel)?;
    let insert_menu = insert_menu::build(app, &accel)?;
    let view_menu = view_menu::build(app, &accel)?;
    #[cfg(target_os = "macos")]
    let window_menu = window_help_menu::build_window_menu(app)?;
    let help_menu = window_help_menu::build_help_menu(app)?;

    // ========================================================================
    // Assemble the menu bar
    // ========================================================================
    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &insert_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        app,
        &[
            &file_menu,
            &edit_menu,
            &format_menu,
            &insert_menu,
            &view_menu,
            &help_menu,
        ],
    )?;

    // The tree is fully built — commit the accelerator baseline atomically.
    // (`set_menu` happens in the callers; a set_menu failure leaves the app
    // without a working menu bar regardless of what the baseline says.)
    super::accelerators::commit_rebuild(applied.into_inner());
    Ok(menu)
}

/// Set the active locale for Rust-side translations.
///
/// After calling this, the next `rebuild_menu` will use the new locale's strings.
/// The frontend is responsible for triggering the menu rebuild.
#[tauri::command]
pub fn set_locale(_app: tauri::AppHandle, locale: String) -> Result<(), String> {
    rust_i18n::set_locale(&locale);
    Ok(())
}

#[cfg(test)]
#[path = "localized.test.rs"]
mod tests;
