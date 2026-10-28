//! Atomic file write for the frontend save path.
//!
//! Purpose: temp-file + fsync + rename atomic write, exposed as the
//! `atomic_write_file` Tauri command.
//!
//! NOTE: `app_paths::atomic_write_file` is the sync variant for internal use
//! (workspace config, MCP port file). Both wrap the shared `atomic_replace`
//! core; this one is async for the frontend and carries frontend-only
//! validation and error semantics.
//!
//! Errors are [`CommandError`]s: a missing parent folder is `code:
//! "not-found"` with the directory in `detail.dir`, and every message
//! resolves through `t!`.
//!
//! WI-LX1.1: this command and `files::create::create_file_exclusive` let the
//! webview name a path, so both refuse the workspace-grant list — the folders
//! re-granted at the next launch. The path is RESOLVED ONCE and the check runs
//! on what it resolved to ([`WriteAt`]). On Unix the folder is then HELD open,
//! judged by identity, and written through (`files/write/anchored.rs`), so a
//! folder on the path swapped after the check cannot redirect the write. On
//! Windows the write stays path-based; that module states the residual.
//!
//! Three more guarantees hold at this boundary: a write takes a per-file lock
//! (`files/write/target_lock.rs`; Unix: held folder identity + entry name,
//! Windows: the target's canonical key) through publication, so an alias and
//! its referent never write at once; under that lock a save older than one
//! already published there is refused `conflict` / `detail.kind =
//! "superseded"` (`files/write/save_order.rs`); and `noReplace` publishes only if
//! nothing is at the target at the rename (`files/write/rename_excl.rs`,
//! `atomic_replace::atomic_create`), else `detail.kind = "target-exists"`.
//!
//! @coordinates-with workspace/grants/protect.rs — what counts as the list
//! @coordinates-with files/write/anchored.rs — the held-folder write (Unix)
//! @coordinates-with files/create.rs — the exclusive create, same guard
//! @coordinates-with src/services/persistence/saveToPath.ts — sends noReplace

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

#[cfg(unix)]
pub(crate) mod anchored;
mod failures;
pub(crate) mod lock_key;
#[cfg(all(test, unix))]
pub(crate) mod publish_hook;
#[cfg(unix)]
mod rename_excl;
mod save_order;
mod target_lock;

use failures::link_failure;
pub(crate) use failures::parent_missing;
#[cfg(unix)]
use failures::write_failed;
use save_order::ordered;
pub use save_order::SaveOrder;

/// How a save puts its file in place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Publish {
    /// Replace whatever is at the target (an ordinary save).
    Replace,
    /// Refuse if anything is at the target at the instant of publication
    /// (Save As to a distinct destination). Never degrades to a replace.
    NoReplace,
}

/// Where a checked write lands, as the list guard judges it: the resolved
/// path, and on Unix the folder held open for the write itself.
pub(crate) struct WriteAt<'a> {
    path: &'a std::path::Path,
    #[cfg(unix)]
    held: &'a anchored::HeldDir,
}

impl<'a> WriteAt<'a> {
    #[cfg(unix)]
    pub(crate) fn new(path: &'a std::path::Path, held: &'a anchored::HeldDir) -> Self {
        Self { path, held }
    }

    #[cfg(not(unix))]
    pub(crate) fn new(path: &'a std::path::Path) -> Self {
        Self { path }
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &std::path::Path {
        self.path
    }

    /// Refuse a write here that would land on the workspace-grant list: by
    /// path, and on Unix by the held folder's identity — the check that binds.
    pub(crate) fn refuse_grant_list<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> Result<(), CommandError> {
        crate::workspace::grants::refuse_list_write(app, self.path)?;
        #[cfg(unix)]
        if let Some(name) = self.path.file_name() {
            crate::workspace::grants::refuse_held_write(
                app,
                self.held.identity(),
                name,
                self.held.entry_identity(name),
            )?;
        }
        Ok(())
    }
}

/// [`write_ordered`] with no order — what every unordered write does.
#[cfg(test)]
pub(crate) fn write_checked(
    target: &std::path::Path,
    content: &str,
    publish: Publish,
    authorize: impl FnOnce(&WriteAt<'_>) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    write_ordered(target, content, publish, None, authorize)
}

/// [`write_checked`] with nothing to authorize, for tests needing no app.
#[cfg(test)]
pub(crate) fn atomic_write_file_sync(
    target: &std::path::Path,
    content: &str,
) -> Result<(), CommandError> {
    write_checked(target, content, Publish::Replace, |_| Ok(()))
}

/// Refuse what no write command accepts: a `..` component (defense-in-depth,
/// if the webview is compromised) or a relative path.
pub(crate) fn reject_unsafe_target(target: &std::path::Path) -> Result<(), CommandError> {
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
    Ok(())
}

/// The write core: validate `target`, resolve it ONCE to its referent, let
/// `authorize` judge where the write lands ([`WriteAt`]), and write exactly
/// there — never resolving the name again, so a link swapped in at it is
/// replaced by the rename, not followed.
///
/// The referent is resolved BEFORE choosing a directory: renaming the temp
/// file onto a symlink would replace the LINK and leave the real document
/// stale while the save reports success. The temp file goes in the
/// REFERENT's directory too, or the rename crosses filesystems.
///
/// A save with an `order` is refused `superseded`, under the file's lock,
/// when a save asked for after it already published here (`save_order.rs`).
pub(crate) fn write_ordered(
    target: &std::path::Path,
    content: &str,
    publish: Publish,
    order: Option<&SaveOrder>,
    authorize: impl FnOnce(&WriteAt<'_>) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    use crate::atomic_replace::resolve_link_target;

    reject_unsafe_target(target)?;
    let resolved = resolve_link_target(target).map_err(link_failure)?;
    let (Some(dir), Some(name)) = (resolved.parent(), resolved.file_name()) else {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.save.noParentDirectory"
        ));
    };
    #[cfg(unix)]
    {
        // A gone folder is a structured error: the frontend reads `code` +
        // `detail.dir` to route the user into Save As.
        #[cfg(test)]
        publish_hook::run_before_hold(name);
        let held = anchored::HeldDir::open(dir).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => parent_missing(dir),
            _ => write_failed(e),
        })?;
        // One write per file at a time, however it is named, keyed by the
        // folder actually held (a folder swapped after resolution cannot hand
        // two writers of one file two keys); held through the publication.
        let folder = held.identity().map_err(write_failed)?;
        let key = target_lock::held_entry_key(folder, name);
        let _one_writer = target_lock::lock(key.clone());
        authorize(&WriteAt::new(&resolved, &held))?;
        ordered(&key, order, target, || {
            held.publish(name, content.as_bytes(), publish)
                .map_err(|stage| failures::stage_failure(dir, target, stage))
        })
    }
    #[cfg(not(unix))]
    {
        let _ = name;
        let key = lock_key::target_key(&resolved);
        let _one_writer = target_lock::lock(key.clone());
        authorize(&WriteAt::new(&resolved))?;
        ordered(&key, order, target, || {
            write_resolved(target, &resolved, dir, content, publish)
        })
    }
}

/// Write `target`, whose links are already resolved, through its path
/// (Windows: no `openat`/`renameat` in std — see `files/write/anchored.rs`).
/// A refusal names `requested`, the path the caller asked for.
#[cfg(not(unix))]
fn write_resolved(
    requested: &std::path::Path,
    target: &std::path::Path,
    dir: &std::path::Path,
    content: &str,
    publish: Publish,
) -> Result<(), CommandError> {
    use crate::atomic_replace::{atomic_create, atomic_replace};
    if !dir.is_dir() {
        return Err(parent_missing(dir));
    }
    let bytes = content.as_bytes();
    match publish {
        Publish::Replace => atomic_replace(target, dir, bytes),
        Publish::NoReplace => atomic_create(target, dir, bytes),
    }
    .map_err(|e| failures::save_failure(requested, e))?;
    // Best-effort: the file itself is already synced and persisted.
    if let Ok(dir_file) = std::fs::File::open(dir) {
        if let Err(e) = dir_file.sync_all() {
            log::warn!(
                "Failed to sync parent directory {:?} after atomic write: {}",
                dir,
                e
            );
        }
    }
    Ok(())
}

/// Atomic file write (temp file, fsync, rename; async Tauri command variant).
/// Refuses the workspace-grant list, by the path as named AND by the referent
/// the write then lands on (`write_checked`).
///
/// `no_replace` (Save As to a distinct destination): publish only if nothing
/// is at the target at that instant; a file already there is a `conflict`
/// with `detail.kind = "target-exists"` and is left untouched.
///
/// `order`: when the save was asked for; one older than a save already
/// published to this file is refused `conflict` with `detail.kind =
/// "superseded"` (`files/write/save_order.rs`).
#[tauri::command]
pub async fn atomic_write_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    content: String,
    no_replace: Option<bool>,
    order: Option<SaveOrder>,
) -> Result<(), CommandError> {
    if let Some(order) = &order {
        save_order::validate(order)?;
    }
    let publish = if no_replace == Some(true) {
        Publish::NoReplace
    } else {
        Publish::Replace
    };
    tokio::task::spawn_blocking(move || {
        let target = std::path::Path::new(&path);
        crate::workspace::grants::refuse_list_write(&app, target)?;
        write_ordered(target, &content, publish, order.as_ref(), |at| {
            at.refuse_grant_list(&app)
        })
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
#[path = "write.test.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "write/publish.test.rs"]
mod publish_tests;
