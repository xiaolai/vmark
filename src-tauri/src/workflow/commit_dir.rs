//! The descriptor half of `action/save-file`'s commit (#257) — Unix only.
//!
//! `commit.rs` explains WHY; this is the how. The parent directory is opened
//! once — `dir_fd.rs` holds that type and the containment walk — and from then
//! on every step names that DESCRIPTOR rather than a path:
//!
//!   - containment is proved by walking `..` from the descriptor up to the
//!     workspace root's (`Dir::assert_within`);
//!   - the temp file is created by path — `NamedTempFile` brings the unique
//!     name, the RAII cleanup, and the permission/xattr preservation the
//!     shared writer performs — and is then CHECKED through the descriptor
//!     with `fstatat`: the same inode must be visible at that name. A path
//!     swapped before the create puts the temp somewhere else, and this is
//!     what notices, before a byte of the user's content is written;
//!   - the rename is `renameat` with the descriptor as BOTH operands, so the
//!     file lands in the validated directory whatever the path means by then.
//!
//! @coordinates-with commit.rs — the entry point and the non-Unix fallback
//! @coordinates-with dir_fd.rs — the descriptor type and the `..` walk
//! @coordinates-with ensure_dir.rs — creates the parents this then writes into
//! @coordinates-with atomic_replace.rs — the metadata preservation it shares
//! @module workflow::commit_dir

use super::dir_fd::{c_name, Dir};
use crate::atomic_replace::{preserve_target_permissions, preserve_target_xattrs};
use std::io::Write;
use std::path::Path;
use tempfile::NamedTempFile;

/// [`super::commit_inside_workspace`] with a seam.
///
/// `between` runs after the directory is open and proved inside the
/// workspace, and before the temp file is created — the exact window an
/// attacker would need. It exists so `commit.test.rs` can drive that
/// window deterministically; production passes `|| {}`.
pub(in crate::workflow) fn commit_with(
    target: &Path,
    workspace_root: &Path,
    bytes: &[u8],
    between: impl FnOnce(),
) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "no parent directory".to_string())?;
    let file_name = target
        .file_name()
        .ok_or_else(|| "no file name".to_string())?;
    let final_name = c_name(file_name)?;

    let dir = Dir::open(parent)?;
    let root =
        Dir::open(workspace_root).map_err(|e| format!("cannot resolve the workspace root: {e}"))?;
    dir.assert_within(&root, parent)?;

    between();

    let mut temp = NamedTempFile::new_in(parent)
        .map_err(|e| format!("cannot create a temp file in {}: {e}", parent.display()))?;
    let temp_name = c_name(
        temp.path()
            .file_name()
            .ok_or_else(|| "the temp file has no name".to_string())?,
    )?;
    // The one check the descriptor cannot make redundant: `new_in` took
    // the PATH, so this is where a directory swapped since the walk shows
    // up — as a temp file that is not the one this directory holds.
    if !dir.holds(&temp_name, temp.as_file())? {
        return Err(format!(
            "{} resolves outside the workspace",
            parent.display()
        ));
    }

    temp.write_all(bytes)
        .and_then(|()| temp.flush())
        .map_err(|e| format!("write failed: {e}"))?;
    // Metadata BEFORE the sync (#528). `sync_all` is what makes the inode
    // durable, so a mode or an xattr applied after it survived only until the
    // next crash: the rename below is made durable by the directory fsync, and
    // the file would then be at the target with the temp file's own 0600 and
    // none of the user's Finder tags.
    preserve_target_permissions(target, &temp);
    preserve_target_xattrs(target, &temp);
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("write failed: {e}"))?;

    // Past this point the temp file is ours to clean up: `keep` disarms
    // the RAII delete so the rename is the only thing that moves it.
    let (file, _path) = temp
        .keep()
        .map_err(|e| format!("cannot hand over the temp file: {}", e.error))?;
    drop(file);
    if let Err(e) = dir.rename(&temp_name, &final_name) {
        // The temp file holds the user's whole document and `keep()` has
        // already disarmed the RAII delete, so this unlink is the only thing
        // that removes it. Its failure is REPORTED, not discarded (#530/#535):
        // silently leaving private content beside the target is worse than the
        // rename failure that caused it, and the log line is the only record.
        if let Err(cleanup) = dir.unlink(&temp_name) {
            log::error!(
                "[workflow] a save to {} failed AND its temp file could not be removed: {cleanup}",
                target.display()
            );
            return Err(format!("{e}; the temp file was left behind: {cleanup}"));
        }
        return Err(e);
    }
    dir.sync();
    Ok(())
}
