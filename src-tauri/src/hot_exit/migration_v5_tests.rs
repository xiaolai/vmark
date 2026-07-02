//! v4 -> v5 migration tests for explicit workspace context kinds. Mirrors
//! `src/services/persistence/hotExit/schemaMigration.v5.test.ts` to keep the
//! dual Rust/TypeScript migration contract in lock-step.

use super::*;
use crate::hot_exit::session::{SessionData, SCHEMA_VERSION};

/// v4 session JSON with one window; `extra_window_fields` overrides defaults.
fn v4_session_json(
    workspace: serde_json::Value,
    tabs: serde_json::Value,
    extra_window_fields: serde_json::Value,
) -> serde_json::Value {
    let mut window = serde_json::json!({
        "window_label": "main",
        "is_main_window": true,
        "active_tab_id": null,
        "tabs": tabs,
        "ui_state": {
            "sidebar_visible": true,
            "sidebar_width": 260,
            "outline_visible": false,
            "sidebar_view_mode": "files",
            "status_bar_visible": true,
            "source_mode_enabled": false,
            "focus_mode_enabled": false,
            "typewriter_mode_enabled": false
        },
        "geometry": null,
        "workspace_instance_ids": [],
        "active_workspace_instance_id": null,
        "workspace_instances": []
    });
    if let (Some(target), Some(extra)) = (window.as_object_mut(), extra_window_fields.as_object()) {
        for (key, value) in extra {
            target.insert(key.clone(), value.clone());
        }
    }

    serde_json::json!({
        "version": 4,
        "timestamp": 1_760_000_000_i64,
        "vmark_version": "0.8.0",
        "windows": [window],
        "workspace": workspace
    })
}

fn tab(id: &str, file_path: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "file_path": file_path,
        "title": id,
        "is_pinned": false,
        "format_id": "markdown",
        "editing_enabled": true,
        "active_schema_id": null,
        "document": {
            "content": "content",
            "saved_content": "content",
            "is_dirty": false,
            "is_missing": false,
            "is_divergent": false,
            "line_ending": "\n",
            "cursor_info": null,
            "last_modified_timestamp": null,
            "is_untitled": file_path.is_none(),
            "untitled_number": if file_path.is_none() { Some(1) } else { None }
        }
    })
}

fn workspace_mode(root: &str) -> serde_json::Value {
    serde_json::json!({
        "root_path": root,
        "is_workspace_mode": true,
        "show_hidden_files": false
    })
}

fn migrate(value: serde_json::Value) -> SessionData {
    let session: SessionData = serde_json::from_value(value).unwrap();
    migrate_session(session).unwrap()
}

#[test]
fn synthesizes_workspace_and_loose_contexts_from_legacy_tabs() {
    let migrated = migrate(v4_session_json(
        workspace_mode("/repo"),
        serde_json::json!([
            tab("tab-workspace", Some("/repo/a.md")),
            tab("tab-loose", Some("/outside/b.md")),
            tab("tab-untitled", None),
        ]),
        serde_json::json!({ "active_tab_id": "tab-loose" }),
    ));
    let window = &migrated.windows[0];

    // Bumps to the current schema (v5).
    assert_eq!(migrated.version, SCHEMA_VERSION);
    assert_eq!(SCHEMA_VERSION, 5);
    assert_eq!(window.workspace_instances.len(), 2);
    assert_eq!(window.workspace_instances[0].kind, "workspace");
    assert_eq!(
        window.workspace_instances[0].root_path.as_deref(),
        Some("/repo")
    );
    assert_eq!(window.workspace_instances[0].tab_ids, vec!["tab-workspace"]);

    assert_eq!(window.workspace_instances[1].kind, "loose");
    assert!(window.workspace_instances[1].root_path.is_none());
    assert_eq!(
        window.workspace_instances[1].tab_ids,
        vec!["tab-loose", "tab-untitled"]
    );

    // active_tab_id "tab-loose" lives in the loose context.
    assert_eq!(
        window.active_workspace_instance_id.as_deref(),
        Some(window.workspace_instances[1].workspace_instance_id.as_str())
    );
    // Synthesized ids are ordered workspace-first then loose.
    assert_eq!(
        window.workspace_instance_ids,
        vec!["wsi-legacy-main-workspace", "wsi-legacy-main-loose"]
    );
}

#[test]
fn synthesized_instance_preserves_active_tab_when_contained() {
    // The TS migration sets each synthesized instance's activeTabId via
    // activeTabInList; the Rust side must match (it previously set None).
    let migrated = migrate(v4_session_json(
        workspace_mode("/repo"),
        serde_json::json!([
            tab("tab-workspace", Some("/repo/a.md")),
            tab("tab-loose", Some("/outside/b.md")),
        ]),
        serde_json::json!({ "active_tab_id": "tab-workspace" }),
    ));
    let window = &migrated.windows[0];

    let workspace = &window.workspace_instances[0];
    assert_eq!(workspace.kind, "workspace");
    assert_eq!(workspace.active_tab_id.as_deref(), Some("tab-workspace"));

    let loose = &window.workspace_instances[1];
    assert_eq!(loose.kind, "loose");
    // The active tab does NOT belong to the loose context → None.
    assert!(loose.active_tab_id.is_none());
}

#[test]
fn normalizes_serialized_contexts_and_deduplicates_tab_ids() {
    let migrated = migrate(v4_session_json(
        workspace_mode("/repo"),
        serde_json::json!([tab("tab-a", Some("/repo/a.md"))]),
        serde_json::json!({
            "active_tab_id": "tab-a",
            "workspace_instance_ids": ["loose", "missing"],
            "active_workspace_instance_id": "missing",
            "workspace_instances": [
                {
                    "workspaceInstanceId": "workspace",
                    "rootId": "path:macos:/repo",
                    "rootPath": "/repo",
                    "displayName": "repo",
                    "ownerWindowLabel": "old-owner",
                    "createdFrom": "open",
                    "activeTabId": "tab-a",
                    "tabIds": ["tab-a", "tab-a"],
                    "closedTabIds": []
                },
                {
                    "workspaceInstanceId": "loose",
                    "kind": "loose",
                    "rootId": "path:macos:/stale",
                    "rootPath": "/stale",
                    "displayName": "stale",
                    "ownerWindowLabel": "old-owner",
                    "createdFrom": "open",
                    "activeTabId": null,
                    "tabIds": ["tab-b"],
                    "closedTabIds": ["closed", "closed"],
                    "unavailableRoot": true
                },
                {
                    "workspaceInstanceId": "placeholder",
                    "rootId": null,
                    "rootPath": null,
                    "displayName": "Untitled",
                    "ownerWindowLabel": "old-owner",
                    "createdFrom": "placeholder",
                    "activeTabId": null,
                    "tabIds": [],
                    "closedTabIds": []
                }
            ]
        }),
    ));
    let window = &migrated.windows[0];

    assert_eq!(
        window.workspace_instance_ids,
        vec!["loose", "workspace", "placeholder"]
    );
    assert_eq!(
        window.active_workspace_instance_id.as_deref(),
        Some("workspace")
    );

    let workspace = &window.workspace_instances[0];
    assert_eq!(workspace.kind, "workspace");
    assert_eq!(workspace.owner_window_label, "main");
    // Duplicate tab id collapsed (uniqueStrings parity).
    assert_eq!(workspace.tab_ids, vec!["tab-a"]);

    let loose = &window.workspace_instances[1];
    assert_eq!(loose.kind, "loose");
    assert!(loose.root_id.is_none());
    assert!(loose.root_path.is_none());
    assert_eq!(loose.display_name, "Loose Files");
    assert_eq!(loose.owner_window_label, "main");
    // Duplicate closed tab id collapsed.
    assert_eq!(loose.closed_tab_ids, vec!["closed"]);
    assert!(loose.unavailable_root);

    let placeholder = &window.workspace_instances[2];
    assert_eq!(placeholder.kind, "placeholder");
    assert!(placeholder.root_path.is_none());
}

#[test]
fn falls_back_to_first_non_placeholder_context_when_active_tab_unmapped() {
    let migrated = migrate(v4_session_json(
        workspace_mode("/repo"),
        serde_json::json!([tab("tab-loose", Some("/repo/a.md"))]),
        serde_json::json!({
            "active_tab_id": "missing",
            "active_workspace_instance_id": null,
            "workspace_instance_ids": ["placeholder", "loose"],
            "workspace_instances": [
                {
                    "workspaceInstanceId": "placeholder",
                    "rootId": null,
                    "rootPath": null,
                    "displayName": "Untitled",
                    "ownerWindowLabel": "old-owner",
                    "createdFrom": "placeholder",
                    "activeTabId": null,
                    "tabIds": [],
                    "closedTabIds": []
                },
                {
                    "workspaceInstanceId": "loose",
                    "rootId": null,
                    "rootPath": null,
                    "displayName": "Loose Files",
                    "ownerWindowLabel": "old-owner",
                    "createdFrom": "open",
                    "activeTabId": null,
                    "tabIds": ["tab-loose"],
                    "closedTabIds": []
                }
            ]
        }),
    ));

    assert_eq!(
        migrated.windows[0].active_workspace_instance_id.as_deref(),
        Some("loose")
    );
}

#[test]
fn is_within_root_handles_windows_and_separator_variants() {
    assert!(v5::is_within_root("C:\\repo", "C:\\repo\\a.md")); // backslash paths
    assert!(v5::is_within_root("C:\\repo", "c:\\repo\\nested\\b.md")); // drive case
    assert!(v5::is_within_root("/repo/", "/repo/a.md")); // trailing slash on root
    assert!(v5::is_within_root("/repo", "/repo//a.md")); // duplicate separators
    assert!(v5::is_within_root("/repo", "/repo")); // exact match
    assert!(!v5::is_within_root("/repo", "/repo-other/a.md")); // shared prefix sibling
    assert!(!v5::is_within_root("/repo", "/elsewhere/a.md")); // outside root
                                                              // Filesystem root "/" contains every absolute path (boundary "/", not "//").
    assert!(v5::is_within_root("/", "/a.md"));
    assert!(v5::is_within_root("/", "/nested/deep/b.md"));
    assert!(v5::is_within_root("/", "/"));
}

#[test]
fn windows_legacy_tabs_are_classified_as_workspace() {
    let migrated = migrate(v4_session_json(
        workspace_mode("C:\\repo"),
        serde_json::json!([
            tab("tab-win", Some("C:\\repo\\a.md")),
            tab("tab-out", Some("D:\\other\\b.md")),
        ]),
        serde_json::json!({ "active_tab_id": "tab-win" }),
    ));
    let window = &migrated.windows[0];

    assert_eq!(window.workspace_instances[0].kind, "workspace");
    assert_eq!(window.workspace_instances[0].tab_ids, vec!["tab-win"]);
    assert_eq!(window.workspace_instances[1].kind, "loose");
    assert_eq!(window.workspace_instances[1].tab_ids, vec!["tab-out"]);
}
