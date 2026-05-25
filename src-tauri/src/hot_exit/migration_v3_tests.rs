//! WI-1A.13 — v2 → v3 migration tests
//!
//! Persistence migration that adds format_id / editing_enabled /
//! active_schema_id to TabState. Serde defaults are exercised by
//! deserializing a v2 JSON fixture and asserting the backfilled values;
//! the v3 explicit-field fixture verifies non-default values survive
//! a serialize → deserialize round trip.
//!
//! Kept in a sibling file (not inline `#[cfg(test)] mod tests`) so the
//! production `migration.rs` stays under the project's ~300-line target.

use super::*;

// ─── Fixtures ─────────────────────────────────────────────────────────────
//
// Two shapes:
//   - `v2_tab_json`  — pre-v3 TabState (no format_id / editing_enabled /
//                       active_schema_id); exercises serde defaults.
//   - `v3_tab_json`  — v3 TabState carrying explicit non-default values
//                       for round-trip stability checks.
//
// Centralized so individual tests don't repeat large JSON blobs.

fn v2_tab_json() -> &'static str {
    r##"{
        "version": 2,
        "timestamp": 1747958400,
        "vmark_version": "0.7.26",
        "windows": [
            {
                "window_label": "main",
                "is_main_window": true,
                "active_tab_id": "tab-1",
                "tabs": [
                    {
                        "id": "tab-1",
                        "file_path": "/notes/draft.md",
                        "title": "draft.md",
                        "is_pinned": false,
                        "document": {
                            "content": "# draft",
                            "saved_content": "# draft",
                            "is_dirty": false,
                            "is_missing": false,
                            "is_divergent": false,
                            "line_ending": "\n",
                            "cursor_info": null,
                            "last_modified_timestamp": null,
                            "is_untitled": false,
                            "untitled_number": null,
                            "undo_history": [],
                            "redo_history": []
                        }
                    }
                ],
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
            }
        ],
        "workspace": null
    }"##
}

fn v3_tab_json() -> &'static str {
    r##"{
        "version": 3,
        "timestamp": 1747958400,
        "vmark_version": "0.7.26",
        "windows": [
            {
                "window_label": "main",
                "is_main_window": true,
                "active_tab_id": "t1",
                "tabs": [
                    {
                        "id": "t1",
                        "file_path": "/data/payload.json",
                        "title": "payload.json",
                        "is_pinned": false,
                        "document": {
                            "content": "{}",
                            "saved_content": "{}",
                            "is_dirty": false,
                            "is_missing": false,
                            "is_divergent": false,
                            "line_ending": "\n",
                            "cursor_info": null,
                            "last_modified_timestamp": null,
                            "is_untitled": false,
                            "untitled_number": null,
                            "undo_history": [],
                            "redo_history": []
                        },
                        "format_id": "json",
                        "editing_enabled": false,
                        "active_schema_id": "package-json"
                    }
                ],
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
            }
        ],
        "workspace": null
    }"##
}

/// Parse the v2 fixture into a SessionData. Centralizes the
/// `from_str(v2_tab_json()).unwrap()` pattern shared across v3 tests.
fn parse_v2_session() -> SessionData {
    serde_json::from_str(v2_tab_json()).unwrap()
}

/// Parse the v3 explicit-fields fixture.
fn parse_v3_session() -> SessionData {
    serde_json::from_str(v3_tab_json()).unwrap()
}

// ─── v2 → v3 serde-default backfill ───────────────────────────────────────

#[test]
fn test_v2_deserialize_backfills_format_id_markdown() {
    let session = parse_v2_session();
    assert_eq!(session.windows[0].tabs[0].format_id, "markdown");
}

#[test]
fn test_v2_deserialize_backfills_editing_enabled_true() {
    let session = parse_v2_session();
    assert!(session.windows[0].tabs[0].editing_enabled);
}

#[test]
fn test_v2_deserialize_backfills_active_schema_id_none() {
    let session = parse_v2_session();
    assert!(session.windows[0].tabs[0].active_schema_id.is_none());
}

// ─── migrate_session for v2 → v3 ──────────────────────────────────────────

#[test]
fn test_migrate_v2_to_v3_bumps_version() {
    let session = parse_v2_session();
    let migrated = migrate_session(session).unwrap();
    assert_eq!(migrated.version, SCHEMA_VERSION);
}

#[test]
fn test_migrate_v2_to_v3_preserves_document_content() {
    let session = parse_v2_session();
    let migrated = migrate_session(session).unwrap();
    assert_eq!(migrated.windows[0].tabs[0].document.content, "# draft");
}

// ─── v3 explicit-field round trip ─────────────────────────────────────────

#[test]
fn test_v3_roundtrip_preserves_explicit_format_fields() {
    let parsed = parse_v3_session();
    assert_eq!(parsed.windows[0].tabs[0].format_id, "json");
    assert!(!parsed.windows[0].tabs[0].editing_enabled);
    assert_eq!(
        parsed.windows[0].tabs[0].active_schema_id.as_deref(),
        Some("package-json"),
    );

    // Round-trip serialize → deserialize → fields stable.
    let reserialized = serde_json::to_string(&parsed).unwrap();
    let reparsed: SessionData = serde_json::from_str(&reserialized).unwrap();
    assert_eq!(reparsed.windows[0].tabs[0].format_id, "json");
    assert!(!reparsed.windows[0].tabs[0].editing_enabled);
    assert_eq!(
        reparsed.windows[0].tabs[0].active_schema_id.as_deref(),
        Some("package-json"),
    );
}

// ─── Future-version rejection ─────────────────────────────────────────────

#[test]
fn test_migrate_v4_future_version_rejected() {
    // Construct a session with version 4 (a hypothetical future version)
    // and confirm it produces a typed error rather than a panic.
    let mut session = SessionData::new("99.0.0".to_string());
    session.version = 4;
    let result = migrate_session(session);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Cannot migrate"));
}
