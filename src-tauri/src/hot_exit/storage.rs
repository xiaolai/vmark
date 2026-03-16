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
            let warnings = validate_and_repair(&mut session);
            for warning in &warnings {
                eprintln!("[HotExit] Session repair: {}", warning);
            }
            return Ok(Some(session));
        }
        Ok(None) => {
            // Main file doesn't exist — check backup before giving up
        }
        Err(e) => {
            eprintln!("[HotExit] Main session corrupt ({}), trying backup", e);
        }
    }

    // Fall back to backup session
    let backup_path = get_backup_session_path(app)?;
    match try_read_session_file(&backup_path).await {
        Ok(Some(mut session)) => {
            eprintln!("[HotExit] Restored session from backup");
            let warnings = validate_and_repair(&mut session);
            for warning in &warnings {
                eprintln!("[HotExit] Session repair (backup): {}", warning);
            }
            Ok(Some(session))
        }
        Ok(None) => Ok(None),
        Err(e) => {
            eprintln!("[HotExit] Backup session also failed: {}", e);
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
            eprintln!("[HotExit] Failed to delete backup session: {}", e);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    
    // Note: These tests would require mocking AppHandle
    // For now, we test the logic with manual integration tests
}
