//! Workspace-relative path guard (ADR-C4 services tier). Every path that
//! crosses the IPC boundary into the kernel (capture outputs, capture
//! inputs, adoption) resolves through here: absolute paths, `.`/`..`
//! segments, backslashes, and symlink escapes are all rejected — the
//! kernel never reads or writes outside its workspace root.

use std::path::{Component, Path, PathBuf};

/// Resolve `rel` against `root`, rejecting traversal and symlink escapes.
/// The target itself may not exist yet (capture writes it); its deepest
/// existing ancestor must canonicalize inside the canonical root.
pub fn resolve_workspace_rel(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("path is empty".into());
    }
    if rel.contains('\\') {
        return Err(format!("path contains backslash: {rel:?}"));
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("path must be workspace-relative: {rel:?}"));
    }
    for component in rel_path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("path contains traversal segment: {rel:?}")),
        }
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("workspace root not accessible: {e}"))?;
    let joined = canonical_root.join(rel_path);
    // Symlink-escape check on the deepest EXISTING ancestor (the file
    // itself may be about to be created).
    let mut probe = joined.clone();
    let escaped = loop {
        match probe.canonicalize() {
            Ok(real) => break !real.starts_with(&canonical_root),
            Err(_) => match probe.parent() {
                Some(parent) if parent.starts_with(&canonical_root) => {
                    probe = parent.to_path_buf();
                }
                _ => break false, // walked to the root itself
            },
        }
    };
    if escaped {
        return Err(format!("path escapes the workspace via a symlink: {rel:?}"));
    }
    Ok(joined)
}

#[cfg(test)]
#[path = "paths.test.rs"]
mod tests;
