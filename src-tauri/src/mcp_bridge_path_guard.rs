//! MCP bridge path guard.
//!
//! The frontend first applies the pure string policy, then calls this command
//! before bridge file reads/writes. This command resolves symlinks for existing
//! targets and for the deepest existing ancestor of new targets, closing the
//! classic `workspace/link -> /etc` escape.

use std::path::{Component, Path, PathBuf};

fn has_parent_segment(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn normalize_without_parent(path: &Path) -> PathBuf {
    path.components()
        .filter(|component| !matches!(component, Component::CurDir))
        .collect()
}

fn deepest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = path.to_path_buf();
    loop {
        if current.exists() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn canonical_roots(allowed_roots: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    for raw in allowed_roots {
        if raw.is_empty() {
            continue;
        }
        let root = Path::new(raw);
        if !root.is_absolute() {
            return Err("Allowed root must be absolute".to_string());
        }
        if has_parent_segment(root) {
            return Err("Allowed root must not contain '..' segments".to_string());
        }
        roots.push(
            root.canonicalize()
                .map_err(|e| format!("Failed to resolve allowed root '{}': {e}", raw))?,
        );
    }
    if roots.is_empty() {
        return Err("No workspace or open document to scope this path to".to_string());
    }
    Ok(roots)
}

fn ensure_within_any_root(candidate: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if roots.iter().any(|root| candidate.starts_with(root)) {
        return Ok(());
    }
    Err("Path is outside the workspace and open documents".to_string())
}

pub(crate) fn validate_mcp_bridge_path(
    file_path: &str,
    allowed_roots: &[String],
) -> Result<(), String> {
    if file_path.is_empty() {
        return Err("Path must be a non-empty string".to_string());
    }

    let path = Path::new(file_path);
    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    if has_parent_segment(path) {
        return Err("Path must not contain '..' segments".to_string());
    }

    let roots = canonical_roots(allowed_roots)?;
    let normalized = normalize_without_parent(path);

    if normalized.exists() {
        let canonical = normalized
            .canonicalize()
            .map_err(|e| format!("Failed to resolve '{}': {e}", file_path))?;
        return ensure_within_any_root(&canonical, &roots);
    }

    let Some(existing) = deepest_existing_ancestor(&normalized) else {
        return Err("Path is outside the workspace and open documents".to_string());
    };
    let canonical_ancestor = existing
        .canonicalize()
        .map_err(|e| format!("Failed to resolve '{}': {e}", existing.display()))?;
    ensure_within_any_root(&canonical_ancestor, &roots)
}

#[tauri::command]
pub fn mcp_bridge_check_path(file_path: String, allowed_roots: Vec<String>) -> Result<(), String> {
    validate_mcp_bridge_path(&file_path, &allowed_roots)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_existing_file_inside_root() {
        let ws = tempfile::tempdir().expect("ws");
        let file = ws.path().join("note.md");
        std::fs::write(&file, "hi").expect("write");

        assert!(validate_mcp_bridge_path(
            &file.to_string_lossy(),
            &[ws.path().to_string_lossy().into_owned()],
        )
        .is_ok());
    }

    #[test]
    fn allows_new_file_inside_existing_root() {
        let ws = tempfile::tempdir().expect("ws");
        let file = ws.path().join("sub").join("new.md");

        assert!(validate_mcp_bridge_path(
            &file.to_string_lossy(),
            &[ws.path().to_string_lossy().into_owned()],
        )
        .is_ok());
    }

    #[test]
    fn rejects_file_outside_root() {
        let ws = tempfile::tempdir().expect("ws");
        let outside = tempfile::tempdir().expect("outside");
        let file = outside.path().join("secret.md");
        std::fs::write(&file, "secret").expect("write");

        assert!(validate_mcp_bridge_path(
            &file.to_string_lossy(),
            &[ws.path().to_string_lossy().into_owned()],
        )
        .is_err());
    }

    #[test]
    fn rejects_parent_traversal() {
        let ws = tempfile::tempdir().expect("ws");
        let path = ws.path().join("..").join("secret.md");

        let err = validate_mcp_bridge_path(
            &path.to_string_lossy(),
            &[ws.path().to_string_lossy().into_owned()],
        )
        .expect_err("parent traversal must be rejected");
        assert!(err.contains(".."));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_existing_symlink_escape() {
        let ws = tempfile::tempdir().expect("ws");
        let outside = tempfile::tempdir().expect("outside");
        let target = outside.path().join("secret.md");
        std::fs::write(&target, "secret").expect("write");
        let link = ws.path().join("link.md");
        std::os::unix::fs::symlink(&target, &link).expect("symlink");

        assert!(validate_mcp_bridge_path(
            &link.to_string_lossy(),
            &[ws.path().to_string_lossy().into_owned()],
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_new_file_under_symlinked_directory_escape() {
        let ws = tempfile::tempdir().expect("ws");
        let outside = tempfile::tempdir().expect("outside");
        let link = ws.path().join("linked-dir");
        std::os::unix::fs::symlink(outside.path(), &link).expect("symlink");
        let file = link.join("new.md");

        assert!(validate_mcp_bridge_path(
            &file.to_string_lossy(),
            &[ws.path().to_string_lossy().into_owned()],
        )
        .is_err());
    }
}
