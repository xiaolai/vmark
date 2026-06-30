//! Reverse menu-state sync for the View editor-mode group (#1070).
//!
//! Purpose: keep the native View menu's checkmarks and enabled-state in sync
//! with the frontend's editor mode. The mode trio (`wysiwyg-mode` /
//! `source-mode` / `markdown-split`) renders as a checkmark radio group; only
//! the active one is checked. `word-wrap` / `line-numbers` are disabled when
//! they have no effect (the focused surface is not a CodeMirror source view).
//!
//! Mirrors `accelerators.rs`: the frontend pushes the desired state via the
//! `sync_view_menu_state` command, we walk the live menu tree and set
//! checked/enabled in place. A coarse one-state cache skips redundant work —
//! the group is only ~5 items, so applying all setters on an actual change is
//! a handful of main-thread hops, far cheaper than a per-item diff and much
//! simpler. The policy (what is checked/enabled for a given mode) lives in the
//! frontend; this module only maps three booleans onto specific menu ids.
//!
//! @coordinates-with accelerators.rs — shares `collect_items_from_menu`
//! @coordinates-with src/hooks/useViewMenuStateSync.ts — sole caller
//! @coordinates-with src/stores/selectSourceEditing.ts — `selectEditorMode`

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::MenuItemKind;
use tauri::{AppHandle, Wry};

use super::accelerators::collect_items_from_menu;

/// The desired View-menu state, as pushed from the frontend.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct ViewMenuState {
    /// Active editor mode: "wysiwyg" | "source" | "split".
    mode: String,
    /// Whether the WYSIWYG/Source/Split trio applies to the focused tab
    /// (markdown only). When false the trio is disabled.
    mode_applies: bool,
    /// Whether Word Wrap applies (a CodeMirror source surface is active).
    word_wrap_applies: bool,
    /// Whether Line Numbers applies. Kept separate from word-wrap because in
    /// markdown WYSIWYG it still drives code-block gutters (#1082).
    line_numbers_applies: bool,
}

static MENU_STATE_CACHE: Mutex<Option<ViewMenuState>> = Mutex::new(None);

const MODE_IDS: [&str; 3] = ["wysiwyg-mode", "source-mode", "markdown-split"];

/// Pure: which mode id is checked for a given active mode string.
fn mode_checked(id: &str, mode: &str) -> bool {
    matches!(
        (id, mode),
        ("wysiwyg-mode", "wysiwyg") | ("source-mode", "source") | ("markdown-split", "split")
    )
}

/// Pure: the desired `(id, checked, enabled)` triples for the View editor-mode
/// group. `checked` is meaningless for the plain toggle items and is reported
/// as `false`. Unit-tested without a live menu.
pub(crate) fn view_menu_targets(state: &ViewMenuState) -> Vec<(&'static str, bool, bool)> {
    let mut out = Vec::with_capacity(MODE_IDS.len() + 2);
    for id in MODE_IDS {
        out.push((id, state.mode_applies && mode_checked(id, &state.mode), state.mode_applies));
    }
    out.push(("word-wrap", false, state.word_wrap_applies));
    out.push(("line-numbers", false, state.line_numbers_applies));
    out
}

/// Drop the cached state so the next sync always re-applies. Called whenever
/// the menu is rebuilt — the fresh menu carries localized.rs defaults
/// (WYSIWYG checked), so a cache hit would otherwise leave a stale checkmark.
pub(crate) fn invalidate_cache() {
    if let Ok(mut guard) = MENU_STATE_CACHE.lock() {
        *guard = None;
    }
}

fn apply_view_menu_state(app: &AppHandle, state: &ViewMenuState) -> Result<(), String> {
    let menu = app.menu().ok_or_else(|| "No menu".to_string())?;
    let mut index: HashMap<String, MenuItemKind<Wry>> = HashMap::new();
    collect_items_from_menu(&menu, &mut index)?;

    for (id, checked, enabled) in view_menu_targets(state) {
        match index.get(id) {
            Some(MenuItemKind::Check(item)) => {
                item.set_checked(checked).map_err(|e| e.to_string())?;
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
            Some(MenuItemKind::MenuItem(item)) => {
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
            // Id absent (platform branch) or unexpected kind — skip silently,
            // same tolerance as the accelerator updater.
            _ => {}
        }
    }
    Ok(())
}

/// Frontend → Rust: push the desired View editor-mode menu state. Skips the
/// main-thread work entirely when nothing changed since the last call.
///
/// The cache check, apply, and cache update are held under a single lock so
/// two concurrent invocations can't interleave and leave the cache describing
/// a state the menu isn't actually in.
#[tauri::command]
pub fn sync_view_menu_state(
    app: AppHandle,
    mode: String,
    mode_applies: bool,
    word_wrap_applies: bool,
    line_numbers_applies: bool,
) -> Result<(), String> {
    let next = ViewMenuState { mode, mode_applies, word_wrap_applies, line_numbers_applies };

    let mut guard = MENU_STATE_CACHE.lock().map_err(|e| e.to_string())?;
    if guard.as_ref() == Some(&next) {
        return Ok(());
    }
    apply_view_menu_state(&app, &next)?;
    *guard = Some(next);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(mode: &str, mode_applies: bool, word_wrap: bool, line_numbers: bool) -> ViewMenuState {
        ViewMenuState {
            mode: mode.to_string(),
            mode_applies,
            word_wrap_applies: word_wrap,
            line_numbers_applies: line_numbers,
        }
    }

    fn enabled_of(targets: &[(&'static str, bool, bool)], id: &str) -> bool {
        targets.iter().find(|(i, _, _)| *i == id).copied().unwrap().2
    }

    #[test]
    fn checks_only_the_active_mode_when_applicable() {
        let t = view_menu_targets(&state("source", true, true, true));
        let checked: Vec<_> = t.iter().filter(|(_, c, _)| *c).map(|(id, _, _)| *id).collect();
        assert_eq!(checked, vec!["source-mode"]);
    }

    #[test]
    fn wysiwyg_is_the_checked_mode_by_default() {
        let t = view_menu_targets(&state("wysiwyg", true, false, true));
        let checked: Vec<_> = t.iter().filter(|(_, c, _)| *c).map(|(id, _, _)| *id).collect();
        assert_eq!(checked, vec!["wysiwyg-mode"]);
    }

    #[test]
    fn nothing_checked_and_modes_disabled_when_not_applicable() {
        // Non-markdown focused tab: the trio is disabled and unchecked.
        let t = view_menu_targets(&state("source", false, true, true));
        for id in MODE_IDS {
            let (_, checked, enabled) = t.iter().find(|(i, _, _)| *i == id).copied().unwrap();
            assert!(!checked, "{id} must be unchecked when modes don't apply");
            assert!(!enabled, "{id} must be disabled when modes don't apply");
        }
    }

    #[test]
    fn word_wrap_and_line_numbers_track_their_flags_independently() {
        // The #1070/ADR-5 case: markdown WYSIWYG disables word-wrap but keeps
        // line-numbers enabled (code-block gutters until #1082).
        let t = view_menu_targets(&state("wysiwyg", true, false, true));
        assert!(!enabled_of(&t, "word-wrap"), "word-wrap disabled in WYSIWYG");
        assert!(enabled_of(&t, "line-numbers"), "line-numbers stays enabled in WYSIWYG");
    }

    #[test]
    fn both_toggles_disabled_when_no_tab() {
        let t = view_menu_targets(&state("wysiwyg", false, false, false));
        assert!(!enabled_of(&t, "word-wrap"));
        assert!(!enabled_of(&t, "line-numbers"));
    }
}
