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
    use crate::atomic_replace::{atomic_replace, resolve_link_target};

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

    // Resolve the referent BEFORE choosing a directory. A save is a temp-file
    // + rename, and renaming onto a symlink replaces the LINK — the alias
    // stops being an alias and the real document keeps its old bytes, while
    // the save reports success (audit 20260906, B2). The temp file has to be
    // created in the REFERENT's directory too, or the rename crosses
    // filesystems and stops being atomic.
    let resolved = resolve_link_target(target).map_err(link_failure)?;
    let target = resolved.as_path();

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

/// Localize a symlink-resolution failure. A loop or an unreadable link is bad
/// input; a referent whose directory is gone is the same "the place you are
/// saving to no longer exists" condition as the missing-parent check below,
/// so it carries the same code and `detail.dir` that routes the frontend into
/// Save As.
fn link_failure(error: crate::atomic_replace::LinkResolveError) -> CommandError {
    use crate::atomic_replace::LinkResolveError as E;
    match error {
        E::ReferentParentMissing(dir) => localized_error!(
            ErrorCode::NotFound,
            "errors.save.parentMissing",
            dir = dir.display()
        )
        .with_detail(json!({ "dir": dir.to_string_lossy() })),
        E::TooManyLinks => localized_error!(ErrorCode::InvalidInput, "errors.save.symlinkLoop"),
        E::ReadLink(e) => localized_error!(
            ErrorCode::Io,
            "errors.save.writeFailed",
            detail = e.to_string()
        ),
    }
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

/// Atomically claim `path` for a document that does not have one yet, without
/// ever touching an existing file.
///
/// Returns `true` when this call created the (empty) file, `false` when
/// something was already there.
///
/// Batch Save All used to build `folder/Untitled-1.md` and hand it straight to
/// the ordinary overwrite writer, so choosing a folder that already contained
/// that name silently replaced a document the user never opened (audit
/// 20260906, F1). Checking existence first and then writing would only narrow
/// the window, not close it: two windows saving concurrently, or anything else
/// creating the file in between, still lose bytes. `create_new(true)` is
/// `O_EXCL` / `CREATE_NEW`, so the claim and the test are one operation the
/// kernel serializes.
///
/// The empty file it leaves behind is the reservation. The caller writes the
/// real contents over it through the ordinary save path, which is an overwrite
/// of a file this batch owns.
#[tauri::command]
pub async fn create_file_exclusive(path: String) -> Result<bool, CommandError> {
    tokio::task::spawn_blocking(move || create_file_exclusive_sync(std::path::Path::new(&path)))
        .await
        .map_err(|e| {
            localized_error!(
                ErrorCode::Internal,
                "errors.save.taskFailed",
                detail = e.to_string()
            )
        })?
}

/// Synchronous core of [`create_file_exclusive`], so it is testable without a
/// tokio runtime. Carries the same traversal/absolute-path validation as the
/// write command — this creates files, so it is the same trust boundary.
pub(crate) fn create_file_exclusive_sync(target: &std::path::Path) -> Result<bool, CommandError> {
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

    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
    {
        Ok(_) => Ok(true),
        // Already taken — including by a symlink, which `create_new` refuses
        // rather than following. The caller moves to the next candidate name.
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => {
            let dir = target.parent().unwrap_or(target);
            if e.kind() == std::io::ErrorKind::NotFound {
                return Err(localized_error!(
                    ErrorCode::NotFound,
                    "errors.save.parentMissing",
                    dir = dir.display()
                )
                .with_detail(json!({ "dir": dir.to_string_lossy() })));
            }
            Err(localized_error!(
                ErrorCode::Io,
                "errors.save.writeFailed",
                detail = e.to_string()
            ))
        }
    }
}

#[cfg(test)]
#[path = "file_write.test.rs"]
mod tests;
