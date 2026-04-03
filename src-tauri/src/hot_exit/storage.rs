//! Atomic storage operations for hot exit sessions
//!
//! Uses tmp + rename pattern to ensure atomic writes and data durability.

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;
use tempfile::NamedTempFile;
use super::session::SessionData;
use super::validation::validate_and_repair;

/// Get the hot exit session file path in app data directory
pub fn get_session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists
    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data.join("session.json"))
}

/// Get the backup session path
pub fn get_backup_session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data.join("session.prev.json"))
}

/// Write session atomically with tmp + rename pattern
pub async fn write_session_atomic(
    app: &tauri::AppHandle,
    session: &SessionData,
) -> Result<(), String> {
    let session_path = get_session_path(app)?;
    let backup_path = get_backup_session_path(app)?;

    // Serialize to JSON
    let json = serde_json::to_string_pretty(session)
        .map_err(|e| format!("JSON serialization failed: {}", e))?;

    // Perform all blocking I/O in spawn_blocking to avoid blocking async executor
    tokio::task::spawn_blocking(move || {
        // Write to temporary file in same directory (ensures same filesystem)
        let tmp_dir = session_path
            .parent()
            .ok_or("Session path has no parent")?;
        let mut tmp_file = NamedTempFile::new_in(tmp_dir)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;

        tmp_file
            .write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write temp file: {}", e))?;

        // Flush to disk (critical for durability)
        tmp_file
            .flush()
            .map_err(|e| format!("Failed to flush temp file: {}", e))?;

        tmp_file
            .as_file()
            .sync_all()
            .map_err(|e| format!("Failed to sync temp file: {}", e))?;

        // Backup existing session atomically (tmp + rename) to prevent
        // a corrupt backup if the app crashes mid-write.
        // Ignore NotFound errors — no existing session to backup is fine.
        match std::fs::read(&session_path) {
            Ok(existing_data) => {
                let backup_dir = backup_path
                    .parent()
                    .ok_or("Backup path has no parent")?;
                let mut backup_tmp = NamedTempFile::new_in(backup_dir)
                    .map_err(|e| format!("Failed to create backup temp file: {}", e))?;
                backup_tmp
                    .write_all(&existing_data)
                    .map_err(|e| format!("Failed to write backup temp file: {}", e))?;
                backup_tmp
                    .flush()
                    .map_err(|e| format!("Failed to flush backup temp file: {}", e))?;
                backup_tmp
                    .as_file()
                    .sync_all()
                    .map_err(|e| format!("Failed to sync backup temp file: {}", e))?;
                backup_tmp
                    .persist(&backup_path)
                    .map_err(|e| format!("Failed to persist backup: {}", e))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // No existing session to backup - this is fine
            }
            Err(e) => return Err(format!("Failed to read session for backup: {}", e)),
        }

        // Atomic rename (overwrites existing session.json)
        tmp_file
            .persist(&session_path)
            .map_err(|e| format!("Failed to persist session: {}", e))?;

        // Sync parent directory to ensure directory entry is persisted
        // Critical for crash safety - ensures the file appears in directory after crash
        if let Some(parent) = session_path.parent() {
            if let Ok(dir) = File::open(parent) {
                let _ = dir.sync_all(); // Best effort - ignore errors on non-Unix systems
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Try to read and parse a session file at the given path.
/// Returns Ok(None) if the file doesn't exist, Ok(Some) on success,
/// or Err on read/parse failure.
async fn try_read_session_file(
    path: &std::path::Path,
) -> Result<Option<SessionData>, String> {
    match tokio::fs::read_to_string(path).await {
        Ok(contents) => {
            let session: SessionData = serde_json::from_str(&contents)
                .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
            Ok(Some(session))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

/// Read session from disk, falling back to backup if main file is corrupt.
pub async fn read_session(
    app: &tauri::AppHandle,
) -> Result<Option<SessionData>, String> {
    let session_path = get_session_path(app)?;

    // Try main session file first
    match try_read_session_file(&session_path).await {
        Ok(Some(mut session)) => {
            if !super::migration::can_migrate(session.version) {
                log::warn!("[HotExit] Session version {} not supported, discarding", session.version);
                return Ok(None);
            }
            if super::migration::needs_migration(&session) {
                session = super::migration::migrate_session(session)
                    .map_err(|e| format!("Migration failed: {}", e))?;
            }
            let warnings = validate_and_repair(&mut session);
            for warning in &warnings {
                log::warn!("[HotExit] Session repair: {}", warning);
            }
            return Ok(Some(session));
        }
        Ok(None) => {
            // Main file doesn't exist — check backup before giving up
        }
        Err(e) => {
            log::warn!("[HotExit] Main session corrupt ({}), trying backup", e);
        }
    }

    // Fall back to backup session
    let backup_path = get_backup_session_path(app)?;
    match try_read_session_file(&backup_path).await {
        Ok(Some(mut session)) => {
            log::info!("[HotExit] Restored session from backup");
            if !super::migration::can_migrate(session.version) {
                log::warn!("[HotExit] Backup session version {} not supported, discarding", session.version);
                return Ok(None);
            }
            if super::migration::needs_migration(&session) {
                session = super::migration::migrate_session(session)
                    .map_err(|e| format!("Backup migration failed: {}", e))?;
            }
            let warnings = validate_and_repair(&mut session);
            for warning in &warnings {
                log::warn!("[HotExit] Session repair (backup): {}", warning);
            }
            Ok(Some(session))
        }
        Ok(None) => Ok(None),
        Err(e) => {
            log::error!("[HotExit] Backup session also failed: {}", e);
            Ok(None) // Both files unusable — start fresh
        }
    }
}

/// Delete session file (and backup) after successful restore
pub async fn delete_session(app: &tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(app)?;

    match tokio::fs::remove_file(&session_path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to delete session: {}", e)),
    }

    // Also clean up backup file — ignore NotFound, but log other failures
    // to avoid silently leaving stale backups that could cause wrong restores
    let backup_path = get_backup_session_path(app)?;
    match tokio::fs::remove_file(&backup_path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log::error!("[HotExit] Failed to delete backup session: {}", e);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
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
                    },
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
    /// This mirrors the logic in read_session() without requiring AppHandle.
    async fn read_session_from_paths(
        session_path: &std::path::Path,
        backup_path: &std::path::Path,
    ) -> Result<Option<SessionData>, String> {
        // Try main session file first
        match try_read_session_file(session_path).await {
            Ok(Some(mut session)) => {
                let _warnings = validate_and_repair(&mut session);
                return Ok(Some(session));
            }
            Ok(None) => {
                // Main file doesn't exist — check backup
            }
            Err(_e) => {
                // Main session corrupt — try backup
            }
        }

        // Fall back to backup session
        match try_read_session_file(backup_path).await {
            Ok(Some(mut session)) => {
                let _warnings = validate_and_repair(&mut session);
                Ok(Some(session))
            }
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
        assert!(data.is_some(), "Should restore from backup when main is missing");
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
}
