//! Native menu items whose presence depends on a setting.
//!
//! **Hidden, not disabled.** An item used to be greyed out while its feature was
//! off, and the code's own comment conceded the problem — "a permanently-dead
//! menu item is worse than no item". A greyed control reads as "not right now";
//! these mean "not ever, and nothing here will tell you why", because the
//! enabling toggle sits behind developer mode. Users reported both as bugs:
//! "New Browser Tab" first (WI-S0.5), then Knowledge Base (#1425), filed as a
//! Linux packaging fault when in truth NO packaged build carries the content
//! server (`content_server::bundle_manifest::BUNDLED_CLI_RESOURCE` is `None`).
//!
//! The second instance is what made this a table rather than a second copy of
//! `browser_menu_item.rs`: the stash-and-restore below is subtle enough that
//! two of its three traps were found by running it, not by reading it (see
//! `set_visible` and `submenu_with_anchor`). One mechanism, one set of traps.
//!
//! Tauri's `MenuItem` exposes `set_enabled` but no `set_visible`, so hiding
//! means REMOVING the item from its submenu and remembering where to put it
//! back.
//!
//! The reason these items are NATIVE rather than DOM shortcuts — once a
//! `WKWebView` is first responder it consumes the key event, while AppKit
//! dispatches menu accelerators regardless of who holds focus — does not argue
//! against hiding: the accelerator is dead either way once the frontend's
//! `when` predicate refuses the command.
//!
//! @coordinates-with `commands.rs` (re-applies after every `rebuild_menu`)
//! @coordinates-with `crate::app_setup` (re-applies after the FIRST `set_menu`)
//! @coordinates-with `src/services/menu/conditionalMenuItemSync.ts` (the pusher)

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Wry};

use crate::command_error::CommandError;

use super::accelerators::collect_items_from_menu;

/// A menu item that is removed when its feature is off.
pub struct ConditionalItem {
    /// The item's menu id — also the id the frontend pushes.
    pub id: &'static str,
    /// An id ALWAYS present in the same submenu, and never itself conditional.
    ///
    /// The parent lookup must not depend on the item being moved: the first
    /// version searched for the browser item itself, which works while it is
    /// there and fails at exactly the moment it is needed, because hiding
    /// removed it. Titles are deliberately not used — they are localized.
    pub anchor: &'static str,
}

/// Every conditional item, with the submenu anchor that locates its parent.
///
/// `new` is File → New and `outline` is View → Outline; neither is conditional,
/// platform-gated or reorderable, which is the whole requirement on an anchor.
pub const CONDITIONAL_ITEMS: &[ConditionalItem] = &[
    ConditionalItem {
        id: "new-browser-tab",
        anchor: "new",
    },
    ConditionalItem {
        id: "knowledge-base",
        anchor: "outline",
    },
];

/// The table entry for `id`, or `None` when nothing declares it conditional.
pub fn conditional_item(id: &str) -> Option<&'static ConditionalItem> {
    CONDITIONAL_ITEMS.iter().find(|item| item.id == id)
}

/// The removed item and the index to restore it to.
type StashedMenuItem = Option<(MenuItem<Wry>, usize)>;

/// Per-item DESIRED visibility plus the handle hiding produced.
///
/// The desired flag is independent of any particular menu instance, and that is
/// load-bearing. The stash holds a handle into ONE menu tree; `rebuild_menu`
/// (locale switch, shortcut edit) replaces the whole tree, stranding it: the
/// fresh menu builds its own item while the stash still claims the item is
/// hidden and points into the discarded tree. Re-inserting that would add a
/// DEAD DUPLICATE beside the live one.
///
/// Nothing re-pushed the desired state after a rebuild either — the frontend
/// subscription fires only on CHANGE — so a locale switch silently reverted
/// every item to its built default. Tracking the desire here fixes that too,
/// because `reapply` can restore it without the frontend's help.
#[derive(Default)]
struct ItemState {
    /// Every conditional item starts HIDDEN: each guards a feature that is off
    /// by default, so the honest initial state is absent, not greyed.
    visible: bool,
    stash: StashedMenuItem,
}

static STATE: OnceLock<Mutex<HashMap<&'static str, ItemState>>> = OnceLock::new();

fn state() -> &'static Mutex<HashMap<&'static str, ItemState>> {
    STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Take the lock, recovering from poisoning.
///
/// The guarded value is a plain map of flags and item handles; a panic partway
/// through an update leaves at worst a stale flag, which the next push
/// corrects. Propagating the poison instead would permanently disable menu
/// visibility for the rest of the session — one panic anywhere and every
/// conditional item freezes in whatever state it happened to be in.
fn items() -> std::sync::MutexGuard<'static, HashMap<&'static str, ItemState>> {
    state().lock().unwrap_or_else(|p| p.into_inner())
}

/// Re-apply every desired visibility to a FRESHLY BUILT menu, discarding any
/// handle into the old one. Call immediately after `set_menu` — including the
/// first one in `app_setup`, or an item whose feature is off is merely greyed
/// until the frontend's first push lands (and stays greyed for the session if
/// it never does).
pub fn reapply(app: &AppHandle) -> Result<(), String> {
    let desired: Vec<(&'static str, bool)> = {
        let mut state = items();
        CONDITIONAL_ITEMS
            .iter()
            .map(|item| {
                let entry = state.entry(item.id).or_default();
                // The stashed handle points into a tree that no longer exists;
                // dropping it is the whole point.
                entry.stash = None;
                (item.id, entry.visible)
            })
            .collect()
    };
    // EVERY item is applied, then the first failure is reported. Returning on
    // the first one would let a fault in one feature's item leave another
    // feature's item in the state the discarded tree built it with — and the
    // two have nothing to do with each other.
    let mut failure: Option<String> = None;
    for (id, visible) in desired {
        if let Err(e) = set_visible(app, id, visible) {
            log::warn!("[menu] could not apply visibility for {id:?}: {e}");
            failure.get_or_insert(e);
        }
    }
    match failure {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Frontend → Rust: SHOW or HIDE a conditional menu item.
///
/// An id the table does not declare is `invalid-input`, not a silent no-op: it
/// is a caller bug — a typo, or an item someone forgot to register — and
/// swallowing it would leave the pusher reporting success for an item that
/// never moves.
#[tauri::command]
pub fn set_menu_item_visible(
    app: AppHandle,
    item_id: String,
    visible: bool,
) -> Result<(), CommandError> {
    let item = conditional_item(&item_id).ok_or_else(|| {
        CommandError::invalid_input(format!("{item_id:?} is not a conditional menu item"))
    })?;
    set_visible(&app, item.id, visible).map_err(CommandError::internal)
}

/// The mechanism, over a table id that has already been validated.
fn set_visible(app: &AppHandle, id: &'static str, visible: bool) -> Result<(), String> {
    let anchor = conditional_item(id)
        .ok_or_else(|| format!("unknown menu item {id:?}"))?
        .anchor;

    let menu = app.menu().ok_or_else(|| "No menu".to_string())?;
    let mut index: HashMap<String, MenuItemKind<Wry>> = HashMap::new();
    collect_items_from_menu(&menu, &mut index)?;
    let mut state = items();
    let entry = state.entry(id).or_default();
    entry.visible = visible;

    if visible {
        // Put it back exactly where it was, so submenu order is preserved.
        //
        // `take()` only AFTER the insert succeeds. Taking first lost the item
        // forever on any failure — and there WAS a failure: the original parent
        // lookup searched for the conditional item itself, which is precisely
        // what had just been removed.
        if let Some((item, position)) = entry.stash.as_ref() {
            if let Some(parent) = submenu_with_anchor(&menu, anchor)? {
                parent.insert(item, *position).map_err(|e| e.to_string())?;
                item.set_enabled(true).map_err(|e| e.to_string())?;
                entry.stash = None;
            }
        } else if let Some(MenuItemKind::MenuItem(item)) = index.get(id) {
            // Already present (first call, or a rebuild re-created it) — the
            // built item is disabled, so enabling is what makes it live.
            item.set_enabled(true).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // Hide: remove and remember. A second hide has nothing left to remove, and a
    // platform branch that does not build the item is equally fine.
    if entry.stash.is_some() {
        return Ok(());
    }
    if let Some(MenuItemKind::MenuItem(item)) = index.get(id) {
        if let Some(parent) = submenu_with_anchor(&menu, anchor)? {
            if let Some(position) = submenu_index_of(&parent, id)? {
                parent.remove(item).map_err(|e| e.to_string())?;
                entry.stash = Some((item.clone(), position));
            }
        }
    }
    Ok(())
}

/// The submenu identified by an anchor id always present in it.
fn submenu_with_anchor(menu: &Menu<Wry>, anchor: &str) -> Result<Option<Submenu<Wry>>, String> {
    for kind in menu.items().map_err(|e| e.to_string())? {
        if let MenuItemKind::Submenu(sub) = kind {
            if submenu_index_of(&sub, anchor)?.is_some() {
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

/// Menu item ids in the submenu holding `anchor_id` (debug builds only).
///
/// Exists because the hide/show above is otherwise unverifiable from outside the
/// process — a claim that an item is gone could not be checked. It earned itself
/// immediately: the first run showed the browser item hiding correctly and never
/// coming back, which is how the parent-lookup bug above was found.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_submenu_item_ids(
    app: AppHandle,
    anchor_id: String,
) -> Result<Vec<String>, CommandError> {
    let menu = app
        .menu()
        .ok_or_else(|| CommandError::internal("No menu"))?;
    for kind in menu
        .items()
        .map_err(|e| CommandError::internal(e.to_string()))?
    {
        if let MenuItemKind::Submenu(sub) = kind {
            let ids: Vec<String> = sub
                .items()
                .map_err(|e| CommandError::internal(e.to_string()))?
                .iter()
                .map(|k| k.id().as_ref().to_string())
                .collect();
            if ids.contains(&anchor_id) {
                return Ok(ids);
            }
        }
    }
    Ok(Vec::new())
}

#[cfg(test)]
#[path = "conditional_items.test.rs"]
mod tests;
