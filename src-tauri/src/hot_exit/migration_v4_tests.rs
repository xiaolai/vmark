//! v3 -> v4 migration tests for workspace rail instance containers.

use super::*;
use crate::hot_exit::session::SessionData;

fn v3_session_json(extra_window_fields: serde_json::Value) -> serde_json::Value {
    let mut window = serde_json::json!({
        "window_label": "main",
        "is_main_window": true,
        "active_tab_id": null,
        "tabs": [],
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
        "geometry": null
    });
    if let (Some(target), Some(extra)) = (window.as_object_mut(), extra_window_fields.as_object()) {
        for (key, value) in extra {
            target.insert(key.clone(), value.clone());
        }
    }

    serde_json::json!({
        "version": 3,
        "timestamp": 1760000000,
        "vmark_version": "0.8.0",
        "windows": [window],
        "workspace": null
    })
}

#[test]
fn v3_session_migrates_to_current_v4() {
    let session: SessionData =
        serde_json::from_value(v3_session_json(serde_json::json!({}))).unwrap();

    let migrated = migrate_session(session).unwrap();

    assert_eq!(migrated.version, crate::hot_exit::session::SCHEMA_VERSION);
    assert_eq!(
        migrated.windows[0].workspace_instance_ids,
        Vec::<String>::new()
    );
    assert!(migrated.windows[0].active_workspace_instance_id.is_none());
    assert!(migrated.windows[0].workspace_instances.is_empty());
}

#[test]
fn v3_payload_with_workspace_instances_preserves_frontend_camel_case_fields() {
    let session: SessionData = serde_json::from_value(v3_session_json(serde_json::json!({
        "workspace_instance_ids": ["ws-1"],
        "active_workspace_instance_id": "ws-1",
        "workspace_instances": [{
            "workspaceInstanceId": "ws-1",
            "rootId": "path:macos:/tmp/a",
            "rootPath": "/tmp/a",
            "displayName": "a",
            "ownerWindowLabel": "main",
            "createdFrom": "open",
            "activeTabId": null,
            "tabIds": [],
            "closedTabIds": []
        }]
    })))
    .unwrap();

    let migrated = migrate_session(session).unwrap();
    let window = &migrated.windows[0];

    assert_eq!(window.workspace_instance_ids, vec!["ws-1"]);
    assert_eq!(window.active_workspace_instance_id.as_deref(), Some("ws-1"));
    assert_eq!(window.workspace_instances[0].workspace_instance_id, "ws-1");
    assert_eq!(window.workspace_instances[0].kind, "workspace");
    assert_eq!(
        window.workspace_instances[0].root_path.as_deref(),
        Some("/tmp/a")
    );
}
