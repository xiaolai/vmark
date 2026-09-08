//! Security gates for frontend-supplied paths used by the
//! `open_*_in_new_window` commands (see `commands.rs`).

use std::path::Path;

use crate::canonical_path::canonical_string;

/// Validate that a frontend-supplied path is safe to extend into the fs
/// read scope. Rejects non-files, paths whose extension isn't in
/// `crate::supported_files::SUPPORTED_EXTENSIONS`, and paths that don't resolve on disk
/// — so a compromised webview can't escalate by invoking these commands
/// with arbitrary targets.
///
/// Canonicalization resolves symlinks so the registered-extension check
/// runs on the real target, not the link name (e.g. a `.md` symlink
/// pointing to `/etc/passwd` is rejected because the canonical target
/// isn't a registered VMark format).
///
/// Returns the CANONICAL path — the target this function judged — and that is
/// the ONLY value the caller passes on (#250): it is what gets granted, and it
/// is what goes in the window URL. The raw string is a NAME, and a name can be
/// re-pointed: granting it put whatever the link meant at grant time into the
/// scope with this check's blessing, and handing it to the window left every
/// later step — the frontend's read, its watcher, its save — resolving it
/// again. The judged target has nothing left to redirect.
pub(super) fn validate_openable_path(raw: &str) -> Result<String, String> {
    require_absolute(raw, "path")?;
    let canonical = Path::new(raw)
        .canonicalize()
        .map_err(|e| format!("invalid path '{raw}': {e}"))?;
    // WI-1B.5 — security gate now accepts every registered format's
    // extension (markdown + txt + json + yaml + toml + html + svg +
    // mmd + code-viewer set). Symlink rejection still works because
    // canonicalize() resolves the link first; we then re-check the
    // canonical path against `is_openable_supported`. A symlink whose
    // target lives outside the registered set fails this check.
    if !crate::is_openable_supported(&canonical) {
        return Err(format!("path '{raw}' is not an openable VMark file"));
    }
    canonical_string(&canonical, &format!("path '{raw}'"))
}

/// Validate that a frontend-supplied workspace root exists and is a directory
/// before it is used to build a trusted workspace-context window URL. A
/// compromised webview must not be able to open a "workspace" window scoped to
/// a non-directory (file, missing path, or symlink to one), so this rejects
/// anything that doesn't resolve to a real directory on disk.
///
/// Returns the canonical root, for the same reason `validate_openable_path`
/// does (#250): the window is scoped to the directory this judged, not to a
/// name that can mean something else by the time the window mounts.
pub(super) fn validate_workspace_root(raw: &str) -> Result<String, String> {
    require_absolute(raw, "workspace root")?;
    let canonical = Path::new(raw)
        .canonicalize()
        .map_err(|e| format!("invalid workspace root '{raw}': {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("workspace root '{raw}' is not a directory"));
    }
    canonical_string(&canonical, &format!("workspace root '{raw}'"))
}

/// A gate over frontend-supplied paths must not resolve them against the
/// PROCESS's working directory (audit #491/#493).
///
/// `Path::canonicalize` happily accepts a relative name and resolves it
/// against the cwd — which for a GUI launch is `/`, for a CLI launch is
/// wherever the user's shell happened to be, and for neither is anything the
/// webview chose. Both callers are invoked with absolute paths by every
/// shipped caller (the picker, recents, the session restore), so requiring one
/// costs nothing and removes an input class whose meaning depends on state
/// this process does not control.
fn require_absolute(raw: &str, label: &str) -> Result<(), String> {
    if Path::new(raw).is_absolute() {
        Ok(())
    } else {
        Err(format!("{label} '{raw}' is not absolute"))
    }
}

#[cfg(test)]
#[path = "path_validation.test.rs"]
mod tests;
