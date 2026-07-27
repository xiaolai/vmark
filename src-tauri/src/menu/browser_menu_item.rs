//! Show/hide the "New Browser Tab" native menu item (WI-S0.5).
//!
//! Split from `menu_state.rs` (which owns View-menu check states) because this is a
//! separate concern and it pushed that file past the 300-line gate.
//!
//! **Hidden, not disabled.** The item used to be greyed out while the embedded
//! browser was off, and the code's own comment conceded the problem — "a
//! permanently-dead menu item is worse than no item". A greyed control reads as
//! "not right now"; this one meant "not ever, and nothing here will tell you why",
//! because the enabling toggle sat behind developer mode. Users reported it as a bug.
//!
//! The reason the item is NATIVE rather than a DOM shortcut — once the browser's
//! `WKWebView` is first responder it consumes the key event, and AppKit dispatches
//! menu accelerators regardless of who holds focus — does not argue against hiding.
//! It only matters while a browser tab EXISTS, and none can exist while the feature
//! is off, so hiding in that state costs nothing.
//!
//! Tauri's `MenuItem` exposes `set_enabled` but no `set_visible`, so hiding means
//! REMOVING the item from its submenu and remembering where to put it back.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Wry};

use super::accelerators::collect_items_from_menu;

/// The item id this module moves.
const BROWSER_ITEM_ID: &str = "new-browser-tab";
/// Always present in the File submenu and never conditional — so the parent lookup
/// does not depend on the item being moved. See `file_submenu`.
const FILE_ANCHOR_ID: &str = "new";

/// The removed item and the index to restore it to.
type StashedMenuItem = Option<(MenuItem<Wry>, usize)>;

static HIDDEN_BROWSER_ITEM: OnceLock<Mutex<StashedMenuItem>> = OnceLock::new();

fn hidden_browser_item() -> &'static Mutex<StashedMenuItem> {
    HIDDEN_BROWSER_ITEM.get_or_init(|| Mutex::new(None))
}

/// The DESIRED visibility, independent of any particular menu instance.
///
/// The stash holds a handle into ONE menu tree. `rebuild_menu` (locale switch,
/// shortcut edit) replaces the whole tree, stranding that handle: the fresh menu
/// builds its own `new-browser-tab`, while the stash still claims the item is hidden
/// and points into the discarded tree. Re-inserting it would add a DEAD DUPLICATE
/// beside the live one.
///
/// Nothing re-pushed browser state after a rebuild either — the frontend
/// subscription fires only on CHANGE (`useCommandBootstrap.ts`), so a locale switch
/// silently reverted the item to its built default. That predates this change;
/// tracking the desired state here fixes it too, because
/// `reapply_browser_menu_visibility` can restore it after any rebuild without the
/// frontend's help.
static BROWSER_MENU_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Re-apply the desired visibility to a FRESHLY BUILT menu, discarding any handle
/// into the old one. Call immediately after `set_menu`.
pub fn reapply_browser_menu_visibility(app: &AppHandle) -> Result<(), String> {
    // The stashed handle points into a tree that no longer exists; dropping it is
    // the whole point.
    if let Ok(mut stash) = hidden_browser_item().lock() {
        *stash = None;
    }
    set_browser_menu_enabled(app.clone(), BROWSER_MENU_VISIBLE.load(Ordering::Relaxed))
}

/// Frontend → Rust: SHOW or HIDE the "New Browser Tab" menu item.
#[tauri::command]
pub fn set_browser_menu_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    BROWSER_MENU_VISIBLE.store(enabled, Ordering::Relaxed);

    let menu = app.menu().ok_or_else(|| "No menu".to_string())?;
    let mut index: HashMap<String, MenuItemKind<Wry>> = HashMap::new();
    collect_items_from_menu(&menu, &mut index)?;
    let mut stash = hidden_browser_item().lock().map_err(|e| e.to_string())?;

    if enabled {
        // Put it back exactly where it was, so File-menu order is preserved.
        //
        // `take()` only AFTER the insert succeeds. Taking first lost the item
        // forever on any failure — and there WAS a failure: the original
        // `file_submenu` searched for the browser item itself, which is precisely
        // what had just been removed, so the parent was never found and the item
        // never came back.
        if let Some((item, position)) = stash.as_ref() {
            if let Some(parent) = file_submenu(&menu)? {
                parent.insert(item, *position).map_err(|e| e.to_string())?;
                item.set_enabled(true).map_err(|e| e.to_string())?;
                *stash = None;
            }
        } else if let Some(MenuItemKind::MenuItem(item)) = index.get(BROWSER_ITEM_ID) {
            // Already present (first call, or a rebuild re-created it) — just enable.
            item.set_enabled(true).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // Hide: remove and remember. A second disable has nothing left to remove, and a
    // platform branch that does not build the item is equally fine.
    if stash.is_some() {
        return Ok(());
    }
    if let Some(MenuItemKind::MenuItem(item)) = index.get(BROWSER_ITEM_ID) {
        if let Some(parent) = file_submenu(&menu)? {
            if let Some(position) = submenu_index_of(&parent, BROWSER_ITEM_ID)? {
                parent.remove(item).map_err(|e| e.to_string())?;
                *stash = Some((item.clone(), position));
            }
        }
    }
    Ok(())
}

/// The submenu that owns the browser item, identified by an anchor ALWAYS present
/// in it.
///
/// The first version searched for the browser item itself — which works while it is
/// there and fails at exactly the moment it is needed, because hiding removes it.
/// Anchoring on `new` (File → New, never conditional) makes the lookup independent
/// of the thing being moved. Titles are deliberately not used: they are localized.
fn file_submenu(menu: &Menu<Wry>) -> Result<Option<Submenu<Wry>>, String> {
    for kind in menu.items().map_err(|e| e.to_string())? {
        if let MenuItemKind::Submenu(sub) = kind {
            if submenu_index_of(&sub, FILE_ANCHOR_ID)?.is_some() {
                return Ok(Some(sub));
            }
        }
    }
    Ok(None)
}

/// Position of `id` within `sub`, or `None` when absent.
fn submenu_index_of(sub: &Submenu<Wry>, id: &str) -> Result<Option<usize>, String> {
    for (position, kind) in sub.items().map_err(|e| e.to_string())?.iter().enumerate() {
        if kind.id().as_ref() == id {
            return Ok(Some(position));
        }
    }
    Ok(None)
}

/// Menu item ids in the File submenu (debug builds only).
///
/// Exists because the hide/show above is otherwise unverifiable from outside the
/// process — a claim that the item is gone could not be checked. It earned itself
/// immediately: the first run showed the item hiding correctly and never coming
/// back, which is how the `file_submenu` bug above was found.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_file_menu_item_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let menu = app.menu().ok_or_else(|| "No menu".to_string())?;
    for kind in menu.items().map_err(|e| e.to_string())? {
        if let MenuItemKind::Submenu(sub) = kind {
            let ids: Vec<String> = sub
                .items()
                .map_err(|e| e.to_string())?
                .iter()
                .map(|k| k.id().as_ref().to_string())
                .collect();
            if ids.iter().any(|id| id == FILE_ANCHOR_ID) {
                return Ok(ids);
            }
        }
    }
    Ok(Vec::new())
}
