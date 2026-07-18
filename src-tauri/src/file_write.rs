//! Atomic file write for the frontend save path.
//!
//! Purpose: temp-file + fsync + rename atomic write, exposed as the
//! `atomic_write_file` Tauri command. Extracted from `lib.rs` verbatim to
//! keep that file under the size gate.
//!
//! NOTE: A separate sync variant exists in `app_paths::atomic_write_file` for
//! internal use (workspace config, MCP port file). Both are thin wrappers
//! over the shared `atomic_replace` core; they stay separate commands because
//! this one is async for the frontend invoke path and carries frontend-only
//! validation and error semantics.

/// Sentinel prefix returned when the target's parent directory does not
/// exist (renamed/deleted externally). The frontend (`saveToPath.ts`) parses
/// this to route the user into the Save As flow. Keep in sync with
/// `PARENT_MISSING_PREFIX` in `src/utils/saveToPath.ts`.
pub const PARENT_MISSING_ERROR_PREFIX: &str = "PARENT_MISSING:";

/// Synchronous core of `atomic_write_file`. Extracted so it can be unit-tested
/// without spinning up a tokio runtime. Same semantics as the async wrapper.
///
/// Validation (path traversal, absolute path, parent-missing sentinel) and
/// the parent-directory sync are the frontend-specific parts; the actual
/// temp-file + fsync + rename is `atomic_replace::atomic_replace`, shared
/// with `app_paths::atomic_write_file`.
pub(crate) fn atomic_write_file_sync(
    target: &std::path::Path,
    content: &str,
) -> Result<(), String> {
    use crate::atomic_replace::{atomic_replace, AtomicReplaceError};

    // Defense-in-depth: reject path traversal to prevent writing outside
    // intended directories if the webview is compromised.
    if target
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(rust_i18n::t!("errors.core.pathTraversal").to_string());
    }

    if !target.is_absolute() {
        return Err(rust_i18n::t!("errors.core.pathNotAbsolute").to_string());
    }

    let dir = target.parent().ok_or("File path has no parent directory")?;

    // Surface a structured error when the parent directory is gone (e.g.,
    // renamed or deleted externally while the file was open). Without this
    // explicit check, NamedTempFile leaks a raw "No such file or directory
    // (os error 2)" with a tempfile name, which looks like VMark dropped
    // a temp file. The frontend matches the `PARENT_MISSING:` prefix to
    // route the user into the Save As flow.
    if !dir.is_dir() {
        return Err(format!("{}{}", PARENT_MISSING_ERROR_PREFIX, dir.display()));
    }

    atomic_replace(target, dir, content.as_bytes()).map_err(|e| match e {
        AtomicReplaceError::CreateTemp { source, .. } => {
            format!("Failed to create temp file: {}", source)
        }
        AtomicReplaceError::WriteTemp(e) => format!("Failed to write temp file: {}", e),
        AtomicReplaceError::FlushTemp(e) => format!("Failed to flush temp file: {}", e),
        AtomicReplaceError::SyncTemp(e) => format!("Failed to sync temp file: {}", e),
        AtomicReplaceError::Persist(e) => format!("Failed to persist file: {}", e),
    })?;

    // Sync parent directory for crash safety. Best-effort (the file itself is
    // already synced and persisted), but a failure here weakens the crash
    // guarantee — surface it in the log instead of swallowing it.
    if let Ok(dir_file) = std::fs::File::open(dir) {
        if let Err(e) = dir_file.sync_all() {
            log::warn!(
                "Failed to sync parent directory {} after atomic write: {}",
                dir.display(),
                e
            );
        }
    }

    Ok(())
}

/// Atomic file write using temp file + rename (async Tauri command variant).
///
/// Prevents data loss on crash by writing to a temporary file in the same
/// directory, flushing to disk, then atomically renaming over the target.
#[tauri::command]
pub async fn atomic_write_file(path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        atomic_write_file_sync(std::path::Path::new(&path), &content)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
#[path = "file_write.test.rs"]
mod tests;
