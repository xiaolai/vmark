//! Tests for the sibling module (extracted to keep the production
//! file under the size gate; included via `#[path]`).

use super::*;
use crate::hot_exit::session::*;
use tempfile::TempDir;

/// Create a valid minimal SessionData for testing.
fn make_valid_session() -> SessionData {
    SessionData {
        version: SCHEMA_VERSION,
        timestamp: chrono::Utc::now().timestamp(),
        vmark_version: "0.6.9-test".to_string(),
        windows: vec![WindowState {
            window_label: "main".to_string(),
            is_main_window: true,
            active_tab_id: Some("tab-1".to_string()),
            tabs: vec![TabState {
                id: "tab-1".to_string(),
                file_path: Some("/tmp/test.md".to_string()),
                title: "Test".to_string(),
                is_pinned: false,
                document: DocumentState {
                    content: "# Hello".to_string(),
                    saved_content: "# Hello".to_string(),
                    is_dirty: false,
                    is_missing: false,
                    is_divergent: false,
                    line_ending: "\n".to_string(),
                    cursor_info: None,
                    last_modified_timestamp: None,
                    is_untitled: false,
                    untitled_number: None,
                    is_read_only: false,
                    undo_history: Vec::new(),
                    redo_history: Vec::new(),
                    mode: None,
                    hard_break_style: None,
                    last_disk_content: None,
                },
                format_id: "markdown".to_string(),
                editing_enabled: true,
                active_schema_id: None,
            }],
            ui_state: UiState {
                sidebar_visible: true,
                sidebar_width: 260,
                outline_visible: false,
                sidebar_view_mode: "files".to_string(),
                status_bar_visible: true,
                source_mode_enabled: false,
                focus_mode_enabled: false,
                typewriter_mode_enabled: false,
                terminal_visible: false,
                terminal_height: 250,
            },
            geometry: None,
            workspace_instance_ids: Vec::new(),
            active_workspace_instance_id: None,
            workspace_instances: Vec::new(),
        }],
        workspace: None,
    }
}

// -----------------------------------------------------------------------
// try_read_session_file tests (private fn, accessible from same module)
// -----------------------------------------------------------------------

#[tokio::test]
async fn try_read_valid_session_file() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session.json");
    let session = make_valid_session();
    let json = serde_json::to_string_pretty(&session).unwrap();
    std::fs::write(&path, &json).unwrap();

    let result = try_read_session_file(&path).await;
    assert!(result.is_ok());
    let data = result.unwrap();
    assert!(data.is_some());
    assert_eq!(data.unwrap().vmark_version, "0.6.9-test");
}

#[tokio::test]
async fn try_read_nonexistent_file_returns_none() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("does-not-exist.json");

    let result = try_read_session_file(&path).await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[tokio::test]
async fn try_read_corrupted_json_returns_error() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session.json");
    std::fs::write(&path, "{{{broken json!!!").unwrap();

    let result = try_read_session_file(&path).await;
    assert!(result.is_err());
    let err_msg = result.unwrap_err();
    assert!(
        err_msg.contains("Failed to parse"),
        "Error message should mention parse failure: {}",
        err_msg
    );
}

#[tokio::test]
async fn try_read_empty_file_returns_error() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session.json");
    std::fs::write(&path, "").unwrap();

    let result = try_read_session_file(&path).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn try_read_valid_json_but_wrong_schema_returns_error() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session.json");
    // Valid JSON but missing required fields
    std::fs::write(&path, r#"{"foo": "bar"}"#).unwrap();

    let result = try_read_session_file(&path).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn try_read_null_json_returns_error() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session.json");
    std::fs::write(&path, "null").unwrap();

    let result = try_read_session_file(&path).await;
    assert!(result.is_err());
}

// -----------------------------------------------------------------------
// Fallback logic tests
// These test the read_session fallback pattern by exercising
// try_read_session_file against session.json and session.prev.json
// in the same way read_session does (without needing AppHandle).
// -----------------------------------------------------------------------

/// Simulate the read_session fallback logic using direct file paths.
/// This mirrors the logic in read_session() without requiring AppHandle —
/// in particular it uses the same finalize_session pipeline so the version /
/// migration fall-through introduced for audit #952 is testable here.
async fn read_session_from_paths(
    session_path: &std::path::Path,
    backup_path: &std::path::Path,
) -> Result<Option<SessionData>, String> {
    // Try main session file first
    match try_read_session_file(session_path).await {
        Ok(Some(session)) => match finalize_session(session) {
            Ok(Some(s)) => return Ok(Some(s)),
            Ok(None) | Err(_) => {
                // Unsupported version or migration failure — fall through
                // to backup arm, matching the production behavior.
            }
        },
        Ok(None) => {
            // Main file doesn't exist — check backup
        }
        Err(_e) => {
            // Main session corrupt — try backup
        }
    }

    // Fall back to backup session — mirror production by running the
    // backup through the same finalize_session pipeline (migrate +
    // validate/repair), so backup migration and unsupported-version
    // behavior are actually exercised by these tests.
    match try_read_session_file(backup_path).await {
        Ok(Some(session)) => match finalize_session(session) {
            Ok(Some(s)) => Ok(Some(s)),
            Ok(None) | Err(_) => Ok(None),
        },
        Ok(None) => Ok(None),
        Err(_e) => {
            Ok(None) // Both files unusable — start fresh
        }
    }
}

#[tokio::test]
async fn fallback_to_backup_when_main_is_corrupted() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Write corrupted main session
    std::fs::write(&session_path, "{{{garbage").unwrap();

    // Write valid backup session
    let session = make_valid_session();
    let json = serde_json::to_string_pretty(&session).unwrap();
    std::fs::write(&backup_path, &json).unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    let data = result.unwrap();
    assert!(data.is_some(), "Should restore from backup");
    assert_eq!(data.unwrap().vmark_version, "0.6.9-test");
}

#[tokio::test]
async fn fallback_to_backup_when_main_is_missing() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Main file does not exist
    // Write valid backup
    let session = make_valid_session();
    let json = serde_json::to_string_pretty(&session).unwrap();
    std::fs::write(&backup_path, &json).unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    let data = result.unwrap();
    assert!(
        data.is_some(),
        "Should restore from backup when main is missing"
    );
}

#[tokio::test]
async fn returns_fresh_session_when_both_files_corrupted() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Both files corrupted
    std::fs::write(&session_path, "NOT VALID JSON").unwrap();
    std::fs::write(&backup_path, "ALSO NOT VALID").unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    assert!(
        result.unwrap().is_none(),
        "Should return None (fresh session) when both files are corrupted"
    );
}

#[tokio::test]
async fn returns_fresh_session_when_both_files_missing() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Neither file exists
    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    assert!(
        result.unwrap().is_none(),
        "Should return None when no session files exist"
    );
}

#[tokio::test]
async fn prefers_main_over_backup_when_both_valid() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Write main with specific version
    let mut main_session = make_valid_session();
    main_session.vmark_version = "main-version".to_string();
    std::fs::write(
        &session_path,
        serde_json::to_string_pretty(&main_session).unwrap(),
    )
    .unwrap();

    // Write backup with different version
    let mut backup_session = make_valid_session();
    backup_session.vmark_version = "backup-version".to_string();
    std::fs::write(
        &backup_path,
        serde_json::to_string_pretty(&backup_session).unwrap(),
    )
    .unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    let data = result.unwrap().unwrap();
    assert_eq!(
        data.vmark_version, "main-version",
        "Should prefer main session over backup"
    );
}

#[tokio::test]
async fn returns_fresh_when_main_corrupt_and_backup_missing() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Main is corrupt, backup doesn't exist
    std::fs::write(&session_path, "corrupted!").unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    assert!(
        result.unwrap().is_none(),
        "Should return None when main is corrupt and backup is missing"
    );
}

#[tokio::test]
async fn returns_fresh_when_main_missing_and_backup_corrupt() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Main doesn't exist, backup is corrupt
    std::fs::write(&backup_path, "not json").unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    assert!(
        result.unwrap().is_none(),
        "Should return None when main is missing and backup is corrupt"
    );
}

#[tokio::test]
async fn backup_with_invalid_schema_returns_fresh() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Main doesn't exist
    // Backup has valid JSON but wrong schema
    std::fs::write(&backup_path, r#"{"version": 1, "data": "wrong"}"#).unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    assert!(
        result.unwrap().is_none(),
        "Should return None when backup has wrong schema"
    );
}

#[tokio::test]
async fn fallback_to_backup_when_main_has_unsupported_version() {
    // Audit #952 regression: a main session at a too-new schema version
    // used to take the user's recoverable backup off the table by
    // returning Ok(None) instead of falling through. The fix routes the
    // unsupported-version arm into the backup branch.
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Main has version SCHEMA_VERSION + 1 (future, unmigratable).
    let mut future_main = make_valid_session();
    future_main.version = SCHEMA_VERSION + 1;
    future_main.vmark_version = "main-future".to_string();
    std::fs::write(
        &session_path,
        serde_json::to_string_pretty(&future_main).unwrap(),
    )
    .unwrap();

    // Backup at current schema, fully valid.
    let mut backup = make_valid_session();
    backup.vmark_version = "backup-current".to_string();
    std::fs::write(&backup_path, serde_json::to_string_pretty(&backup).unwrap()).unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    let data = result.unwrap();
    assert!(
        data.is_some(),
        "Expected backup to be restored when main is at unsupported version"
    );
    assert_eq!(
        data.unwrap().vmark_version,
        "backup-current",
        "Expected backup session contents, not main"
    );
}

#[tokio::test]
async fn backup_at_old_version_is_migrated_during_fallback() {
    // Audit: the backup arm previously reimplemented migration; the test
    // helper skipped finalize_session entirely so backup migration was
    // never covered. Now that both route through finalize_session, an
    // older-but-migratable backup must come back migrated to the current
    // schema (proving migration runs on the recovery path).
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Main is corrupt.
    std::fs::write(&session_path, "garbage").unwrap();

    // Backup is a valid current-schema session serialized at version 1.
    // finalize_session must migrate it forward to SCHEMA_VERSION.
    let mut old_backup = make_valid_session();
    old_backup.version = 1;
    old_backup.vmark_version = "old-backup".to_string();
    std::fs::write(
        &backup_path,
        serde_json::to_string_pretty(&old_backup).unwrap(),
    )
    .unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    let data = result.unwrap().expect("backup should be restored");
    assert_eq!(
        data.version, SCHEMA_VERSION,
        "backup must be migrated forward"
    );
    assert_eq!(data.vmark_version, "old-backup");
}

#[tokio::test]
async fn backup_at_unsupported_version_returns_fresh() {
    // A backup at a too-new schema version is unmigratable and there is no
    // further fallback — finalize_session returns Ok(None) and the helper
    // collapses to a fresh session.
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    std::fs::write(&session_path, "garbage").unwrap();

    let mut future_backup = make_valid_session();
    future_backup.version = SCHEMA_VERSION + 1;
    std::fs::write(
        &backup_path,
        serde_json::to_string_pretty(&future_backup).unwrap(),
    )
    .unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(
        result.unwrap().is_none(),
        "unsupported backup version must collapse to a fresh session"
    );
}

#[tokio::test]
async fn corrupted_main_falls_back_to_backup_with_repairs() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    // Main is corrupted
    std::fs::write(&session_path, "garbage").unwrap();

    // Backup has a session with an invalid active_tab_id (needs repair)
    let mut session = make_valid_session();
    session.windows[0].active_tab_id = Some("nonexistent-tab".to_string());
    std::fs::write(
        &backup_path,
        serde_json::to_string_pretty(&session).unwrap(),
    )
    .unwrap();

    let result = read_session_from_paths(&session_path, &backup_path).await;
    assert!(result.is_ok());
    let data = result.unwrap().unwrap();
    // validate_and_repair should fix the active_tab_id
    assert_eq!(
        data.windows[0].active_tab_id,
        Some("tab-1".to_string()),
        "Backup session should be repaired during fallback"
    );
}

#[tokio::test]
async fn delete_session_files_removes_main_and_backup() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");
    std::fs::write(&session_path, "{}").unwrap();
    std::fs::write(&backup_path, "{}").unwrap();

    delete_session_files(&session_path, &backup_path)
        .await
        .unwrap();

    assert!(!session_path.exists(), "main session must be removed");
    assert!(!backup_path.exists(), "backup session must be removed");
}

#[tokio::test]
async fn delete_session_files_tolerates_missing_files() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");
    // Neither file exists — deletion is a no-op, not an error.
    delete_session_files(&session_path, &backup_path)
        .await
        .unwrap();
}

#[tokio::test]
async fn delete_session_files_errors_when_backup_cannot_be_removed() {
    // Regression: if the main session is deleted but the backup cannot be,
    // delete must fail loudly so a stale session.prev.json can't resurrect a
    // session the caller deleted. A directory at the backup path makes
    // remove_file fail with a non-NotFound error.
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");
    std::fs::write(&session_path, "{}").unwrap();
    std::fs::create_dir(&backup_path).unwrap();

    let result = delete_session_files(&session_path, &backup_path).await;

    assert!(
        result.is_err(),
        "backup deletion failure must propagate as an error"
    );
    assert!(!session_path.exists(), "main session was still removed");
}
