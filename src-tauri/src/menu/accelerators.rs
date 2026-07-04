//! Differential accelerator updates.
//!
//! Purpose: Mutate only the accelerators that actually changed, instead of
//! rebuilding the entire menu tree. Each `MenuItem::set_accelerator` is one
//! main-thread hop, so changing one shortcut costs ~1 hop instead of the
//! ~150 hops a full rebuild requires. On Windows the difference is the
//! ~150 ms UI-thread stall that made the Settings window freeze (Issue #825).
//!
//! Backed by one cache: `ACCEL_CACHE` — the last-applied accelerator per
//! menu-id. `create_localized_menu` collects every resolved accelerator into
//! a local snapshot while it builds and calls `commit_rebuild()` only after
//! the menu tree is fully constructed, so a failed rebuild leaves the
//! previous baseline intact instead of a partial, lying one.
//!
//! `MenuItem<Wry>` handles are looked up by walking the live menu tree on
//! every diff call. The walk is ~30 main-thread hops; combined with the
//! frontend's 100 ms debounce that's still imperceptible. Caching the
//! handles in a `static` was tried first but pulled muda's Windows menu
//! drop-glue into the lib-test binary's import table, which the windows-
//! latest runner couldn't resolve (STATUS_ENTRYPOINT_NOT_FOUND, same DLL-
//! loader failure mode `tauri/test` was scoped out of Windows for in
//! commit cd5f7669). Walking fresh keeps that surface out of the binary.
//!
//! @coordinates-with `commands.rs` (exposes `update_menu_accelerators`)
//! @coordinates-with `localized.rs` (commits the accelerator snapshot post-build)
//! @coordinates-with `src/stores/shortcutsStore.ts` (calls the differential path)

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItemKind, Submenu};
use tauri::{AppHandle, Wry};

static ACCEL_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Atomically replace the accelerator baseline with a fully-built snapshot.
///
/// Called by `create_localized_menu` only after the entire menu tree has
/// been constructed successfully. Never called during construction: if a
/// section builder fails, the previous baseline stays intact instead of
/// being left half-repopulated for a menu that was never installed.
pub fn commit_rebuild(snapshot: HashMap<String, String>) {
    if let Ok(mut a) = ACCEL_CACHE.lock() {
        *a = Some(snapshot);
    }
}

/// Pure diff of two accelerator maps.
/// Returns the subset of `next` whose accelerator differs from `current`
/// (including keys absent from `current`). Keys present only in `current`
/// are ignored — they are not tracked by the frontend shortcut store.
pub fn diff_accelerators(
    current: &HashMap<String, String>,
    next: &HashMap<String, String>,
) -> Vec<(String, String)> {
    let mut changes: Vec<(String, String)> = next
        .iter()
        .filter_map(|(id, accel)| {
            let is_changed = current.get(id).map(|cur| cur != accel).unwrap_or(true);
            if is_changed {
                Some((id.clone(), accel.clone()))
            } else {
                None
            }
        })
        .collect();
    // Stable ordering for deterministic tests and predictable main-thread hops.
    changes.sort_by(|a, b| a.0.cmp(&b.0));
    changes
}

/// Apply a diff of accelerators against the cached baseline. Returns the IDs
/// that were actually mutated. Items whose ID is not present in the live menu
/// are silently skipped (they may belong to a platform-specific branch the
/// caller doesn't know about).
pub fn apply_accelerator_diff(
    app: &AppHandle,
    next: &HashMap<String, String>,
) -> Result<Vec<String>, String> {
    let menu = app.menu().ok_or_else(|| "No menu".to_string())?;
    let mut items: HashMap<String, MenuItemKind<Wry>> = HashMap::new();
    collect_items_from_menu(&menu, &mut items)?;

    let mut accel_guard = ACCEL_CACHE.lock().map_err(|e| e.to_string())?;
    let baseline = accel_guard.get_or_insert_with(HashMap::new);
    let changes = diff_accelerators(baseline, next);

    let mut applied = Vec::with_capacity(changes.len());
    for (id, accel) in changes {
        if let Some(kind) = items.get(&id) {
            let accel_opt: Option<&str> = if accel.is_empty() { None } else { Some(&accel) };
            // Both plain and checkmarked items carry accelerators; the View
            // editor-mode trio (#1070) became CheckMenuItem, so we must reach
            // Check items too or their F6 / Shift+F6 would stop updating.
            match kind {
                MenuItemKind::MenuItem(item) => {
                    item.set_accelerator(accel_opt).map_err(|e| e.to_string())?
                }
                MenuItemKind::Check(item) => {
                    item.set_accelerator(accel_opt).map_err(|e| e.to_string())?
                }
                _ => continue,
            }
            baseline.insert(id.clone(), accel);
            applied.push(id);
        }
        // If the lookup missed, deliberately skip the baseline update so the
        // next diff retries this id. A miss means the frontend tracks an id
        // the menu doesn't expose on this platform — harmless.
    }
    Ok(applied)
}

/// Walk the live menu tree into an id→kind index. Shared with `menu_state`
/// (the View editor-mode checked/enabled sync) so the tree is walked the same
/// way; see this module's header for why handles are looked up fresh.
pub(crate) fn collect_items_from_menu(
    menu: &Menu<Wry>,
    index: &mut HashMap<String, MenuItemKind<Wry>>,
) -> Result<(), String> {
    for kind in menu.items().map_err(|e| e.to_string())? {
        collect_kind(kind, index)?;
    }
    Ok(())
}

fn collect_from_submenu(
    sub: &Submenu<Wry>,
    index: &mut HashMap<String, MenuItemKind<Wry>>,
) -> Result<(), String> {
    for kind in sub.items().map_err(|e| e.to_string())? {
        collect_kind(kind, index)?;
    }
    Ok(())
}

fn collect_kind(
    kind: MenuItemKind<Wry>,
    index: &mut HashMap<String, MenuItemKind<Wry>>,
) -> Result<(), String> {
    match kind {
        MenuItemKind::MenuItem(ref item) => {
            let id = item.id().0.as_str().to_string();
            index.insert(id, kind);
        }
        // Checkmarked items (e.g. the View editor-mode trio) also carry
        // accelerators and must be indexed so shortcut edits reach them.
        MenuItemKind::Check(ref item) => {
            let id = item.id().0.as_str().to_string();
            index.insert(id, kind);
        }
        MenuItemKind::Submenu(sub) => {
            collect_from_submenu(&sub, index)?;
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn accel_cache_snapshot_for_test() -> Option<HashMap<String, String>> {
    ACCEL_CACHE.lock().ok().and_then(|g| g.clone())
}

#[cfg(test)]
pub(crate) fn clear_state_for_test() {
    if let Ok(mut a) = ACCEL_CACHE.lock() {
        *a = None;
    }
}

#[cfg(test)]
#[path = "accelerators.test.rs"]
mod tests;
