//! Schema Migration for Hot Exit Sessions (Rust side)
//!
//! Provides migration functions to upgrade old session formats to the current schema.
//! This ensures users don't lose their session data when the app updates.
//!
//! **Dual migration by design**: Both Rust (this file) and TypeScript
//! (`src/utils/hotExit/schemaMigration.ts`) implement the same migrations.
//! Rust handles sessions read from disk at startup; TypeScript handles
//! in-memory session data from the frontend hot-exit capture flow.
//! Both must be kept in sync when adding new schema versions.
//!
//! Migration Strategy:
//! - Sessions at current version pass through unchanged
//! - Older sessions are migrated step-by-step (v1 -> v2 -> v3 -> current)
//! - Future sessions (higher version) cannot be migrated (fail gracefully)
//! - Version 0 is invalid and rejected

use super::session::{SessionData, SCHEMA_VERSION};

/// Minimum supported version for migration
const MIN_SUPPORTED_VERSION: u32 = 1;

/// Check if a session version can be migrated to current version.
pub fn can_migrate(version: u32) -> bool {
    // Invalid version
    if version < MIN_SUPPORTED_VERSION {
        return false;
    }

    // Current or older (can migrate)
    if version <= SCHEMA_VERSION {
        return true;
    }

    // Future version - cannot migrate
    false
}

/// Migrate a session to the current schema version.
///
/// Returns Ok(session) with updated version, or Err if migration not possible.
pub fn migrate_session(mut session: SessionData) -> Result<SessionData, String> {
    // Validate version
    if !can_migrate(session.version) {
        return Err(format!(
            "Cannot migrate session from version {} to {}. Supported versions: {} to {}",
            session.version, SCHEMA_VERSION, MIN_SUPPORTED_VERSION, SCHEMA_VERSION
        ));
    }

    // Already at current version - return as-is
    if session.version == SCHEMA_VERSION {
        return Ok(session);
    }

    // Apply migrations step by step
    while session.version < SCHEMA_VERSION {
        session = migrate_to_next_version(session)?;
    }

    Ok(session)
}

/// Migrate session to the next version.
///
/// This is where individual version migrations are dispatched.
fn migrate_to_next_version(session: SessionData) -> Result<SessionData, String> {
    match session.version {
        1 => migrate_v1_to_v2(session),
        2 => migrate_v2_to_v3(session),
        _ => Err(format!("No migration path from version {}", session.version)),
    }
}

/// Migrate v1 -> v2: Add undo/redo history to documents
///
/// v2 adds undo_history and redo_history arrays to DocumentState
/// for preserving cross-mode undo capability across restarts.
///
/// Note: The actual migration is handled by serde's #[serde(default)]
/// attribute on the new fields, which initializes them to empty Vec.
/// This function just bumps the version number.
fn migrate_v1_to_v2(mut session: SessionData) -> Result<SessionData, String> {
    session.version = 2;
    // undo_history and redo_history are automatically initialized to empty
    // vectors by serde's #[serde(default)] when deserializing v1 sessions
    Ok(session)
}

/// Migrate v2 -> v3: Add format_id / editing_enabled / active_schema_id to TabState
///
/// v3 adds three fields to TabState in support of the multi-format workspace
/// (plan WI-1A.13). Pre-v3 sessions are markdown-only by definition; the
/// migration backfills:
///   - format_id        = "markdown"
///   - editing_enabled  = true   (markdown is editable by default)
///   - active_schema_id = None   (no schema dispatch yet)
///
/// As with v1->v2, the actual field defaults are applied automatically by
/// serde's `#[serde(default)]` attributes on the new fields. This function
/// just bumps the version number and is here so callers see a deliberate
/// migration step (and so future schema bumps slot in alongside it).
fn migrate_v2_to_v3(mut session: SessionData) -> Result<SessionData, String> {
    session.version = 3;
    // format_id / editing_enabled / active_schema_id default-initialized
    // by serde's `#[serde(default = ...)]` on TabState fields.
    Ok(session)
}

/// Check if session needs migration.
pub fn needs_migration(session: &SessionData) -> bool {
    session.version < SCHEMA_VERSION
}

// =============================================================================
// Migration Functions
// =============================================================================
// Add migration functions here as we evolve the schema.
// Each function should:
// 1. Take a session at version N
// 2. Return a session at version N+1
// 3. Add default values for new fields
// 4. Transform data structures as needed

/*
Example migration template for v1 -> v2 (when needed):

fn migrate_v1_to_v2(mut session: SessionData) -> Result<SessionData, String> {
    session.version = 2;

    // Add new fields with defaults
    // session.new_field = Some(default_value);

    // Transform existing fields if needed
    for window in &mut session.windows {
        // window.new_window_field = false;
    }

    Ok(session)
}
*/

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_can_migrate_current_version() {
        assert!(can_migrate(SCHEMA_VERSION));
    }

    #[test]
    fn test_can_migrate_older_version() {
        assert!(can_migrate(1));
    }

    #[test]
    fn test_cannot_migrate_future_version() {
        assert!(!can_migrate(SCHEMA_VERSION + 1));
        assert!(!can_migrate(999));
    }

    #[test]
    fn test_cannot_migrate_version_zero() {
        assert!(!can_migrate(0));
    }

    #[test]
    fn test_migrate_current_version_unchanged() {
        let session = SessionData::new("0.3.24".to_string());
        let migrated = migrate_session(session.clone()).unwrap();
        assert_eq!(migrated.version, SCHEMA_VERSION);
    }

    #[test]
    fn test_migrate_future_version_fails() {
        let mut session = SessionData::new("1.0.0".to_string());
        session.version = SCHEMA_VERSION + 1;

        let result = migrate_session(session);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot migrate"));
    }

    #[test]
    fn test_needs_migration() {
        let mut session = SessionData::new("0.3.24".to_string());

        // Current version - no migration needed
        assert!(!needs_migration(&session));

        // Older version - needs migration
        session.version = 1;
        if SCHEMA_VERSION > 1 {
            assert!(needs_migration(&session));
        }
    }

    // ─── WI-1A.13 — v2 → v3 migration tests ───────────────────────────────
    //
    // These cover the persistence migration that adds format_id /
    // editing_enabled / active_schema_id to TabState. The serde defaults
    // are exercised by deserializing a v2 JSON fixture and asserting the
    // backfilled values.

    fn v2_tab_json() -> &'static str {
        // A pre-v3 TabState — no format_id / editing_enabled / active_schema_id.
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

    #[test]
    fn test_v2_deserialize_backfills_format_id_markdown() {
        let session: SessionData = serde_json::from_str(v2_tab_json()).unwrap();
        let tab = &session.windows[0].tabs[0];
        assert_eq!(tab.format_id, "markdown");
    }

    #[test]
    fn test_v2_deserialize_backfills_editing_enabled_true() {
        let session: SessionData = serde_json::from_str(v2_tab_json()).unwrap();
        let tab = &session.windows[0].tabs[0];
        assert!(tab.editing_enabled);
    }

    #[test]
    fn test_v2_deserialize_backfills_active_schema_id_none() {
        let session: SessionData = serde_json::from_str(v2_tab_json()).unwrap();
        let tab = &session.windows[0].tabs[0];
        assert!(tab.active_schema_id.is_none());
    }

    #[test]
    fn test_migrate_v2_to_v3_bumps_version() {
        let session: SessionData = serde_json::from_str(v2_tab_json()).unwrap();
        let migrated = migrate_session(session).unwrap();
        assert_eq!(migrated.version, SCHEMA_VERSION);
    }

    #[test]
    fn test_migrate_v2_to_v3_preserves_document_content() {
        let session: SessionData = serde_json::from_str(v2_tab_json()).unwrap();
        let migrated = migrate_session(session).unwrap();
        assert_eq!(migrated.windows[0].tabs[0].document.content, "# draft");
    }

    #[test]
    fn test_v3_roundtrip_preserves_explicit_format_fields() {
        // A v3 tab with non-default field values must survive a
        // serialize → deserialize round-trip unchanged.
        let mut session = SessionData::new("0.7.26".to_string());
        session.version = 3;
        // Build a window with one tab carrying explicit values.
        let json_input = r##"{
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
        }"##;
        let parsed: SessionData = serde_json::from_str(json_input).unwrap();
        assert_eq!(parsed.windows[0].tabs[0].format_id, "json");
        assert!(!parsed.windows[0].tabs[0].editing_enabled);
        assert_eq!(
            parsed.windows[0].tabs[0].active_schema_id.as_deref(),
            Some("package-json")
        );
        // Round-trip serialize → deserialize → fields stable.
        let reserialized = serde_json::to_string(&parsed).unwrap();
        let reparsed: SessionData = serde_json::from_str(&reserialized).unwrap();
        assert_eq!(reparsed.windows[0].tabs[0].format_id, "json");
        assert!(!reparsed.windows[0].tabs[0].editing_enabled);
        assert_eq!(
            reparsed.windows[0].tabs[0].active_schema_id.as_deref(),
            Some("package-json")
        );
        // Silence the unused mutable variable lint.
        let _ = session;
    }

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
}
