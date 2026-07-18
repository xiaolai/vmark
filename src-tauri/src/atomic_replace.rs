//! Byte-oriented atomic file replacement core.
//!
//! Purpose: the single temp-file + fsync + rename implementation shared by
//! `app_paths::atomic_write_file` (sync, internal callers: workspace config,
//! MCP port file) and `file_write::atomic_write_file_sync` (frontend save
//! path). The two previously carried near-duplicate copies that drifted
//! (Windows persist fallback, permission preservation) and needed the same
//! permissions fix twice (Codex audit 20260718).
//!
//! Errors are returned as a typed stage enum so each caller keeps its exact,
//! externally-pinned error strings.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

/// Which stage of the atomic replacement failed. Callers map each variant to
/// their own user-facing error string.
#[derive(Debug)]
pub(crate) enum AtomicReplaceError {
    /// Creating the temp file in the target's parent directory failed.
    CreateTemp {
        parent: PathBuf,
        source: std::io::Error,
    },
    /// Writing the contents to the temp file failed.
    WriteTemp(std::io::Error),
    /// Flushing the temp file failed.
    FlushTemp(std::io::Error),
    /// Syncing the temp file to disk failed.
    SyncTemp(std::io::Error),
    /// The final rename over the target failed (after the Windows
    /// remove-then-retry fallback, where applicable).
    Persist(tempfile::PersistError),
}

/// Carry an existing target's permission bits onto the freshly created temp
/// file before `persist` renames it over the target. `NamedTempFile` creates
/// files with mode 0600 on Unix; without this, every atomic write would
/// silently reset the target's mode (dropping an exec bit or group/other
/// read). No-op when the target does not exist yet — new files keep the temp
/// file's default permissions. Best-effort: a permissions failure must not
/// abort the content write, so problems are logged, not returned.
#[cfg(unix)]
fn preserve_target_permissions(target: &Path, temp: &NamedTempFile) {
    match fs::metadata(target) {
        Ok(meta) => {
            if let Err(e) = fs::set_permissions(temp.path(), meta.permissions()) {
                log::warn!(
                    "Failed to preserve permissions of {:?} across atomic write: {}",
                    target,
                    e
                );
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log::warn!("Failed to read permissions of {:?}: {}", target, e);
        }
    }
}

#[cfg(not(unix))]
fn preserve_target_permissions(_target: &Path, _temp: &NamedTempFile) {
    // Windows temp files get normal default permissions; nothing to preserve.
}

/// Atomically replace `target` with `contents`.
///
/// `parent` must be `target`'s parent directory; callers resolve it
/// themselves so each keeps its own missing-parent error semantics.
///
/// `NamedTempFile` in the SAME directory → same-filesystem atomic rename, and
/// RAII cleanup: on any early `?` (write/sync/persist failure) the temp file
/// is removed on drop, so a mid-write error never leaks a temp file. The
/// contents are synced to disk before the rename so a crash can't expose a
/// zero-length file, and the existing target's permission bits are carried
/// over — the rename would otherwise replace them with the temp file's
/// restrictive 0600 on Unix.
pub(crate) fn atomic_replace(
    target: &Path,
    parent: &Path,
    contents: &[u8],
) -> Result<(), AtomicReplaceError> {
    let mut temp =
        NamedTempFile::new_in(parent).map_err(|source| AtomicReplaceError::CreateTemp {
            parent: parent.to_path_buf(),
            source,
        })?;

    temp.write_all(contents)
        .map_err(AtomicReplaceError::WriteTemp)?;

    temp.flush().map_err(AtomicReplaceError::FlushTemp)?;

    temp.as_file()
        .sync_all()
        .map_err(AtomicReplaceError::SyncTemp)?;

    preserve_target_permissions(target, &temp);

    // `persist` does the atomic rename over `target`. On Unix `rename`
    // REPLACES an existing target, so persist failing there is a genuine
    // error (permission, I/O, target-is-a-dir) — never "target exists". On
    // Windows `rename` fails if the target exists, so there we
    // remove-then-retry. Crucially, the remove-then-retry must be
    // Windows-only: doing it on Unix for an arbitrary persist error would
    // delete the user's existing file and then still fail to write the new
    // one (data loss). On any failure the returned temp file is dropped →
    // removed, so no temp leak.
    match temp.persist(target) {
        Ok(_) => Ok(()),
        #[cfg(windows)]
        Err(persist_err) => {
            let temp = persist_err.file;
            let _ = fs::remove_file(target);
            temp.persist(target)
                .map(|_| ())
                .map_err(AtomicReplaceError::Persist)
        }
        #[cfg(not(windows))]
        Err(persist_err) => Err(AtomicReplaceError::Persist(persist_err)),
    }
}

#[cfg(test)]
#[path = "atomic_replace.test.rs"]
mod tests;
