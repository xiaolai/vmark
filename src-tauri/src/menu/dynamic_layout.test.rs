// WI-RA14B.3 — what the dynamic submenus contain: the ids the click handler
// resolves through the snapshot, the labels, the Search Genies accelerator and
// the genie grouping. Native menu items can only be built on the main thread,
// so these decisions are pinned here, apart from the building.

use super::*;
use crate::genies::GenieMenuEntry;

fn genie(title: &str, path: &str, category: Option<&str>) -> GenieMenuEntry {
    GenieMenuEntry {
        title: title.to_string(),
        path: path.to_string(),
        category: category.map(str::to_string),
    }
}

fn owned(items: &[(String, &str)]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|(id, label)| (id.clone(), label.to_string()))
        .collect()
}

#[test]
fn recent_entries_are_indexed_in_order_and_labelled_by_their_last_component() {
    let paths = vec![
        "/Users/me/notes/plan.md".to_string(),
        "/Users/me/文档/笔记.md".to_string(),
        "relative/draft.md".to_string(),
    ];

    let entries = recent_entries("recent-file", &paths);

    assert_eq!(
        owned(&entries),
        vec![
            ("recent-file-0".into(), "plan.md".into()),
            ("recent-file-1".into(), "笔记.md".into()),
            ("recent-file-2".into(), "draft.md".into()),
        ]
    );
}

#[test]
fn a_path_with_no_last_component_is_labelled_by_the_whole_path() {
    let paths = vec!["/".to_string(), "/a/..".to_string(), String::new()];

    let entries = recent_entries("recent-workspace", &paths);

    assert_eq!(
        owned(&entries),
        vec![
            ("recent-workspace-0".into(), "/".into()),
            ("recent-workspace-1".into(), "/a/..".into()),
            ("recent-workspace-2".into(), "".into()),
        ]
    );
}

#[test]
fn a_trailing_slash_still_labels_by_the_folder_name() {
    let paths = vec!["/Users/me/project/".to_string()];
    assert_eq!(recent_entries("recent-workspace", &paths)[0].1, "project");
}

#[test]
fn no_recent_paths_means_no_entries() {
    assert!(recent_entries("recent-file", &[]).is_empty());
}

/// `(id, enabled)` per row of a recent submenu, `"-"` for the separator.
fn rows(items: &[RecentRow<'_>]) -> Vec<(String, bool)> {
    items
        .iter()
        .map(|row| match row {
            RecentRow::Item { id, enabled, .. } => (id.to_string(), *enabled),
            RecentRow::Separator => ("-".to_string(), true),
        })
        .collect()
}

fn expect(list: &[(&str, bool)]) -> Vec<(String, bool)> {
    list.iter().map(|(id, on)| (id.to_string(), *on)).collect()
}

#[test]
fn a_recent_submenu_lists_its_paths_then_an_enabled_clear() {
    let paths = vec!["/a/one.md".to_string(), "/b/two.md".to_string()];
    let layout = recent_submenu(&RECENT_FILES_MENU, &paths);
    assert_eq!(
        rows(&layout),
        expect(&[
            ("recent-file-0", true),
            ("recent-file-1", true),
            ("-", true),
            ("clear-recent", true)
        ])
    );
    let RecentRow::Item { label, .. } = &layout[1] else {
        panic!("an item")
    };
    assert_eq!(label.as_ref(), "two.md");
}

#[test]
fn an_empty_recent_submenu_shows_a_disabled_placeholder_and_a_disabled_clear() {
    assert_eq!(
        rows(&recent_submenu(&RECENT_FILES_MENU, &[])),
        expect(&[("no-recent", false), ("-", true), ("clear-recent", false)])
    );
    assert_eq!(
        rows(&recent_submenu(&RECENT_WORKSPACES_MENU, &[])),
        expect(&[
            ("no-recent-workspace", false),
            ("-", true),
            ("clear-recent-workspaces", false)
        ])
    );
}

#[test]
fn recent_workspaces_use_their_own_ids() {
    let paths = vec!["/work/site/".to_string()];
    assert_eq!(
        rows(&recent_submenu(&RECENT_WORKSPACES_MENU, &paths)),
        expect(&[
            ("recent-workspace-0", true),
            ("-", true),
            ("clear-recent-workspaces", true)
        ])
    );
}

#[test]
fn search_genies_keeps_the_default_unless_the_map_says_otherwise() {
    let map = |value: Option<&str>| {
        let mut m = HashMap::new();
        m.insert("other".to_string(), "CmdOrCtrl+K".to_string());
        if let Some(v) = value {
            m.insert("search-genies".to_string(), v.to_string());
        }
        m
    };
    let default = Some("CmdOrCtrl+Y".to_string());

    assert_eq!(search_genies_accelerator(None), default, "no map at all");
    assert_eq!(
        search_genies_accelerator(Some(&map(None))),
        default,
        "key absent from the map"
    );
    assert_eq!(
        search_genies_accelerator(Some(&map(Some("Alt+G")))),
        Some("Alt+G".to_string())
    );
    assert_eq!(
        search_genies_accelerator(Some(&map(Some("")))),
        None,
        "an empty value is the user unbinding it"
    );
}

#[test]
fn genies_lay_out_root_first_then_categories_sorted_by_name() {
    let entries = vec![
        genie("Zeta", "/g/zeta.md", None),
        genie("Tone", "/g/writing/tone.md", Some("writing")),
        genie("Fix", "/g/code/fix.md", Some("code")),
        genie("Alpha", "/g/alpha.md", None),
        genie("Brief", "/g/writing/brief.md", Some("writing")),
    ];

    let layout = genie_layout(&entries);

    // Root entries keep scan order; they are not sorted by title.
    assert_eq!(
        owned(&layout.root),
        vec![
            ("genie-item-0".into(), "Zeta".into()),
            ("genie-item-1".into(), "Alpha".into()),
        ]
    );
    let groups: Vec<(&str, Vec<(String, String)>)> = layout
        .groups
        .iter()
        .map(|(name, items)| (*name, owned(items)))
        .collect();
    assert_eq!(
        groups,
        vec![
            ("code", vec![("genie-item-2".into(), "Fix".into())]),
            (
                "writing",
                vec![
                    ("genie-item-3".into(), "Tone".into()),
                    ("genie-item-4".into(), "Brief".into()),
                ]
            ),
        ]
    );
}

#[test]
fn every_genie_id_names_its_path_in_the_snapshot() {
    let entries = vec![
        genie("B", "/g/x/b.md", Some("x")),
        genie("A", "/g/a.md", None),
        genie("C", "/g/w/c.md", Some("w")),
    ];

    let layout = genie_layout(&entries);

    let items = layout
        .root
        .iter()
        .chain(layout.groups.iter().flat_map(|(_, items)| items.iter()));
    for (id, title) in items {
        let index: usize = id
            .strip_prefix("genie-item-")
            .and_then(|n| n.parse().ok())
            .expect("id carries an index");
        let entry = entries.iter().find(|e| e.title == *title).expect("entry");
        assert_eq!(
            layout.snapshot[index], entry.path,
            "{id} resolves to {title}"
        );
    }
    assert_eq!(layout.snapshot.len(), entries.len());
}

#[test]
fn no_genies_lay_out_to_nothing() {
    let layout = genie_layout(&[]);
    assert!(layout.root.is_empty() && layout.groups.is_empty() && layout.snapshot.is_empty());
}
