//! Byte-oriented atomic file replacement core.
//!
//! Purpose: the single temp-file + fsync + rename implementation shared by
//! `app_paths::atomic_write_file` (sync, internal callers: workspace config,
//! MCP port file) and `file_write::atomic_write_file_sync` (frontend save
//! path). The two previously carried near-duplicate copies that drifted
//! (Windows persist fallback, permission preservation) and needed the same
//! permissions fix twice (Codex audit 20260718).
//!
//! `resolve_link_target` lives here too, but is deliberately NOT called by
//! this core: following a symlink is a DOCUMENT-save policy (`file_write`),
//! and applying it to app-private writes would let a planted link redirect
//! them.
//!
//! Errors are returned as a typed stage enum so each caller keeps its exact,
//! externally-pinned error strings.

// `#[cfg(unix)]`: the only remaining user is `preserve_target_permissions`.
// The Windows branch used `fs::remove_file` until that destructive fallback
// was removed (audit 20260906, B1), so an ungated import is now dead there —
// and `-D warnings` makes dead an error on a platform local cargo never
// builds.
#[cfg(unix)]
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

// Symlink resolution lives in its own module (size gate) but stays reachable
// from here, which is where a reader looking for save-path policy will look.
pub(crate) use crate::link_target::{resolve_link_target, LinkResolveError};

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
    /// The final rename over the target failed. The existing target is left
    /// untouched — see the note on the `persist` call.
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

/// Carry an existing target's extended attributes onto the temp file before
/// the rename. Finder tags live in `com.apple.metadata:_kMDItemUserTags`, so
/// without this an ordinary save drops a tagged note out of the user's
/// tag-based organization — the rename installs a fresh inode that never had
/// them (audit 20260906, B3).
///
/// Best-effort, exactly like permission preservation: user metadata must never
/// cost the user their content write, so every failure is logged and the save
/// continues. Attributes are copied as they are found rather than filtered —
/// they are the ORIGINAL file's own metadata being carried across a
/// replacement of that same file, not privilege being granted from elsewhere.
#[cfg(target_os = "macos")]
fn preserve_target_xattrs(target: &Path, temp: &NamedTempFile) {
    let names = match xattr::list(target) {
        Ok(names) => names,
        // Nothing to carry over for a file that does not exist yet.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            log::warn!("Failed to list xattrs of {:?}: {}", target, e);
            return;
        }
    };

    for name in names {
        match xattr::get(target, &name) {
            Ok(Some(value)) => {
                if let Err(e) = xattr::set(temp.path(), &name, &value) {
                    log::warn!(
                        "Failed to preserve xattr {:?} of {:?} across atomic write: {}",
                        name,
                        target,
                        e
                    );
                }
            }
            // Raced away between listing and reading — nothing to carry.
            Ok(None) => {}
            Err(e) => {
                log::warn!("Failed to read xattr {:?} of {:?}: {}", name, target, e);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn preserve_target_xattrs(_target: &Path, _temp: &NamedTempFile) {
    // Finder tags are a macOS concept. Linux/Windows document metadata is not
    // carried today; see audit 20260906 B3 for the ACL follow-up.
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
/// zero-length file, and the existing target's permission bits and extended
/// attributes are carried over — the rename would otherwise replace them with
/// the temp file's restrictive 0600 on Unix and no metadata at all.
///
/// `target` is used verbatim. A caller saving a USER DOCUMENT should pass it
/// through [`resolve_link_target`] first, or a save through an alias replaces
/// the alias instead of the file it points at.
pub(crate) fn atomic_replace(
    target: &Path,
    parent: &Path,
    contents: &[u8],
) -> Result<(), AtomicReplaceError> {
    atomic_replace_with(target, parent, |w| w.write_all(contents))
}

/// Atomically replace `target` with whatever `write` emits.
///
/// The streaming form. `atomic_replace` is this with a slice, and everything
/// below the closure — permission and xattr preservation, fsync, the atomic
/// rename, RAII cleanup on any early return — is shared.
///
/// It exists for a producer that can write incrementally but would otherwise
/// have to materialize its whole output first: `lopdf`'s `Document::save_to`
/// takes a `Write`, so serializing a PDF through the byte form would hold a
/// second full copy of the document in memory purely to hand it over.
pub(crate) fn atomic_replace_with<F>(
    target: &Path,
    parent: &Path,
    write: F,
) -> Result<(), AtomicReplaceError>
where
    F: FnOnce(&mut NamedTempFile) -> std::io::Result<()>,
{
    let mut temp =
        NamedTempFile::new_in(parent).map_err(|source| AtomicReplaceError::CreateTemp {
            parent: parent.to_path_buf(),
            source,
        })?;

    // Written through the STILL-OPEN handle. Handing out the path instead — for
    // the producer to reopen by name — is a window in which the path can be
    // swapped for a symlink, which is what this API exists to avoid.
    write(&mut temp).map_err(AtomicReplaceError::WriteTemp)?;

    temp.flush().map_err(AtomicReplaceError::FlushTemp)?;

    temp.as_file()
        .sync_all()
        .map_err(AtomicReplaceError::SyncTemp)?;

    preserve_target_permissions(target, &temp);
    preserve_target_xattrs(target, &temp);

    // `persist` does the atomic rename over `target`, on EVERY platform. On
    // Unix `rename` replaces an existing target; on Windows `NamedTempFile`
    // calls `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` (tempfile 3.27.0
    // `file/imp/windows.rs`, reached with `overwrite: true` from
    // `NamedTempFile::persist`). So an existing target never needs removing
    // first, and a persist failure is a genuine error on both.
    //
    // There used to be a Windows-only remove-then-retry here, on the premise
    // that Windows `rename` fails when the target exists. That premise was
    // false — and the fallback was destructive (audit 20260906, B1): it fired
    // on ANY persist failure, including one caused by the SOURCE temp file
    // being held open without `FILE_SHARE_DELETE`. The `remove_file(target)`
    // then succeeded while both renames failed, so the user's document was
    // deleted and never rewritten. Even on the success path it opened a crash
    // window with no file at the target at all.
    //
    // On failure the returned temp file is dropped → removed, so no temp leak
    // and — the property that matters — the existing target is untouched.
    temp.persist(target)
        .map(|_| ())
        .map_err(AtomicReplaceError::Persist)
}

#[cfg(test)]
#[path = "atomic_replace.test.rs"]
mod tests;
