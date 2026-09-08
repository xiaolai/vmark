//! WI-FL5.9 — the SF Symbol icon table and the positional Help/Window lookup,
//! pinned without AppKit.
//!
//! `apply_menu_icons` resolves icons by menu ID through `record_leaf_icon`,
//! so "an item without an icon" is observable as an ID the title→icon map
//! never receives. `fix_help_menu` / `fix_window_menu` take the LAST and
//! SECOND-TO-LAST top-level menus, which is only right while the builder
//! appends Window then Help. Both premises are checked against the real
//! builder sources (`include_str!`), the way `guards.test.rs` and
//! `localized.test.rs` already do. The module is `#[cfg(target_os = "macos")]`
//! in `lib.rs`, so this file only ever compiles there.

use super::icons::{MENU_ICONS, PREDEFINED_ICONS};
use super::{fallback_for_submenu_id, icon_for_id, icon_for_predefined_title, record_leaf_icon};
use crate::menu::{GENIES_SUBMENU_ID, RECENT_FILES_SUBMENU_ID, RECENT_WORKSPACES_SUBMENU_ID};
use std::collections::{BTreeSet, HashMap};
use std::ops::Range;

/// The per-section builders of the localized menu. Cross-checked against
/// `localized.rs`'s `mod` declarations below so a new section cannot be left
/// out of the join silently.
const LOCALIZED_SOURCES: &[(&str, &str)] = &[
    ("app_menu", include_str!("menu/localized/app_menu.rs")),
    ("edit_menu", include_str!("menu/localized/edit_menu.rs")),
    ("export_menu", include_str!("menu/localized/export_menu.rs")),
    ("file_menu", include_str!("menu/localized/file_menu.rs")),
    (
        "file_submenus",
        include_str!("menu/localized/file_submenus.rs"),
    ),
    ("format_menu", include_str!("menu/localized/format_menu.rs")),
    (
        "format_submenus",
        include_str!("menu/localized/format_submenus.rs"),
    ),
    ("insert_menu", include_str!("menu/localized/insert_menu.rs")),
    (
        "insert_submenus",
        include_str!("menu/localized/insert_submenus.rs"),
    ),
    ("view_menu", include_str!("menu/localized/view_menu.rs")),
    (
        "window_help_menu",
        include_str!("menu/localized/window_help_menu.rs"),
    ),
];
const LOCALIZED_ROOT: &str = include_str!("menu/localized.rs");
/// The dynamic submenus (recent files, recent workspaces, genies): their
/// structural items carry literal IDs; per-entry items are built at runtime
/// and rely on `fallback_for_submenu_id`.
const DYNAMIC: &str = include_str!("menu/dynamic.rs");

/// Leaf items with no table row ON PURPOSE: the "(No recent …)" placeholders
/// are inserted INTO the recent-files / recent-workspaces submenus, so they
/// take those submenus' fallback icons (`doc` / `folder`).
const FALLBACK_COVERED: &[&str] = &["no-recent", "no-recent-workspace"];

// ── source scanning ─────────────────────────────────────────────────────────

/// Does this `#[cfg(...)]` attribute remove its item from the macOS build?
fn cfg_excludes_macos(cfg: &str) -> bool {
    let positive = |os: &str| {
        let key = format!("target_os = \"{os}\"");
        cfg.contains(&key) && !cfg.contains(&format!("not({key})"))
    };
    positive("windows") || positive("linux") || cfg.contains("not(target_os = \"macos\")")
}

fn matching_brace(source: &str, open: usize) -> usize {
    let mut depth = 0usize;
    for (i, b) in source.bytes().enumerate().skip(open) {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return i;
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced braces after byte {open}");
}

/// Byte ranges of `#[cfg(...)]` + `{ … }` blocks that are cfg'd off macOS.
fn excluded_block_ranges(source: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut offset = 0usize;
    let mut pending_cfg: Option<String> = None;
    for line in source.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed.starts_with("#[cfg(") {
            pending_cfg = Some(trimmed.to_string());
        } else if trimmed == "{" {
            if let Some(cfg) = pending_cfg.take() {
                if cfg_excludes_macos(&cfg) {
                    let open = offset + line.find('{').expect("brace on this line");
                    ranges.push(open..matching_brace(source, open));
                }
            }
        } else if !trimmed.is_empty() {
            pending_cfg = None;
        }
        offset += line.len();
    }
    ranges
}

/// The literal second argument of the call whose argument list starts at
/// `args_start`, or `None` when the ID is computed at runtime (`&item_id`).
fn literal_id_at(source: &str, args_start: usize) -> Option<String> {
    let rest = &source[args_start..];
    let mut depth = 1usize;
    let mut end = rest.len();
    for (i, b) in rest.bytes().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    end = i;
                    break;
                }
            }
            _ => {}
        }
    }
    let second = rest[..end].split(',').nth(1)?.trim();
    let literal = second.strip_prefix('"')?;
    Some(literal[..literal.find('"')?].to_string())
}

/// Every literal ID passed to `MenuItem::with_id` / `CheckMenuItem::with_id`
/// in `source` that survives on macOS.
fn static_leaf_ids(source: &str) -> BTreeSet<String> {
    let excluded = excluded_block_ranges(source);
    let mut ids = BTreeSet::new();
    for (pos, _) in source.match_indices("with_id(") {
        if excluded.iter().any(|r| r.contains(&pos)) {
            continue;
        }
        let line_start = source[..pos].rfind('\n').map_or(0, |i| i + 1);
        let previous = source[..line_start]
            .trim_end()
            .lines()
            .last()
            .unwrap_or("")
            .trim();
        if previous.starts_with("#[cfg(") && cfg_excludes_macos(previous) {
            continue;
        }
        if let Some(id) = literal_id_at(source, pos + "with_id(".len()) {
            ids.insert(id);
        }
    }
    ids
}

/// Every literal submenu ID (`Submenu::with_id_and_items`) in `source`.
fn submenu_ids(source: &str) -> BTreeSet<String> {
    source
        .match_indices("with_id_and_items(")
        .filter_map(|(pos, _)| literal_id_at(source, pos + "with_id_and_items(".len()))
        .collect()
}

fn all_leaf_ids() -> BTreeSet<String> {
    let mut ids: BTreeSet<String> = LOCALIZED_SOURCES
        .iter()
        .flat_map(|(_, source)| static_leaf_ids(source))
        .collect();
    ids.extend(static_leaf_ids(DYNAMIC));
    ids
}

fn table_ids() -> BTreeSet<&'static str> {
    MENU_ICONS.iter().map(|(id, _)| *id).collect()
}

// ── the lookup functions ────────────────────────────────────────────────────

#[test]
fn icon_for_id_resolves_a_mapped_leaf_and_rejects_an_unknown_one() {
    assert_eq!(icon_for_id("save"), Some("arrow.down.doc"));
    assert_eq!(icon_for_id("no-such-item"), None);
}

#[test]
fn record_leaf_icon_leaves_an_unmapped_item_without_an_icon() {
    let mut map = HashMap::new();
    record_leaf_icon(&mut map, "no-such-item", Ok("Whatever".to_string()), None);
    assert!(
        map.is_empty(),
        "an unmapped item must not receive an icon: {map:?}"
    );
}

#[test]
fn record_leaf_icon_falls_back_to_the_submenu_icon_for_dynamic_items() {
    let mut map = HashMap::new();
    record_leaf_icon(
        &mut map,
        "recent-file-3",
        Ok("notes.md".to_string()),
        Some("doc"),
    );
    assert_eq!(map.get("notes.md"), Some(&"doc"));
}

#[test]
fn an_items_own_icon_beats_the_submenu_fallback() {
    let mut map = HashMap::new();
    record_leaf_icon(
        &mut map,
        "clear-recent",
        Ok("Clear Menu".to_string()),
        Some("doc"),
    );
    assert_eq!(map.get("Clear Menu"), Some(&"trash"));
}

#[test]
fn a_title_read_failure_records_nothing() {
    let mut map = HashMap::new();
    let unreadable = Err(tauri::Error::from(std::io::Error::other(
        "title unreadable",
    )));
    record_leaf_icon(&mut map, "save", unreadable, Some("doc"));
    assert!(map.is_empty(), "{map:?}");
}

#[test]
fn fallback_icons_cover_exactly_the_three_dynamic_submenus() {
    assert_eq!(
        fallback_for_submenu_id(Some(RECENT_FILES_SUBMENU_ID)),
        Some("doc")
    );
    assert_eq!(
        fallback_for_submenu_id(Some(RECENT_WORKSPACES_SUBMENU_ID)),
        Some("folder")
    );
    assert_eq!(
        fallback_for_submenu_id(Some(GENIES_SUBMENU_ID)),
        Some("sparkles")
    );
    assert_eq!(fallback_for_submenu_id(Some("find-submenu")), None);
    assert_eq!(fallback_for_submenu_id(None), None);
}

#[test]
fn predefined_items_resolve_by_their_english_title_only() {
    assert_eq!(icon_for_predefined_title("Cut"), Some("scissors"));
    assert_eq!(
        icon_for_predefined_title("cut"),
        None,
        "best-effort English match, exact"
    );
    assert_eq!(icon_for_predefined_title("剪切"), None);
}

// ── the table itself ────────────────────────────────────────────────────────

#[test]
fn the_icon_tables_have_no_duplicate_keys_and_no_empty_symbols() {
    let mut seen = BTreeSet::new();
    for (id, symbol) in MENU_ICONS {
        assert!(
            seen.insert(*id),
            "`{id}` is listed twice; only the first row would ever apply"
        );
        assert!(
            !symbol.is_empty(),
            "`{id}` maps to an empty symbol, which `icon_for_id` treats as unmapped"
        );
        assert!(
            symbol
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.'),
            "`{id}` → `{symbol}` is not a well-formed SF Symbol name"
        );
    }
    let mut titles = BTreeSet::new();
    for (title, symbol) in PREDEFINED_ICONS {
        assert!(
            titles.insert(*title),
            "predefined title `{title}` is listed twice"
        );
        assert!(!symbol.is_empty(), "`{title}` maps to an empty symbol");
    }
}

// ── the table joined with the builders ──────────────────────────────────────

#[test]
fn the_localized_source_list_matches_the_module_declarations() {
    // A `#[path = …]`-included module (the file's own `mod tests;`) is not a
    // section builder; only bare `mod name;` declarations name one.
    let lines: Vec<&str> = LOCALIZED_ROOT.lines().map(str::trim).collect();
    let declared: BTreeSet<&str> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| *i == 0 || !lines[i - 1].starts_with("#[path"))
        .filter_map(|(_, line)| line.strip_prefix("mod ")?.strip_suffix(';'))
        .collect();
    let scanned: BTreeSet<&str> = LOCALIZED_SOURCES.iter().map(|(name, _)| *name).collect();
    assert_eq!(
        scanned, declared,
        "add the new section builder to LOCALIZED_SOURCES"
    );
}

#[test]
fn the_scanner_sees_the_menu_it_is_supposed_to_see() {
    // Guards the scanner itself: if the builders' call shape ever changes so
    // that nothing parses, the two join tests below would pass vacuously.
    let ids = all_leaf_ids();
    assert!(
        ids.len() > 100,
        "only {} leaf ids scanned: {ids:?}",
        ids.len()
    );
    for expected in [
        "save",
        "quit",
        "search-genies",
        "clear-recent",
        "install-cli",
    ] {
        assert!(
            ids.contains(expected),
            "`{expected}` not scanned from the builders"
        );
    }
    // A Windows-only item must NOT be counted as a macOS leaf.
    assert!(
        !ids.contains("edit-cut"),
        "cfg(windows) items must be skipped"
    );
    // Non-macOS blocks must not be counted either.
    assert!(
        !submenu_ids(LOCALIZED_SOURCES[1].1).is_empty(),
        "edit_menu declares submenus"
    );
}

#[test]
fn every_icon_table_row_names_a_menu_item_a_builder_creates() {
    let leaves = all_leaf_ids();
    let stale: Vec<&str> = table_ids()
        .into_iter()
        .filter(|id| !leaves.contains(*id))
        .collect();
    assert!(
        stale.is_empty(),
        "MENU_ICONS rows naming no menu item (renamed or removed?): {stale:?}"
    );
}

#[test]
fn every_static_leaf_item_in_the_macos_menu_has_an_icon() {
    let table = table_ids();
    let missing: Vec<String> = all_leaf_ids()
        .into_iter()
        .filter(|id| !table.contains(id.as_str()) && !FALLBACK_COVERED.contains(&id.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "menu items without an SF Symbol in MENU_ICONS (AGENTS.md: every item MUST have one): {missing:?}"
    );
    // The documented exceptions must still exist, or the list has gone stale.
    let dynamic = static_leaf_ids(DYNAMIC);
    for id in FALLBACK_COVERED {
        assert!(
            dynamic.contains(*id),
            "`{id}` is no longer a dynamic placeholder; drop it from FALLBACK_COVERED"
        );
    }
}

#[test]
fn no_icon_row_names_a_submenu_which_would_never_apply() {
    let table = table_ids();
    let submenus: BTreeSet<String> = LOCALIZED_SOURCES
        .iter()
        .flat_map(|(_, source)| submenu_ids(source))
        .collect();
    let dead: Vec<&String> = submenus
        .iter()
        .filter(|id| table.contains(id.as_str()))
        .collect();
    assert!(
        dead.is_empty(),
        "submenus never receive leaf icons: {dead:?}"
    );
}

// ── the positional Help / Window lookup ─────────────────────────────────────

#[test]
fn the_macos_menu_bar_ends_with_window_then_help() {
    let marker = "let menu = Menu::with_items(";
    let pos = LOCALIZED_ROOT
        .find(marker)
        .expect("the menu bar is assembled in localized.rs");
    let previous = LOCALIZED_ROOT[..pos]
        .trim_end()
        .lines()
        .last()
        .unwrap_or("")
        .trim();
    assert_eq!(
        previous, "#[cfg(target_os = \"macos\")]",
        "the first assembly is the macOS one"
    );
    let after = &LOCALIZED_ROOT[pos..];
    let list_start = after.find("&[").expect("item list") + 2;
    let list_end = after[list_start..].find(']').expect("list end") + list_start;
    let entries: Vec<&str> = after[list_start..list_end]
        .split(',')
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .collect();
    assert_eq!(
        &entries[entries.len() - 2..],
        ["&window_menu", "&help_menu"],
        "fix_window_menu takes the second-to-last menu and fix_help_menu the last: {entries:?}"
    );
}
