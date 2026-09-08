//! The commit half of `action/save-file` (#257): put the bytes in the
//! directory the sandbox VALIDATED, not at the path it was named by.
//!
//! `sandbox::validate_path` judges a path, and a path can be redirected — an
//! ancestor replaced by a symlink after the check carries the write out of
//! the workspace. Re-resolving the parent on the writing thread shrank that
//! window from "across two awaits" to "a few adjacent syscalls"; it did not
//! close it, because `NamedTempFile::new_in` and the rename each resolve the
//! path again.
//!
//! On Unix the write is therefore anchored to a DIRECTORY DESCRIPTOR, in
//! `commit_dir.rs`: the parent is opened once, containment is proved by
//! walking `..` from that descriptor, and the temp file and the rename are
//! both resolved through it. `ensure_dir.rs` does the same for the parents
//! that have to be CREATED first, so the whole save is one anchored sequence.
//!
//! Off Unix the fallback below keeps the round-1 behaviour, and its residual
//! is stated at the code site rather than implied by its absence.
//!
//! @coordinates-with actions.rs — `save_file`, the only caller
//! @coordinates-with commit_dir.rs — the Unix implementation
//! @coordinates-with ensure_dir.rs — the parents created before this runs
//! @module workflow::commit

use std::path::Path;

/// Atomically put `bytes` at `target`, refusing unless the directory it
/// lands in is inside `workspace_root`.
pub(super) fn commit_inside_workspace(
    target: &Path,
    workspace_root: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    commit_with(target, workspace_root, bytes, || {})
}

#[cfg(unix)]
pub(super) use super::commit_dir::commit_with;

#[cfg(not(unix))]
pub(super) use fallback::commit_with;

#[cfg(not(unix))]
mod fallback {
    use crate::atomic_replace::{atomic_replace, AtomicReplaceError};
    use std::path::Path;

    /// Windows has no `renameat`, and is a best-effort platform here. The
    /// parent is resolved and checked on the writing thread, immediately
    /// before the commit — the round-1 behaviour, kept.
    ///
    /// **The residual, stated (#257).** This is still check-then-commit: the
    /// containment check reads `canonical_parent`, and `atomic_replace` then
    /// resolves that path AGAIN to create its temp file and to rename over the
    /// target. A directory replaced with a junction in between is followed.
    /// The window is a few adjacent syscalls rather than "across two awaits",
    /// but it is not closed.
    ///
    /// It is not closed because the primitive that would close it is out of
    /// reach here. `renameat`'s Windows counterpart is `NtCreateFile` with the
    /// parent's HANDLE in `OBJECT_ATTRIBUTES.RootDirectory` — the only Windows
    /// call that resolves a name relative to an open directory. It is an ntdll
    /// interface with no safe binding in this crate's dependency set;
    /// `MoveFileEx`/`ReplaceFile` make the RENAME atomic but still take paths,
    /// so they would not move this. And nothing in this project can RUN a
    /// Windows test — the Windows leg cross-COMPILES only (`AGENTS.md`) — so
    /// hand-rolling that sequence would ship an unverifiable claim in the
    /// exact place a wrong one silently writes a user's file elsewhere.
    ///
    /// What bounds it: an attacker needs write access to an ancestor of the
    /// user's own workspace, and the workflow engine ships default-off
    /// (`.claude/rules/60-ai-governance.md` §12).
    pub(in crate::workflow) fn commit_with(
        target: &Path,
        workspace_root: &Path,
        bytes: &[u8],
        between: impl FnOnce(),
    ) -> Result<(), String> {
        let parent = target
            .parent()
            .ok_or_else(|| "no parent directory".to_string())?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|e| format!("cannot resolve {}: {}", parent.display(), e))?;
        let canonical_root = workspace_root
            .canonicalize()
            .map_err(|e| format!("cannot resolve the workspace root: {}", e))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err(format!(
                "{} resolves to {}, outside the workspace",
                parent.display(),
                canonical_parent.display()
            ));
        }
        between();
        let file_name = target
            .file_name()
            .ok_or_else(|| "no file name".to_string())?;
        let canonical_target = canonical_parent.join(file_name);
        atomic_replace(&canonical_target, &canonical_parent, bytes).map_err(describe)
    }

    fn describe(e: AtomicReplaceError) -> String {
        match e {
            AtomicReplaceError::CreateTemp { parent, source } => {
                format!(
                    "cannot create a temp file in {}: {source}",
                    parent.display()
                )
            }
            AtomicReplaceError::WriteTemp(e) => format!("write failed: {e}"),
            AtomicReplaceError::FlushTemp(e) => format!("flush failed: {e}"),
            AtomicReplaceError::SyncTemp(e) => format!("sync failed: {e}"),
            AtomicReplaceError::Persist(e) => format!("rename failed: {}", e.error),
        }
    }
}

#[cfg(test)]
#[path = "commit.test.rs"]
mod tests;
