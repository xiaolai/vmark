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
//!
//! WI-14: this was the first command migrated to [`CommandError`]. The
//! parent-directory failure used to travel as a `"PARENT_MISSING:"` string
//! prefix that `saveToPath.ts` re-parsed — a cross-language contract held
//! together by a comment in each file asking the reader to keep the other in
//! sync. It is now `code: "not-found"` with the directory in `detail.dir`, and
//! every message here resolves through `t!` instead of being raw English that
//! `lint:i18n` could not see.

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

/// Synchronous core of `atomic_write_file`. Extracted so it can be unit-tested
/// without spinning up a tokio runtime. Same semantics as the async wrapper.
///
/// Validation (path traversal, absolute path, missing parent) and the
/// parent-directory sync are the frontend-specific parts; the actual
/// temp-file, fsync and rename are `atomic_replace::atomic_replace`, shared
/// with `app_paths::atomic_write_file`.
pub(crate) fn atomic_write_file_sync(
    target: &std::path::Path,
    content: &str,
) -> Result<(), CommandError> {
    use crate::atomic_replace::atomic_replace;

    // Defense-in-depth: reject path traversal to prevent writing outside
    // intended directories if the webview is compromised.
    if target
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.core.pathTraversal"
        ));
    }

    if !target.is_absolute() {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.core.pathNotAbsolute"
        ));
    }

    let dir = target.parent().ok_or_else(|| {
        localized_error!(ErrorCode::InvalidInput, "errors.save.noParentDirectory")
    })?;

    // Surface a structured error when the parent directory is gone (e.g.,
    // renamed or deleted externally while the file was open). Without this
    // explicit check, NamedTempFile leaks a raw "No such file or directory
    // (os error 2)" with a tempfile name, which looks like VMark dropped a temp
    // file. The frontend reads `code` + `detail.dir` to route the user into the
    // Save As flow.
    if !dir.is_dir() {
        return Err(localized_error!(
            ErrorCode::NotFound,
            "errors.save.parentMissing",
            dir = dir.display()
        )
        .with_detail(json!({ "dir": dir.to_string_lossy() })));
    }

    atomic_replace(target, dir, content.as_bytes()).map_err(save_failure)?;

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

/// Localize an atomic-replace failure while keeping the stage and the OS text
/// the `From` impl extracted. The user sees a translated sentence; the frontend
/// still gets `detail.stage` to tell "the temp file could not be created" from
/// "the rename over the target failed".
fn save_failure(error: crate::atomic_replace::AtomicReplaceError) -> CommandError {
    let converted = CommandError::from(error);
    let localized = localized_error!(
        ErrorCode::Io,
        "errors.save.writeFailed",
        detail = converted.message()
    );
    match converted.detail() {
        Some(detail) => localized.with_detail(detail.clone()),
        None => localized,
    }
}

/// Atomic file write using temp file + rename (async Tauri command variant).
///
/// Prevents data loss on crash by writing to a temporary file in the same
/// directory, flushing to disk, then atomically renaming over the target.
#[tauri::command]
pub async fn atomic_write_file(path: String, content: String) -> Result<(), CommandError> {
    tokio::task::spawn_blocking(move || {
        atomic_write_file_sync(std::path::Path::new(&path), &content)
    })
    .await
    .map_err(|e| {
        localized_error!(
            ErrorCode::Internal,
            "errors.save.taskFailed",
            detail = e.to_string()
        )
    })?
}

#[cfg(test)]
#[path = "file_write.test.rs"]
mod tests;
