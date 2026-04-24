//! Differential accelerator updates.
//!
//! Purpose: Mutate only the accelerators that actually changed, instead of
//! rebuilding the entire menu tree. Each `MenuItem::set_accelerator` is one
//! main-thread hop, so changing one shortcut costs ~1 hop instead of the
//! ~150 hops a full rebuild requires. On Windows the difference is the
//! ~150 ms UI-thread stall that made the Settings window freeze (Issue #825).
//!
//! Two caches back the diff:
//!   - `ACCEL_CACHE`: last-applied accelerator per menu-id. Seeded automatically
//!     by the `accel()` closure inside `create_localized_menu` — every call to
//!     the closure records the resolved value here, so both startup and
//!     rebuild paths leave the cache in a correct state. Call
//!     `begin_rebuild()` before constructing the menu to clear stale entries.
//!   - `ITEM_CACHE`: menu-id -> `MenuItem<Wry>` index, built lazily by walking
//!     the menu tree on the first differential call after a rebuild. `MenuItem`
//!     is an `Arc` wrapper, so cloning is cheap; reusing the cache across diff
//!     calls avoids the ~20 main-thread hops a fresh walk costs.
//!
//!     Dynamic submenu rebuilds (genies, recent files/workspaces) that recreate
//!     a cached `MenuItem` must call `invalidate_item_cache()` — the cached
//!     Arc still exists but is no longer attached to the live muda menu, so
//!     `set_accelerator` on the stale handle has no visible effect.
//!
//! @coordinates-with `commands.rs` (exposes `update_menu_accelerators`)
//! @coordinates-with `localized.rs` (records each applied accelerator)
//! @coordinates-with `dynamic.rs` (invalidates on genies rebuild)
//! @coordinates-with `src/stores/shortcutsStore.ts` (calls the differential path)

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Wry};

static ACCEL_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static ITEM_CACHE: Mutex<Option<HashMap<String, MenuItem<Wry>>>> = Mutex::new(None);

/// Reset both caches at the start of a full menu rebuild. `record_applied`
/// will repopulate the accelerator cache as the menu is constructed; the item
/// cache is left empty and rebuilt lazily on the next differential call.
pub fn begin_rebuild() {
    if let Ok(mut a) = ACCEL_CACHE.lock() {
        *a = Some(HashMap::new());
    }
    if let Ok(mut i) = ITEM_CACHE.lock() {
        *i = None;
    }
}

/// Record an accelerator that was just applied to a menu item. Called from
/// inside `create_localized_menu` so the baseline tracks reality regardless of
/// whether the caller passed a custom-shortcuts map.
pub fn record_applied(id: &str, accel: &str) {
    if let Ok(mut guard) = ACCEL_CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(id.to_string(), accel.to_string());
    }
}

/// Drop the `MenuItem` lookup cache. Call this whenever a dynamic submenu
/// rebuild (genies, recent files/workspaces) recreates items whose IDs appear
/// in `ACCEL_CACHE` — the cached Arc is still alive but no longer attached to
/// the live menu, so `set_accelerator` on it would silently have no effect.
/// The accelerator baseline is intentionally preserved: the next diff re-walks
/// and re-binds the new items to their current bindings.
pub fn invalidate_item_cache() {
    if let Ok(mut i) = ITEM_CACHE.lock() {
        *i = None;
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
            let is_changed = current
                .get(id)
                .map(|cur| cur != accel)
                .unwrap_or(true);
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
    let mut item_guard = ITEM_CACHE.lock().map_err(|e| e.to_string())?;
    if item_guard.is_none() {
        let menu = app.menu().ok_or_else(|| "No menu".to_string())?;
        let mut index = HashMap::new();
        collect_items_from_menu(&menu, &mut index)?;
        *item_guard = Some(index);
    }
    let items = item_guard.as_ref().expect("ITEM_CACHE populated above");

    let mut accel_guard = ACCEL_CACHE.lock().map_err(|e| e.to_string())?;
    let baseline = accel_guard.get_or_insert_with(HashMap::new);
    let changes = diff_accelerators(baseline, next);

    let mut applied = Vec::with_capacity(changes.len());
    for (id, accel) in changes {
        if let Some(item) = items.get(&id) {
            let accel_opt: Option<&str> = if accel.is_empty() { None } else { Some(&accel) };
            item.set_accelerator(accel_opt).map_err(|e| e.to_string())?;
            baseline.insert(id.clone(), accel);
            applied.push(id);
        }
        // If the lookup missed, deliberately skip the baseline update so the
        // next diff retries this id. A miss means either (a) the frontend
        // tracks an id the menu doesn't expose on this platform (harmless), or
        // (b) the ITEM_CACHE is stale; the next walk will pick up the new
        // handle and bind it correctly.
    }
    Ok(applied)
}

fn collect_items_from_menu(
    menu: &Menu<Wry>,
    index: &mut HashMap<String, MenuItem<Wry>>,
) -> Result<(), String> {
    for kind in menu.items().map_err(|e| e.to_string())? {
        collect_kind(kind, index)?;
    }
    Ok(())
}

fn collect_from_submenu(
    sub: &Submenu<Wry>,
    index: &mut HashMap<String, MenuItem<Wry>>,
) -> Result<(), String> {
    for kind in sub.items().map_err(|e| e.to_string())? {
        collect_kind(kind, index)?;
    }
    Ok(())
}

fn collect_kind(
    kind: MenuItemKind<Wry>,
    index: &mut HashMap<String, MenuItem<Wry>>,
) -> Result<(), String> {
    match kind {
        MenuItemKind::MenuItem(item) => {
            let id = item.id().0.as_str().to_string();
            index.insert(id, item);
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
pub(crate) fn item_cache_is_populated_for_test() -> bool {
    ITEM_CACHE.lock().ok().map(|g| g.is_some()).unwrap_or(false)
}

#[cfg(test)]
pub(crate) fn clear_state_for_test() {
    if let Ok(mut a) = ACCEL_CACHE.lock() {
        *a = None;
    }
    if let Ok(mut i) = ITEM_CACHE.lock() {
        *i = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Cache-lifecycle tests share the module-scoped static caches, so they
    /// must not run in parallel with each other. Acquire this lock at the
    /// start of any test that mutates or observes `ACCEL_CACHE` / `ITEM_CACHE`.
    static STATIC_CACHE_LOCK: Mutex<()> = Mutex::new(());

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn diff_returns_all_when_current_is_empty() {
        let current = HashMap::new();
        let next = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+I")]);
        let out = diff_accelerators(&current, &next);
        assert_eq!(
            out,
            vec![
                ("bold".into(), "CmdOrCtrl+B".into()),
                ("italic".into(), "CmdOrCtrl+I".into()),
            ]
        );
    }

    #[test]
    fn diff_skips_unchanged_entries() {
        let current = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+I")]);
        let next = current.clone();
        assert!(diff_accelerators(&current, &next).is_empty());
    }

    #[test]
    fn diff_returns_only_changed_entries() {
        let current = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+I")]);
        let next = map(&[("bold", "CmdOrCtrl+B"), ("italic", "CmdOrCtrl+Shift+I")]);
        assert_eq!(
            diff_accelerators(&current, &next),
            vec![("italic".into(), "CmdOrCtrl+Shift+I".into())]
        );
    }

    #[test]
    fn diff_treats_empty_accelerator_as_a_change_and_reports_it() {
        // Empty string means "unbound" at the Rust layer; still a diff-worthy change.
        let current = map(&[("bold", "CmdOrCtrl+B")]);
        let next = map(&[("bold", "")]);
        assert_eq!(
            diff_accelerators(&current, &next),
            vec![("bold".into(), "".into())]
        );
    }

    #[test]
    fn diff_ignores_keys_present_only_in_current() {
        // The frontend might stop tracking an item (e.g., feature removed).
        // We don't try to reset it — we only touch what the caller asks about.
        let current = map(&[("bold", "CmdOrCtrl+B"), ("ghost", "F12")]);
        let next = map(&[("bold", "CmdOrCtrl+B")]);
        assert!(diff_accelerators(&current, &next).is_empty());
    }

    #[test]
    fn diff_is_sorted_for_deterministic_application_order() {
        let current = HashMap::new();
        let next = map(&[("z", "Ctrl+Z"), ("a", "Ctrl+A"), ("m", "Ctrl+M")]);
        let out = diff_accelerators(&current, &next);
        let ids: Vec<&str> = out.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, vec!["a", "m", "z"]);
    }

    // --- Cache-lifecycle tests ------------------------------------------------
    // These poke the module-scoped static caches. They must serialize via
    // STATIC_CACHE_LOCK and clear state before each run; otherwise parallel
    // `cargo test` scheduling would cross-contaminate them.

    #[test]
    fn begin_rebuild_clears_accel_cache_and_item_cache() {
        let _guard = STATIC_CACHE_LOCK.lock().unwrap();
        // Pre-populate to prove begin_rebuild actually clears.
        record_applied("bold", "CmdOrCtrl+B");
        assert_eq!(
            accel_cache_snapshot_for_test().unwrap().get("bold").map(String::as_str),
            Some("CmdOrCtrl+B"),
        );

        begin_rebuild();

        let snap = accel_cache_snapshot_for_test().expect("ACCEL_CACHE is Some after begin_rebuild");
        assert!(snap.is_empty(), "begin_rebuild left stale entries: {:?}", snap);
        assert!(
            !item_cache_is_populated_for_test(),
            "ITEM_CACHE should be None after begin_rebuild",
        );
    }

    #[test]
    fn record_applied_lazily_creates_map_and_overwrites_existing_ids() {
        let _guard = STATIC_CACHE_LOCK.lock().unwrap();
        clear_state_for_test();
        // No begin_rebuild yet — record_applied must still work.
        record_applied("save", "CmdOrCtrl+S");
        record_applied("save", "CmdOrCtrl+Shift+S"); // overwrites
        record_applied("open", "CmdOrCtrl+O");

        let snap = accel_cache_snapshot_for_test().expect("ACCEL_CACHE created on first record");
        assert_eq!(snap.get("save").map(String::as_str), Some("CmdOrCtrl+Shift+S"));
        assert_eq!(snap.get("open").map(String::as_str), Some("CmdOrCtrl+O"));
        assert_eq!(snap.len(), 2);
    }

    #[test]
    fn invalidate_item_cache_drops_item_index_but_preserves_accelerator_baseline() {
        let _guard = STATIC_CACHE_LOCK.lock().unwrap();
        clear_state_for_test();
        record_applied("bold", "CmdOrCtrl+B");
        // Directly seed ITEM_CACHE as if a diff had walked the menu.
        if let Ok(mut i) = ITEM_CACHE.lock() {
            *i = Some(HashMap::new());
        }
        assert!(item_cache_is_populated_for_test());

        invalidate_item_cache();

        assert!(
            !item_cache_is_populated_for_test(),
            "invalidate_item_cache must drop the item index",
        );
        let snap = accel_cache_snapshot_for_test().unwrap();
        assert_eq!(
            snap.get("bold").map(String::as_str),
            Some("CmdOrCtrl+B"),
            "invalidate_item_cache must not touch ACCEL_CACHE — the next diff \
             needs the baseline to detect the post-rebuild drift",
        );
    }
}
