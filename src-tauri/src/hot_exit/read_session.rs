//! The read ladder: main file, then backup, with per-item salvage in between.
//!
//! Split out of `storage.rs` for the size gate. The ordering here is the whole
//! contract — strict parse, then salvage, then the backup — so it is worth
//! reading as one piece.
//!
//! @coordinates-with storage.rs — writing, deleting, and `finalize_session`
//! @coordinates-with salvage.rs — the per-item fallback

use super::salvage::{read_session_file_with_salvage, ReadSession};
use super::session::LoadedSession;
use super::session::SessionData;
use super::storage::{finalize_session, get_backup_session_path, get_session_path};

/// Try to read and parse a session file at the given path.
/// Returns Ok(None) if the file doesn't exist, Ok(Some) on success,
/// or Err on read/parse failure.
async fn try_read_session_file(path: &std::path::Path) -> Result<Option<SessionData>, String> {
    match read_session_file_with_salvage(path).await? {
        Some(ReadSession { session, .. }) => Ok(Some(session)),
        None => Ok(None),
    }
}

/// Read session from disk, falling back to backup if main file is corrupt,
/// at an unsupported version, or fails to migrate.
pub async fn read_session(app: &tauri::AppHandle) -> Result<Option<LoadedSession>, String> {
    let session_path = get_session_path(app)?;
    let backup_path = get_backup_session_path(app)?;
    read_session_from_paths(&session_path, &backup_path).await
}

/// The path-based core of [`read_session`], so the fallback ladder is testable
/// without an `AppHandle`. `storage.test.rs` used to carry its own copy of this
/// ladder and assert against the copy — which cannot catch a divergence.
///
/// The corrupt main file is deliberately left ON DISK: it is the only evidence
/// of what went wrong, and the frontend needs `recovered_from_backup` (audit
/// 20260803 §11) to quarantine it before a successful restore clears both.
async fn read_session_from_paths(
    session_path: &std::path::Path,
    backup_path: &std::path::Path,
) -> Result<Option<LoadedSession>, String> {
    // Try main session file first.
    //
    // The "unsupported version" and "migration failed" arms used to early-
    // return Ok(None) / propagate `?` — that meant a single bad main file
    // could shadow a perfectly migratable backup. Both now fall through so
    // the backup arm below gets a chance (audit #952).
    match read_session_file_with_salvage(session_path).await {
        Ok(Some(ReadSession {
            session,
            lossy_repair,
        })) => match finalize_session(session) {
            Ok(Some(s)) => {
                let loaded = LoadedSession::from_main(s);
                return Ok(Some(match lossy_repair {
                    // A salvaged main file keeps its original bytes on disk,
                    // exactly like the backup-substitution case, so the
                    // frontend can quarantine before the restore clears them.
                    Some(summary) => loaded.with_lossy_repair(summary),
                    None => loaded,
                }));
            }
            // Unsupported version (logged inside finalize_session) — fall through.
            Ok(None) => {}
            Err(e) => log::warn!("[HotExit] Main session migration failed ({e}), trying backup"),
        },
        // Main file doesn't exist — check backup before giving up.
        Ok(None) => {}
        Err(e) => log::warn!("[HotExit] Main session corrupt ({e}), trying backup"),
    }

    // Fall back to backup session. Reuse the same finalize pipeline as the
    // main arm (migrate + validate/repair) instead of reimplementing it, so
    // the recovery path can't drift from production migration/validation
    // logic. An unsupported version or migration failure on the backup leaves
    // nothing else to fall back to, so both collapse to a fresh session.
    match try_read_session_file(backup_path).await {
        Ok(Some(session)) => match finalize_session(session) {
            Ok(Some(s)) => {
                log::info!("[HotExit] Restored session from backup");
                Ok(Some(LoadedSession::from_backup(s)))
            }
            // Nothing else to fall back to — start fresh either way.
            Ok(None) => Ok(None),
            Err(e) => {
                log::error!("[HotExit] Backup session migration failed: {e}");
                Ok(None)
            }
        },
        Ok(None) => Ok(None),
        Err(e) => {
            log::error!("[HotExit] Backup session also failed: {e}");
            Ok(None) // Both files unusable — start fresh
        }
    }
}

#[cfg(test)]
#[path = "read_session.test.rs"]
mod tests;
