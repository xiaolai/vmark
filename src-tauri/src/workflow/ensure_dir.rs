//! `action/save-file` creates the parents its target needs — inside the
//! workspace, and nowhere else (#257).
//!
//! `commit.rs` anchored the WRITE to a directory descriptor. The mkdir that
//! runs before it was still `create_dir_all` on a path, and that is a second
//! resolution of the same name: an ancestor replaced with a symlink between
//! `sandbox::validate_path` and this call sent the whole tree outside the
//! workspace. The commit then refused — that half held — but the attacker had
//! already had directories built for them wherever the link pointed, which is
//! a filesystem write nobody asked for.
//!
//! On Unix the walk is therefore anchored the same way the commit is: open the
//! deepest EXISTING ancestor, prove it is inside the workspace by climbing
//! `..` from the descriptor, then create each missing component with
//! `mkdirat` and re-open it with `openat(O_DIRECTORY | O_NOFOLLOW)`. Every
//! step is relative to a descriptor this process holds, and `O_NOFOLLOW`
//! means a symlink planted at a name mid-walk fails the walk instead of
//! redirecting it.
//!
//! @coordinates-with actions.rs — `save_file`, the only caller
//! @coordinates-with dir_fd.rs — the descriptor type and the `..` walk
//! @coordinates-with commit.rs — the write that follows, anchored the same way
//! @module workflow::ensure_dir

use std::path::Path;

/// Create every missing directory above `target_parent`, refusing unless the
/// ancestor they are created under is inside `workspace_root`.
pub(super) fn create_parents_within(
    target_parent: &Path,
    workspace_root: &Path,
) -> Result<(), String> {
    create_parents_with(target_parent, workspace_root, || {})
}

#[cfg(unix)]
pub(in crate::workflow) use anchored::create_parents_with;

#[cfg(not(unix))]
pub(in crate::workflow) use fallback::create_parents_with;

#[cfg(unix)]
mod anchored {
    use super::super::dir_fd::{c_name, Dir};
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    /// [`super::create_parents_within`] with a seam: `between` runs in the
    /// window an attacker would need — after the ancestor is open and proved
    /// inside the workspace, before anything is created. It exists so
    /// `ensure_dir.test.rs` can drive that window deterministically;
    /// production passes `|| {}`.
    pub(in crate::workflow) fn create_parents_with(
        target_parent: &Path,
        workspace_root: &Path,
        between: impl FnOnce(),
    ) -> Result<(), String> {
        let (existing, missing) = split_at_deepest_existing(target_parent)?;
        let mut dir = Dir::open(&existing)?;
        let root = Dir::open(workspace_root)
            .map_err(|e| format!("cannot resolve the workspace root: {e}"))?;
        dir.assert_within(&root, &existing)?;

        between();

        for name in missing {
            let name = c_name(&name)?;
            dir.mkdir(&name)?;
            // Re-opened without following links: if the mkdir lost a race to
            // a symlink planted at that name, this fails rather than walking
            // through it. It is also what makes the NEXT component's mkdir
            // relative to a directory we hold.
            dir = dir.open_child(&name)?;
        }
        Ok(())
    }

    /// The deepest ancestor of `parent` that exists, and the components below
    /// it that have to be created, outermost first.
    ///
    /// `try_exists()` follows links, so a DANGLING link counts as missing — and
    /// then `mkdirat` sees `EEXIST` and `open_child` refuses it. Either way
    /// nothing is followed.
    ///
    /// `try_exists`, not `exists` (#539): the latter answers `false` for a
    /// component it could not STAT, so an ancestor the user cannot traverse
    /// read as missing and the walk climbed past it — out of the workspace,
    /// where `assert_within` refused with a containment message about a
    /// permission problem. The walk still fails, but now it says why.
    fn split_at_deepest_existing(parent: &Path) -> Result<(PathBuf, Vec<OsString>), String> {
        let mut missing: Vec<OsString> = Vec::new();
        let mut current = parent.to_path_buf();
        while !exists_or_explain(&current)? {
            let name = current
                .file_name()
                .ok_or_else(|| format!("{} has no directory to create", parent.display()))?;
            missing.push(name.to_os_string());
            current = current
                .parent()
                .ok_or_else(|| format!("{} has no existing ancestor", parent.display()))?
                .to_path_buf();
        }
        missing.reverse();
        Ok((current, missing))
    }

    /// Whether `path` exists, with any other stat failure reported as itself.
    fn exists_or_explain(path: &Path) -> Result<bool, String> {
        path.try_exists()
            .map_err(|e| format!("cannot examine {}: {e}", path.display()))
    }
}

#[cfg(not(unix))]
mod fallback {
    use std::path::Path;

    /// Windows has no `openat`/`mkdirat`, and is a best-effort platform here
    /// (`AGENTS.md`). The residual is stated rather than papered over: this
    /// resolves the path a second time, so an ancestor replaced between
    /// `sandbox::validate_path` and this call is followed, exactly as it was
    /// everywhere before #257.
    ///
    /// Closing it properly needs `NtCreateFile` with the parent's HANDLE in
    /// `OBJECT_ATTRIBUTES.RootDirectory` — the only Windows primitive that
    /// resolves a name relative to an open directory. That is an ntdll
    /// interface with no safe binding in this crate's dependency set, and
    /// nothing in this project can RUN a Windows test (`AGENTS.md`: the
    /// Windows leg cross-COMPILES only), so an unrunnable hand-rolled
    /// reimplementation of the Unix walk would be a claim, not a fix.
    ///
    /// What bounds it: the write that follows is still refused (`commit.rs`'s
    /// fallback re-checks containment immediately before committing), and the
    /// workflow engine ships default-off (`.claude/rules/60-ai-governance.md`
    /// §12), so reaching this line at all takes a user who enabled it.
    pub(in crate::workflow) fn create_parents_with(
        target_parent: &Path,
        _workspace_root: &Path,
        between: impl FnOnce(),
    ) -> Result<(), String> {
        between();
        std::fs::create_dir_all(target_parent).map_err(|e| {
            format!(
                "Failed to create directory {}: {}",
                target_parent.display(),
                e
            )
        })
    }
}

#[cfg(test)]
#[path = "ensure_dir.test.rs"]
mod tests;
