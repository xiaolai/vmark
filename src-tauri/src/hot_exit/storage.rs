//! Atomic storage operations for hot exit sessions
//!
//! Uses tmp + rename pattern to ensure atomic writes and data durability.

use super::dedup;
use super::session::SessionData;
use super::validation::validate_and_repair;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;
use tempfile::NamedTempFile;

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

    // Skip the entire write (tmp file + fsync + rename + parent fsync) when
    // the captured payload is byte-identical to the last successful write.
    // Hot-exit captures fire frequently during editing; deduping cuts SSD
    // wear and avoids a periodic I/O spike when nothing actually changed.
    //
    // Defensive: also verify the session file still exists before skipping.
    // Otherwise an external `rm` (or a manual `delete_session` from another
    // process) would leave the cache valid but the file missing, and the
    // next identical capture would silently never recreate the file.
    let payload_hash = dedup::hash_payload(&json);
    if !dedup::payload_differs_from_last(&payload_hash) {
        match tokio::fs::try_exists(&session_path).await {
            Ok(true) => return Ok(()),
            Ok(false) => {
                log::debug!("[HotExit] Session file missing despite cached hash — forcing rewrite");
                dedup::reset();
            }
            Err(e) => {
                log::warn!(
                    "[HotExit] try_exists check failed ({}); proceeding to write",
                    e
                );
                dedup::reset();
            }
        }
    }

    // Perform all blocking I/O in spawn_blocking to avoid blocking async executor
    tokio::task::spawn_blocking(move || {
        // Write to temporary file in same directory (ensures same filesystem)
        let tmp_dir = session_path.parent().ok_or("Session path has no parent")?;
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
                let backup_dir = backup_path.parent().ok_or("Backup path has no parent")?;
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
    .map_err(|e| format!("Task join error: {}", e))??;

    // Record only after the spawn_blocking write succeeded — otherwise a real
    // change could be silently lost if the next call sees the same content
    // as a partially-failed earlier attempt.
    dedup::record_written(payload_hash);
    Ok(())
}

/// Validate version, migrate if needed, and repair a session in one step.
/// Returns `Ok(None)` when the session's schema version is unsupported,
/// `Err` when migration fails, and `Ok(Some)` on success.
///
/// Used by the main-file arm of `read_session` so an unsupported version
/// or a migration failure can fall through to the backup file instead of
/// taking the user's recoverable backup off the table (audit #952).
pub(super) fn finalize_session(mut session: SessionData) -> Result<Option<SessionData>, String> {
    if !super::migration::can_migrate(session.version) {
        log::warn!(
            "[HotExit] Session version {} not supported, discarding",
            session.version
        );
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
    Ok(Some(session))
}

/// Delete session file (and backup) after successful restore
pub async fn delete_session(app: &tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(app)?;
    let backup_path = get_backup_session_path(app)?;

    delete_session_files(&session_path, &backup_path).await?;

    // Drop the cached payload hash so the next capture writes the file even
    // if its serialized payload is identical to the one we just deleted.
    dedup::reset();

    Ok(())
}

/// Remove the main session file and its backup. Path-based core of
/// [`delete_session`] so it can be unit-tested without an `AppHandle`.
///
/// A `NotFound` on either file is fine (nothing to delete). Any other failure
/// propagates — in particular a failed backup deletion must NOT be swallowed:
/// the main file is already gone by then, so a surviving `session.prev.json`
/// would let the restore path resurrect a session the caller deleted.
pub(super) async fn delete_session_files(
    session_path: &std::path::Path,
    backup_path: &std::path::Path,
) -> Result<(), String> {
    match tokio::fs::remove_file(session_path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to delete session: {}", e)),
    }

    match tokio::fs::remove_file(backup_path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log::error!("[HotExit] Failed to delete backup session: {}", e);
            return Err(format!("Failed to delete backup session: {}", e));
        }
    }

    Ok(())
}

// No sibling test file: every test that lived here followed the read ladder
// into `read_session.rs` when this file was split for the size gate. What
// remains — path resolution, the atomic write, deletion — is covered through
// `read_session.test.rs`, which drives them end to end.
