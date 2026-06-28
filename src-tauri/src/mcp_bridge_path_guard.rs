//! MCP bridge path guard.
//!
//! The frontend first applies the pure string policy, then calls this command
//! before bridge file reads/writes. This command resolves symlinks for existing
//! targets and for the deepest existing ancestor of new targets, closing the
//! classic `workspace/link -> /etc` escape.
//!
//! Cross-layer contract: the `mcp_bridge_check_path` parameter names
//! (`file_path`, `allowed_roots`) are bound by Tauri's camelCase→snake_case
//! convention to the JS invoke args (`filePath`, `allowedRoots`) sent from
//! `services/mcpBridge/bridgePathGuard.ts`. Renaming a parameter on EITHER side
//! silently breaks the bridge (the arg fails to bind at runtime) — no compiler
//! or unit test catches it. The JS side of the contract is pinned in
//! `bridgePathGuard.test.ts`; keep the names here in lockstep.
//!
//! Known limitation (TOCTOU): this check and the subsequent `writeTextFile` /
//! `readTextFile` are two separate frontend calls, not one atomic operation. A
//! symlink swapped into an allowed root between the check and the write could
//! escape the canonical-path resolution. Accepted for a local single-user
//! editor; revisit if bridge fs ever runs against an untrusted live workspace.

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
    // Reject a NUL byte to match the JS policy (fail closed). For a *new* file
    // only the deepest existing ancestor is canonicalized, so a NUL-tailed name
    // would otherwise slip through here even though the OS can never create it.
    if file_path.contains('\0') {
        return Err("Path must not contain a null byte".to_string());
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

/// Tauri command invoked from `bridgePathGuard.ts`. The `file_path` /
/// `allowed_roots` names are part of the JS↔Rust contract (see module header) —
/// do not rename without updating the JS invoke args and their pinning test.
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

    // --- JS↔Rust parity: mirror the cases pinned in mcpBridgePathPolicy.test.ts
    //     so the two layers are verified to agree behaviorally, not just by
    //     argument-name binding. ---

    #[test]
    fn rejects_null_byte() {
        // Parity with the JS policy's null-byte rejection. The NUL sits in a
        // not-yet-existing leaf, so without the explicit guard the deepest
        // existing ancestor (`ws`) would canonicalize cleanly and pass.
        let ws = tempfile::tempdir().expect("ws");
        let file_path = format!("{}/note\0.md", ws.path().to_string_lossy());

        let err = validate_mcp_bridge_path(
            &file_path,
            &[ws.path().to_string_lossy().into_owned()],
        )
        .expect_err("null byte must be rejected");
        assert!(err.contains("null byte"));
    }

    #[test]
    fn rejects_prefix_sibling_root() {
        // "/…/ws-evil" must NOT be treated as inside "/…/ws" — component-wise
        // starts_with, not a substring prefix (mirrors the JS substring-escape
        // test).
        let parent = tempfile::tempdir().expect("parent");
        let ws = parent.path().join("ws");
        let evil = parent.path().join("ws-evil");
        std::fs::create_dir(&ws).expect("ws");
        std::fs::create_dir(&evil).expect("evil");
        let file = evil.join("x.md");
        std::fs::write(&file, "hi").expect("write");

        assert!(validate_mcp_bridge_path(
            &file.to_string_lossy(),
            &[ws.to_string_lossy().into_owned()],
        )
        .is_err());
    }

    #[test]
    fn allows_path_equal_to_root() {
        // A path equal to a root is within it (mirrors the JS "equal to a root"
        // case).
        let ws = tempfile::tempdir().expect("ws");

        assert!(validate_mcp_bridge_path(
            &ws.path().to_string_lossy(),
            &[ws.path().to_string_lossy().into_owned()],
        )
        .is_ok());
    }

    #[test]
    fn ignores_empty_string_roots() {
        // Empty-string roots are skipped; a real root still decides (mirrors the
        // JS "ignores empty-string roots" case).
        let ws = tempfile::tempdir().expect("ws");
        let file = ws.path().join("note.md");
        std::fs::write(&file, "hi").expect("write");

        assert!(validate_mcp_bridge_path(
            &file.to_string_lossy(),
            &[String::new(), ws.path().to_string_lossy().into_owned()],
        )
        .is_ok());
    }

    #[test]
    fn rejects_all_empty_or_no_roots() {
        // No usable root → reject (mirrors the JS empty-allowedRoots case).
        let ws = tempfile::tempdir().expect("ws");
        let file = ws.path().join("note.md");
        std::fs::write(&file, "hi").expect("write");
        let target = file.to_string_lossy().into_owned();

        assert!(validate_mcp_bridge_path(&target, &[]).is_err());
        assert!(validate_mcp_bridge_path(&target, &[String::new()]).is_err());
    }
}
