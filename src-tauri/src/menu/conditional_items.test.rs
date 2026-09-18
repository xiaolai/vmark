//! The conditional-item table, joined to the menu sources that build it (#1425).
//!
//! The tree manipulation itself needs a live menu and is verified from outside
//! the process (`debug_submenu_item_ids`). What IS checkable here is every
//! assumption that manipulation rests on, and each one has already failed once:
//!
//!   - an anchor must sit in the SAME submenu as its item, or the parent lookup
//!     finds nothing and the item silently never moves;
//!   - an anchor must not itself be conditional, or hiding one item can make
//!     another unfindable;
//!   - a conditional item must be built DISABLED, so a failed push leaves a
//!     greyed row rather than a live one that does nothing.
//!
//! Sources are parsed, not executed, so this runs on every platform — including
//! Windows, where `tauri::test` does not exist.

use super::{conditional_item, ConditionalItem, CONDITIONAL_ITEMS};

/// The per-section builder sources that can hold a conditional item or anchor.
const MENU_SOURCES: &[(&str, &str)] = &[
    ("app_menu.rs", include_str!("localized/app_menu.rs")),
    ("edit_menu.rs", include_str!("localized/edit_menu.rs")),
    ("export_menu.rs", include_str!("localized/export_menu.rs")),
    ("file_menu.rs", include_str!("localized/file_menu.rs")),
    (
        "file_submenus.rs",
        include_str!("localized/file_submenus.rs"),
    ),
    ("format_menu.rs", include_str!("localized/format_menu.rs")),
    (
        "format_submenus.rs",
        include_str!("localized/format_submenus.rs"),
    ),
    ("insert_menu.rs", include_str!("localized/insert_menu.rs")),
    (
        "insert_submenus.rs",
        include_str!("localized/insert_submenus.rs"),
    ),
    ("view_menu.rs", include_str!("localized/view_menu.rs")),
    (
        "window_help_menu.rs",
        include_str!("localized/window_help_menu.rs"),
    ),
];

/// One built menu item: its id and the `enabled` argument it was built with.
#[derive(Debug, PartialEq, Eq)]
struct BuiltItem {
    id: String,
    enabled: bool,
}

/// Read a Rust string literal starting at `bytes[i]` (which must be `"`).
fn read_string(bytes: &[u8], mut i: usize) -> (String, usize) {
    assert_eq!(bytes[i], b'"');
    i += 1;
    let mut out = String::new();
    while bytes[i] != b'"' {
        if bytes[i] == b'\\' {
            i += 1;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    (out, i + 1)
}

/// Every `MenuItem::with_id(app, "id", &t!(…), enabled, …)` in one source.
///
/// Depth tracking is what makes this safe: the id literal and the `enabled`
/// flag are the only ones at argument depth, while `t!("menu.…")` and
/// `accel("id", "chord")` sit one paren deeper and are skipped. `CheckMenuItem`
/// matches too (its name ENDS with the same token) and carries a second
/// depth-1 bool for `checked`; the first is `enabled`, which is the one that
/// decides whether a row is live.
fn scan_built_items(source: &str) -> Vec<BuiltItem> {
    let bytes = source.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(pos) = source[i..].find("MenuItem::with_id(") {
        let mut j = i + pos + "MenuItem::with_id(".len();
        let mut depth = 1usize;
        let mut id: Option<String> = None;
        let mut enabled: Option<bool> = None;
        while depth > 0 {
            match bytes[j] {
                b'(' => {
                    depth += 1;
                    j += 1;
                }
                b')' => {
                    depth -= 1;
                    j += 1;
                }
                b'"' => {
                    let (lit, next) = read_string(bytes, j);
                    if depth == 1 && id.is_none() {
                        id = Some(lit);
                    }
                    j = next;
                }
                _ => {
                    if depth == 1 && enabled.is_none() {
                        if source[j..].starts_with("true") {
                            enabled = Some(true);
                        } else if source[j..].starts_with("false") {
                            enabled = Some(false);
                        }
                    }
                    j += 1;
                }
            }
        }
        if let (Some(id), Some(enabled)) = (id, enabled) {
            out.push(BuiltItem { id, enabled });
        }
        i = j;
    }
    out
}

/// The source file that builds `id`, and how it was built.
fn built_in(id: &str) -> Option<(&'static str, BuiltItem)> {
    for (file, source) in MENU_SOURCES {
        if let Some(item) = scan_built_items(source).into_iter().find(|it| it.id == id) {
            return Some((file, item));
        }
    }
    None
}

#[test]
fn the_table_covers_the_two_features_that_ship_off() {
    let ids: Vec<&str> = CONDITIONAL_ITEMS.iter().map(|i| i.id).collect();
    assert!(
        ids.contains(&"new-browser-tab"),
        "embedded browser (WI-S0.5): {ids:?}"
    );
    assert!(
        ids.contains(&"knowledge-base"),
        "knowledge base (#1425): {ids:?}"
    );
}

#[test]
fn conditional_item_resolves_declared_ids_and_rejects_anything_else() {
    for item in CONDITIONAL_ITEMS {
        let found = conditional_item(item.id).expect("declared id must resolve");
        assert_eq!(found.anchor, item.anchor);
    }
    // A caller bug must be visible, not a silent no-op that reports success.
    assert!(conditional_item("knowledge_base").is_none());
    assert!(conditional_item("").is_none());
    assert!(conditional_item("outline").is_none());
}

#[test]
fn every_id_is_declared_once() {
    let mut ids: Vec<&str> = CONDITIONAL_ITEMS.iter().map(|i| i.id).collect();
    let before = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(
        ids.len(),
        before,
        "a duplicate id would give one item two states"
    );
}

#[test]
fn no_anchor_is_itself_conditional() {
    for ConditionalItem { id, anchor } in CONDITIONAL_ITEMS {
        assert!(
            conditional_item(anchor).is_none(),
            "{id:?} anchors on {anchor:?}, which is itself conditional: hiding that one \
             would make this one unfindable"
        );
    }
}

#[test]
fn each_item_and_its_anchor_are_built_in_the_same_submenu() {
    for ConditionalItem { id, anchor } in CONDITIONAL_ITEMS {
        let (item_file, _) = built_in(id).unwrap_or_else(|| panic!("no builder builds {id:?}"));
        let (anchor_file, _) =
            built_in(anchor).unwrap_or_else(|| panic!("no builder builds anchor {anchor:?}"));
        assert_eq!(
            item_file, anchor_file,
            "{id:?} is built in {item_file} but its anchor {anchor:?} in {anchor_file}; the \
             parent lookup searches the submenu holding the ANCHOR, so it would never find \
             this item"
        );
    }
}

#[test]
fn each_conditional_item_is_built_disabled() {
    for ConditionalItem { id, .. } in CONDITIONAL_ITEMS {
        let (file, item) = built_in(id).unwrap_or_else(|| panic!("no builder builds {id:?}"));
        assert!(
            !item.enabled,
            "{id:?} ({file}) is built enabled; every conditional item guards a feature that \
             is off by default, so a push that never lands must leave a greyed row, not a \
             live one that silently does nothing"
        );
    }
}

#[test]
fn the_scanner_reads_ids_and_enabled_flags_without_being_fooled_by_nested_calls() {
    let source = r#"
        MenuItem::with_id(app, "alpha", &t!("menu.view.alpha"), true, accel("alpha", "F1"))?,
        MenuItem::with_id(app, "beta", &t!("menu.file.beta"), false, accel("beta", ""))?,
    "#;
    assert_eq!(
        scan_built_items(source),
        vec![
            BuiltItem {
                id: "alpha".into(),
                enabled: true
            },
            BuiltItem {
                id: "beta".into(),
                enabled: false
            },
        ]
    );
}
