//! # Quarantine
//!
//! Purpose: Clear `com.apple.quarantine` xattr from a workspace root and its
//! direct `.md` children so subsequent Finder opens are not silently dropped
//! by macOS Launch Services / CoreServicesUIAgent on running Tauri apps.
//!
//! Pipeline: frontend `openWorkspaceWithConfig` → `strip_workspace_quarantine`
//! command → strips xattr on root + depth-1 markdown files → returns counts.
//!
//! Key decisions:
//!   - Scope is bounded: root directory + direct `.md` children only. No
//!     recursion. Keeps the operation predictable and fast on huge folders.
//!   - macOS-only. The xattr strip is a no-op on other platforms — the
//!     command exists on all platforms but returns an empty result so the
//!     frontend can call it unconditionally.
//!   - Best-effort: per-entry failures are logged and counted, never fatal.
//!     The workspace open must succeed even if quarantine cannot be cleared.
//!   - `.md` only: matches the editor's domain. Other file types in the
//!     folder keep their quarantine markers.

#[cfg(target_os = "macos")]
use std::path::Path;

#[cfg(target_os = "macos")]
const QUARANTINE_ATTR: &str = "com.apple.quarantine";

/// Result of a quarantine strip pass.
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct StripStats {
    /// Number of entries that had `com.apple.quarantine` removed.
    pub stripped_count: usize,
    /// Number of entries that errored (logged; does not fail the call).
    pub error_count: usize,
}

/// Remove `com.apple.quarantine` from a single path. Returns `Ok(true)` if
/// the attribute was present and removed, `Ok(false)` if it was already
/// absent, `Err` only on unexpected I/O failures.
#[cfg(target_os = "macos")]
fn strip_one(path: &Path) -> std::io::Result<bool> {
    match xattr::remove(path, QUARANTINE_ATTR) {
        Ok(()) => Ok(true),
        Err(e) => {
            // ENOATTR (93 on macOS) means the attribute wasn't there — not an error.
            if e.raw_os_error() == Some(93) {
                Ok(false)
            } else {
                Err(e)
            }
        }
    }
}

/// Strip `com.apple.quarantine` from `root` and every `.md` file directly
/// inside `root`. Does not recurse into subdirectories.
///
/// Errors on individual entries are logged and counted, never propagated.
#[cfg(target_os = "macos")]
pub fn strip_workspace_quarantine(root: &Path) -> StripStats {
    let mut stats = StripStats::default();

    if !root.is_dir() {
        return stats;
    }

    match strip_one(root) {
        Ok(true) => stats.stripped_count += 1,
        Ok(false) => {}
        Err(e) => {
            stats.error_count += 1;
            log::warn!(
                "[quarantine] strip root {} failed: {}",
                root.display(),
                e
            );
        }
    }

    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(e) => {
            stats.error_count += 1;
            log::warn!(
                "[quarantine] read_dir {} failed: {}",
                root.display(),
                e
            );
            return stats;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !crate::has_markdown_extension(&path) {
            continue;
        }
        match strip_one(&path) {
            Ok(true) => stats.stripped_count += 1,
            Ok(false) => {}
            Err(e) => {
                stats.error_count += 1;
                log::warn!(
                    "[quarantine] strip {} failed: {}",
                    path.display(),
                    e
                );
            }
        }
    }

    if stats.stripped_count > 0 || stats.error_count > 0 {
        log::info!(
            "[quarantine] root={} stripped={} errors={}",
            root.display(),
            stats.stripped_count,
            stats.error_count
        );
    }

    stats
}

/// Tauri command. On non-macOS, returns an empty `StripStats` so the
/// frontend can call this unconditionally without platform branches.
#[tauri::command]
pub fn strip_workspace_quarantine_cmd(root: String) -> StripStats {
    #[cfg(target_os = "macos")]
    {
        strip_workspace_quarantine(Path::new(&root))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = root;
        StripStats::default()
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::fs;

    fn set_quarantine(path: &Path) {
        // Realistic value matching what the Mixin app writes.
        xattr::set(path, QUARANTINE_ATTR, b"0286;69ef2b4d;Mixin;").unwrap();
    }

    fn has_quarantine(path: &Path) -> bool {
        matches!(xattr::get(path, QUARANTINE_ATTR), Ok(Some(_)))
    }

    #[test]
    fn strips_root_dir_and_direct_md_children() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let md1 = root.join("a.md");
        let md2 = root.join("b.markdown");
        let txt = root.join("c.txt");
        fs::write(&md1, b"# a").unwrap();
        fs::write(&md2, b"# b").unwrap();
        fs::write(&txt, b"text").unwrap();
        set_quarantine(root);
        set_quarantine(&md1);
        set_quarantine(&md2);
        set_quarantine(&txt);

        let stats = strip_workspace_quarantine(root);

        assert_eq!(stats.error_count, 0);
        // Root + md1 + md2 → 3. txt is left alone.
        assert_eq!(stats.stripped_count, 3);
        assert!(!has_quarantine(root));
        assert!(!has_quarantine(&md1));
        assert!(!has_quarantine(&md2));
        // .txt keeps its attribute — out of scope.
        assert!(has_quarantine(&txt));
    }

    #[test]
    fn does_not_recurse_into_subdirectories() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let nested = root.join("sub");
        fs::create_dir(&nested).unwrap();
        let nested_md = nested.join("deep.md");
        fs::write(&nested_md, b"# deep").unwrap();
        set_quarantine(&nested_md);

        let stats = strip_workspace_quarantine(root);

        assert_eq!(stats.stripped_count, 0);
        assert_eq!(stats.error_count, 0);
        // Depth-2 file untouched.
        assert!(has_quarantine(&nested_md));
    }

    #[test]
    fn idempotent_on_already_clean_files() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let md = root.join("a.md");
        fs::write(&md, b"# a").unwrap();

        let first = strip_workspace_quarantine(root);
        let second = strip_workspace_quarantine(root);

        assert_eq!(first.stripped_count, 0);
        assert_eq!(first.error_count, 0);
        assert_eq!(second.stripped_count, 0);
        assert_eq!(second.error_count, 0);
    }

    #[test]
    fn missing_root_returns_empty_stats() {
        let stats = strip_workspace_quarantine(Path::new("/no/such/path/we/hope"));
        assert_eq!(stats.stripped_count, 0);
        assert_eq!(stats.error_count, 0);
    }

    #[test]
    fn root_pointing_to_file_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("regular.md");
        fs::write(&f, b"# x").unwrap();
        set_quarantine(&f);

        let stats = strip_workspace_quarantine(&f);

        // We never strip when root is not a directory — caller's responsibility
        // to pass a workspace dir, not a single file.
        assert_eq!(stats.stripped_count, 0);
        assert!(has_quarantine(&f));
    }

    #[test]
    fn handles_cjk_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("《定投》");
        fs::create_dir(&root).unwrap();
        let md = root.join("英国老太太.md");
        fs::write(&md, b"# cjk").unwrap();
        set_quarantine(&root);
        set_quarantine(&md);

        let stats = strip_workspace_quarantine(&root);

        assert_eq!(stats.error_count, 0);
        assert_eq!(stats.stripped_count, 2);
        assert!(!has_quarantine(&md));
    }
}
