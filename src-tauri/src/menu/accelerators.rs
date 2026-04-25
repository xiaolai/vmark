//! Differential accelerator updates.
//!
//! Purpose: Mutate only the accelerators that actually changed, instead of
//! rebuilding the entire menu tree. Each `MenuItem::set_accelerator` is one
//! main-thread hop, so changing one shortcut costs ~1 hop instead of the
//! ~150 hops a full rebuild requires. On Windows the difference is the
//! ~150 ms UI-thread stall that made the Settings window freeze (Issue #825).
//!
//! Backed by one cache: `ACCEL_CACHE` — the last-applied accelerator per
//! menu-id. Seeded automatically by the `accel()` closure inside
//! `create_localized_menu`, so both startup and rebuild paths leave the
//! baseline in a correct state. Call `begin_rebuild()` before constructing
//! the menu to clear stale entries.
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
//! @coordinates-with `localized.rs` (records each applied accelerator)
//! @coordinates-with `src/stores/shortcutsStore.ts` (calls the differential path)

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Wry};

static ACCEL_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Reset the accelerator baseline at the start of a full menu rebuild.
/// `record_applied` will repopulate it as the menu is constructed.
pub fn begin_rebuild() {
    if let Ok(mut a) = ACCEL_CACHE.lock() {
        *a = Some(HashMap::new());
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
    let menu = app.menu().ok_or_else(|| "No menu".to_string())?;
    let mut items: HashMap<String, MenuItem<Wry>> = HashMap::new();
    collect_items_from_menu(&menu, &mut items)?;

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
        // next diff retries this id. A miss means the frontend tracks an id
        // the menu doesn't expose on this platform — harmless.
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
pub(crate) fn clear_state_for_test() {
    if let Ok(mut a) = ACCEL_CACHE.lock() {
        *a = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Cache-lifecycle tests share the module-scoped `ACCEL_CACHE`, so they
    /// must not run in parallel with each other. Acquire this lock at the
    /// start of any test that mutates or observes `ACCEL_CACHE`.
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
    // These poke the module-scoped `ACCEL_CACHE`. They must serialize via
    // STATIC_CACHE_LOCK and clear state before each run; otherwise parallel
    // `cargo test` scheduling would cross-contaminate them.

    #[test]
    fn begin_rebuild_clears_accel_cache() {
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
}
