//! Security gates for frontend-supplied paths used by the
//! `open_*_in_new_window` commands (see `commands.rs`).

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
/// Returns `Ok(())` when the raw path is acceptable. The raw string is
/// intentionally used downstream — the scope pattern must match what the
/// webview will pass to `readTextFile`, which is the same raw path.
pub(super) fn validate_openable_path(raw: &str) -> Result<(), String> {
    let canonical = std::path::Path::new(raw)
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
    Ok(())
}

/// Validate that a frontend-supplied workspace root exists and is a directory
/// before it is used to build a trusted workspace-context window URL. A
/// compromised webview must not be able to open a "workspace" window scoped to
/// a non-directory (file, missing path, or symlink to one), so this rejects
/// anything that doesn't resolve to a real directory on disk.
pub(super) fn validate_workspace_root(raw: &str) -> Result<(), String> {
    let canonical = std::path::Path::new(raw)
        .canonicalize()
        .map_err(|e| format!("invalid workspace root '{raw}': {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("workspace root '{raw}' is not a directory"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "path_validation.test.rs"]
mod tests;
