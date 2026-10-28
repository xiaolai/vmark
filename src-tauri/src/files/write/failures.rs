//! How a document save's failures reach the frontend.
//!
//! Purpose: the localized, structured errors `files::write` returns, split out
//! of that module (size gate). Every failure resolves through `t!` and keeps
//! the machine-readable half the frontend branches on: `detail.dir` for a
//! vanished folder (routes into Save As), `detail.stage` for a failed atomic
//! replacement, `detail.kind = "target-exists"` for a no-replace publication
//! that found a file already there. (`detail.kind = "superseded"` lives with
//! the order it enforces, in `save_order.rs`.)
//!
//! @coordinates-with files/write.rs — the write core these errors come from
//! @coordinates-with src/services/persistence/saveToPath.ts — reads code + detail
//! @module files/write/failures

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

/// The folder a save would land in is gone.
pub(crate) fn parent_missing(dir: &std::path::Path) -> CommandError {
    localized_error!(
        ErrorCode::NotFound,
        "errors.save.parentMissing",
        dir = dir.display()
    )
    .with_detail(json!({ "dir": dir.to_string_lossy() }))
}

/// The write itself failed with `e`.
#[cfg(unix)]
pub(crate) fn write_failed(e: std::io::Error) -> CommandError {
    localized_error!(
        ErrorCode::Io,
        "errors.save.writeFailed",
        detail = e.to_string()
    )
}

/// A no-replace publication found a file already at `target`; nothing was
/// replaced. `conflict`: the caller's view of the disk is stale.
pub(crate) fn target_exists(target: &std::path::Path) -> CommandError {
    localized_error!(
        ErrorCode::Conflict,
        "errors.save.targetExists",
        path = target.display()
    )
    .with_detail(json!({ "kind": "target-exists", "path": target.to_string_lossy() }))
}

/// The volume cannot publish without replacing. Refused rather than falling
/// back to a replacing rename, which is exactly what no-replace forbids.
/// Unix only: `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` works on
/// every Windows volume.
#[cfg(unix)]
pub(crate) fn no_replace_unsupported(target: &std::path::Path) -> CommandError {
    localized_error!(
        ErrorCode::Unsupported,
        "errors.save.noReplaceUnsupported",
        path = target.display()
    )
    .with_detail(json!({ "kind": "no-replace-unsupported" }))
}

/// Localize a held-folder write failure with the same `detail.stage` the
/// path-based core reports, so the frontend sees one error shape. A refused
/// no-replace publication is its own error, not a stage failure.
#[cfg(unix)]
pub(crate) fn stage_failure(
    dir: &std::path::Path,
    target: &std::path::Path,
    stage: super::anchored::Stage,
) -> CommandError {
    use super::anchored::Stage;
    let (stage, error) = match stage {
        Stage::CreateTemp(e) => ("create-temp", e),
        Stage::WriteTemp(e) => ("write-temp", e),
        Stage::SyncTemp(e) => ("sync-temp", e),
        Stage::Persist(e) => ("persist", e),
        Stage::TargetExists => return target_exists(target),
        Stage::NoReplaceUnsupported => return no_replace_unsupported(target),
    };
    let mut detail = json!({ "kind": "atomic-replace", "stage": stage });
    if stage == "create-temp" {
        detail["parent"] = json!(dir.display().to_string());
    }
    localized_error!(
        ErrorCode::Io,
        "errors.save.writeFailed",
        detail = error.to_string()
    )
    .with_detail(detail)
}

/// Localize a symlink-resolution failure. A loop or an unreadable link is bad
/// input; a referent whose directory is gone is the same "the place you are
/// saving to no longer exists" condition as the missing-parent check, so it
/// carries the same code and `detail.dir` that routes the frontend into
/// Save As.
pub(crate) fn link_failure(error: crate::atomic_replace::LinkResolveError) -> CommandError {
    use crate::atomic_replace::LinkResolveError as E;
    match error {
        E::ReferentParentMissing(dir) => parent_missing(&dir),
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
/// "the rename over the target failed". A no-replace publication refused
/// because a file is already there (`MoveFileExW` without
/// `MOVEFILE_REPLACE_EXISTING`) is reported as that.
#[cfg(not(unix))]
pub(crate) fn save_failure(
    target: &std::path::Path,
    error: crate::atomic_replace::AtomicReplaceError,
) -> CommandError {
    use crate::atomic_replace::AtomicReplaceError as E;
    if let E::Persist(persist) = &error {
        if persist.error.kind() == std::io::ErrorKind::AlreadyExists {
            return target_exists(target);
        }
    }
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
