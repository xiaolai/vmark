//! Tests for `read_session.rs` — the main/salvage/backup read ladder.
//!
//! Split out of `storage.test.rs` alongside the module they cover (size gate).

use super::*;
use crate::hot_exit::session::*;
// The delete tests sit in this file because they share the ladder's fixtures;
// the function itself still lives in `storage`.
use crate::hot_exit::storage::delete_session_files;
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
            ui_state_by_instance: None,
            closed_tab_scopes: None,
            browser_session: None,
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
//
// These drive the REAL `read_session_from_paths` — the path-based core the
// `AppHandle`-taking `read_session` delegates to. They used to drive a
// hand-written copy of the same ladder living in this file, which asserted
// that the copy behaved, not that production did (audit 20260803 §11).
//
// `.map(|l| l.session)` where a test only cares about the payload; the
// provenance flag has its own section at the bottom.
// -----------------------------------------------------------------------

/// The payload half of the real loader, for the tests that predate the
/// provenance flag and assert only on session content.
async fn read_session_from_paths(
    session_path: &std::path::Path,
    backup_path: &std::path::Path,
) -> Result<Option<SessionData>, String> {
    Ok(super::read_session_from_paths(session_path, backup_path)
        .await?
        .map(|loaded| loaded.session))
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

// -----------------------------------------------------------------------
// Backup-substitution provenance (audit 20260803 §11)
//
// The substitution used to be silent, so the frontend could not tell a
// backup-served payload from a main-served one — and a successful restore
// then cleared BOTH files, destroying the corrupt main bytes unquarantined.
// -----------------------------------------------------------------------

#[tokio::test]
async fn a_backup_substitution_is_reported_and_leaves_the_corrupt_main_intact() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    const CORRUPT: &str = "{{{garbage";
    std::fs::write(&session_path, CORRUPT).unwrap();
    std::fs::write(
        &backup_path,
        serde_json::to_string_pretty(&make_valid_session()).unwrap(),
    )
    .unwrap();

    let loaded = super::read_session_from_paths(&session_path, &backup_path)
        .await
        .expect("the backup is usable")
        .expect("a session was served");

    assert!(
        loaded.recovered_from_backup,
        "the frontend cannot quarantine what it is not told about"
    );
    assert_eq!(loaded.session.vmark_version, "0.6.9-test");
    assert_eq!(
        std::fs::read_to_string(&session_path).unwrap(),
        CORRUPT,
        "the corrupt main file is the only evidence of the failure — reading \
         must not consume or repair it"
    );
}

#[tokio::test]
async fn a_usable_main_file_reports_no_substitution() {
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");

    std::fs::write(
        &session_path,
        serde_json::to_string_pretty(&make_valid_session()).unwrap(),
    )
    .unwrap();
    std::fs::write(
        &backup_path,
        serde_json::to_string_pretty(&make_valid_session()).unwrap(),
    )
    .unwrap();

    let loaded = super::read_session_from_paths(&session_path, &backup_path)
        .await
        .expect("the main file is usable")
        .expect("a session was served");

    assert!(
        !loaded.recovered_from_backup,
        "a clean read must not claim recovery — the frontend would quarantine \
         a perfectly good session file"
    );
}

#[tokio::test]
async fn a_missing_main_file_still_counts_as_a_substitution() {
    // No corrupt bytes to preserve here, but the frontend's quarantine branch
    // is the same one: the payload it holds did NOT come from session.json.
    let dir = TempDir::new().unwrap();
    let session_path = dir.path().join("session.json");
    let backup_path = dir.path().join("session.prev.json");
    std::fs::write(
        &backup_path,
        serde_json::to_string_pretty(&make_valid_session()).unwrap(),
    )
    .unwrap();

    let loaded = super::read_session_from_paths(&session_path, &backup_path)
        .await
        .expect("the backup is usable")
        .expect("a session was served");

    assert!(loaded.recovered_from_backup);
}

#[test]
fn the_inspect_payload_flattens_the_session_and_omits_a_false_flag() {
    // The wire shape the frontend salvage pass reads. `recovered_from_backup`
    // sits BESIDE the session's own fields, not under a wrapper key, because
    // `salvageSessionPayload` is handed the whole invoke result.
    let clean = serde_json::to_value(crate::hot_exit::commands::InspectedSession::from(
        LoadedSession::from_main(make_valid_session()),
    ))
    .expect("serializes");
    assert_eq!(clean["vmark_version"], "0.6.9-test");
    assert!(
        clean.get("recovered_from_backup").is_none(),
        "a false flag must be ABSENT, not null or false: {clean}"
    );

    let recovered = serde_json::to_value(crate::hot_exit::commands::InspectedSession::from(
        LoadedSession::from_backup(make_valid_session()),
    ))
    .expect("serializes");
    assert_eq!(recovered["recovered_from_backup"], serde_json::json!(true));
    assert_eq!(
        recovered["vmark_version"], "0.6.9-test",
        "the session's own fields must still be at the top level"
    );
}
