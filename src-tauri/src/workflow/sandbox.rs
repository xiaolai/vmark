//! Path sandboxing for workflow file actions.
//!
//! All file operations must resolve to paths within the workspace root.
//! Absolute paths and `..` traversal are rejected.

use std::path::{Path, PathBuf};

/// Validate and resolve a path relative to the workspace root.
///
/// Returns the canonicalized absolute path if it is within the workspace.
/// Rejects absolute paths, `..` traversal, and symlinks that escape.
pub fn validate_path(path: &str, workspace_root: &Path) -> Result<PathBuf, String> {
    let candidate = if Path::new(path).is_absolute() {
        // Absolute paths must still be under workspace root
        PathBuf::from(path)
    } else {
        workspace_root.join(path)
    };

    // Normalize by resolving `..` components without requiring the path to exist.
    // We use a manual normalization instead of canonicalize() because the path
    // may not exist yet (e.g., save-file to a new location).
    let normalized = normalize_path(&candidate);

    // Check that the normalized path is under the workspace root
    if !normalized.starts_with(workspace_root) {
        return Err(format!(
            "Path '{}' is outside the workspace root '{}'",
            path,
            workspace_root.display()
        ));
    }

    // If the path exists, resolve symlinks and re-check containment
    if normalized.exists() {
        let canonical = normalized
            .canonicalize()
            .map_err(|e| format!("Failed to resolve '{}': {}", path, e))?;
        let canonical_root = workspace_root
            .canonicalize()
            .unwrap_or_else(|_| workspace_root.to_path_buf());
        if !canonical.starts_with(&canonical_root) {
            return Err(format!(
                "Path '{}' resolves via symlink to '{}' which is outside the workspace",
                path,
                canonical.display()
            ));
        }
        return Ok(canonical);
    }

    // The target doesn't exist yet (e.g. save-file to a new location), but
    // an EXISTING ancestor could be a symlink pointing outside the
    // workspace — `workspace/links/new.txt` with `links -> /etc` passed the
    // lexical prefix check above while actually writing to /etc. Resolve
    // the deepest existing ancestor and re-check containment
    // (audit 20260612).
    let mut existing = normalized.clone();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    // Walk up only within the workspace root — if even the root doesn't
    // exist (tests, races), fall through to the lexical result below.
    while !existing.exists() && existing != workspace_root {
        match (existing.file_name(), existing.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name.to_os_string());
                existing = parent.to_path_buf();
            }
            _ => break,
        }
    }
    if existing.exists() {
        let canonical_ancestor = existing
            .canonicalize()
            .map_err(|e| format!("Failed to resolve '{}': {}", existing.display(), e))?;
        let canonical_root = workspace_root
            .canonicalize()
            .unwrap_or_else(|_| workspace_root.to_path_buf());
        if !canonical_ancestor.starts_with(&canonical_root) {
            return Err(format!(
                "Path '{}' resolves via symlink to '{}' which is outside the workspace",
                path,
                canonical_ancestor.display()
            ));
        }
        let mut rebuilt = canonical_ancestor;
        for name in tail.iter().rev() {
            rebuilt.push(name);
        }
        return Ok(rebuilt);
    }

    Ok(normalized)
}

/// Normalize a path by resolving `.` and `..` components without filesystem access.
fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                components.pop();
            }
            std::path::Component::CurDir => {}
            other => components.push(other),
        }
    }
    components.iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_relative_path_within_workspace() {
        let root = Path::new("/workspace/project");
        let result = validate_path("notes/readme.md", root);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            PathBuf::from("/workspace/project/notes/readme.md")
        );
    }

    #[test]
    fn test_absolute_path_within_workspace() {
        let root = Path::new("/workspace/project");
        let result = validate_path("/workspace/project/notes/readme.md", root);
        assert!(result.is_ok());
    }

    #[test]
    fn test_dotdot_traversal_rejected() {
        let root = Path::new("/workspace/project");
        let result = validate_path("../../etc/passwd", root);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside the workspace root"));
    }

    #[test]
    fn test_absolute_path_outside_workspace_rejected() {
        let root = Path::new("/workspace/project");
        let result = validate_path("/etc/passwd", root);
        assert!(result.is_err());
    }

    #[test]
    fn test_hidden_traversal_rejected() {
        let root = Path::new("/workspace/project");
        let result = validate_path("notes/../../../etc/shadow", root);
        assert!(result.is_err());
    }

    #[test]
    fn test_dot_component_normalized() {
        let root = Path::new("/workspace/project");
        let result = validate_path("./notes/./readme.md", root);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            PathBuf::from("/workspace/project/notes/readme.md")
        );
    }

    #[test]
    fn test_empty_path() {
        let root = Path::new("/workspace/project");
        let result = validate_path("", root);
        assert!(result.is_ok());
        // Empty path resolves to workspace root itself
        assert_eq!(result.unwrap(), PathBuf::from("/workspace/project"));
    }

    #[test]
    #[cfg(unix)]
    fn test_symlinked_dir_escape_rejected_for_nonexistent_target() {
        // audit 20260612: workspace/links -> outside; links/new.txt must not
        // pass validation even though the target file does not exist yet.
        let ws = tempfile::tempdir().expect("ws");
        let outside = tempfile::tempdir().expect("outside");
        let link = ws.path().join("links");
        std::os::unix::fs::symlink(outside.path(), &link).expect("symlink");

        let result = validate_path("links/new.txt", ws.path());
        assert!(
            result.is_err(),
            "expected escape rejection, got {:?}",
            result
        );
    }

    #[test]
    fn test_nonexistent_nested_path_within_workspace_allowed() {
        let ws = tempfile::tempdir().expect("ws");
        let result = validate_path("sub/dir/new.txt", ws.path());
        assert!(result.is_ok(), "expected ok, got {:?}", result);
    }
}
