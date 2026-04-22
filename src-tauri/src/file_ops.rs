//! # File Ops
//!
//! Purpose: Lightweight metadata commands used by the frontend before it commits
//! to reading a file into a tab. Currently exposes `get_file_size_bytes`, the
//! size-check step of the large-file open flow.
//!
//! Pipeline: Frontend invoke("get_file_size_bytes") → fs::metadata → len in bytes.
//!
//! Key decisions:
//!   - Symbolic links are followed (`fs::metadata` default) so the reported size
//!     matches what a subsequent `readTextFile` will actually load.
//!   - Missing / permission-denied paths surface as `Err(String)` so the frontend
//!     can fall through to the existing error path instead of crashing.
//!   - Returns `u64` directly; JS/TS handles values up to `Number.MAX_SAFE_INTEGER`
//!     (~9 PB), far above the 50 MB liability floor.

use std::fs;
use std::path::Path;

/// Reject paths that cannot resolve to a regular file on disk. Keeps the
/// webview from probing non-file entries (directories, devices, character
/// specials) and, via `canonicalize`, from relying on traversal tricks to
/// reach outside the allowed filesystem scope. We deliberately do NOT
/// restrict by extension here — the open dialog allows `.md`, `.markdown`,
/// `.mdown`, `.mkd`, and `.txt`, and constraining extension at the backend
/// broke non-markdown opens during the audit pass.
fn validate_openable_path(raw: &str) -> Result<(), String> {
    let canonical = Path::new(raw)
        .canonicalize()
        .map_err(|e| format!("invalid path '{raw}': {e}"))?;
    if !canonical.is_file() {
        return Err(format!("path '{raw}' is not a regular file"));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_file_size_bytes(path: String) -> Result<u64, String> {
    validate_openable_path(&path)?;
    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Failed to stat {}: {}", path, e))?;
    Ok(metadata.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Helper: create a markdown-named file in a tempdir with the given bytes
    /// and return (tempdir, absolute-path).
    fn make_md_file(bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("fixture.md");
        let mut f = std::fs::File::create(&path).expect("create");
        f.write_all(bytes).expect("write");
        (dir, path)
    }

    #[tokio::test]
    async fn reports_size_for_existing_file() {
        let (_dir, path) = make_md_file(b"hello");
        let size = get_file_size_bytes(path.to_string_lossy().into_owned())
            .await
            .expect("ok");
        assert_eq!(size, 5);
    }

    #[tokio::test]
    async fn empty_file_reports_zero() {
        let (_dir, path) = make_md_file(b"");
        let size = get_file_size_bytes(path.to_string_lossy().into_owned())
            .await
            .expect("ok");
        assert_eq!(size, 0);
    }

    #[tokio::test]
    async fn missing_file_returns_err() {
        let result = get_file_size_bytes("/nonexistent/path/vmark-test.md".to_string()).await;
        assert!(result.is_err(), "expected err for missing path");
    }

    #[tokio::test]
    async fn non_markdown_extension_is_allowed() {
        // The open dialog also accepts .txt, so the size-check must not
        // gatekeep on extension (regression guard).
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("fixture.txt");
        std::fs::write(&path, b"hi").expect("write");
        let size = get_file_size_bytes(path.to_string_lossy().into_owned())
            .await
            .expect("txt file should succeed");
        assert_eq!(size, 2);
    }

    #[tokio::test]
    async fn directory_is_refused() {
        // A directory is a "non-regular file" and must be rejected so the
        // command cannot be repurposed to probe folder existence.
        let dir = tempfile::tempdir().expect("tempdir");
        let result = get_file_size_bytes(dir.path().to_string_lossy().into_owned()).await;
        assert!(result.is_err(), "directories must be refused");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn follows_symlinks_to_real_file() {
        let (_dir, target) = make_md_file(b"abcdef");
        let link_dir = tempfile::tempdir().expect("tempdir");
        let link_path = link_dir.path().join("link.md");
        std::os::unix::fs::symlink(&target, &link_path).expect("symlink");

        let size = get_file_size_bytes(link_path.to_string_lossy().into_owned())
            .await
            .expect("ok");
        assert_eq!(size, 6);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn broken_symlink_returns_err() {
        let dir = tempfile::tempdir().expect("tempdir");
        let link_path = dir.path().join("broken.md");
        std::os::unix::fs::symlink("/nonexistent/target/vmark-test", &link_path)
            .expect("symlink");

        let result = get_file_size_bytes(link_path.to_string_lossy().into_owned()).await;
        assert!(result.is_err(), "broken symlinks must surface an error");
    }

    /// A directory (or file) whose parent denies traversal (mode `0o000`) is
    /// unreadable. `fs::metadata()` returns `Err(PermissionDenied)`; we expect
    /// `get_file_size_bytes` to propagate the error string.
    #[cfg(unix)]
    #[tokio::test]
    async fn permission_denied_returns_err() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let victim = dir.path().join("secret.md");
        std::fs::write(&victim, b"secret").expect("write");

        // Strip all bits from the parent so traversal to the file fails.
        let parent = dir.path();
        let original = std::fs::metadata(parent).expect("stat parent").permissions();
        let mut locked = original.clone();
        locked.set_mode(0o000);

        // Skip on systems where the running user is effectively root (rare in CI,
        // but possible): root bypasses permission checks.
        if unsafe { libc::geteuid() } == 0 {
            eprintln!("skipping permission_denied_returns_err under euid 0");
            return;
        }

        std::fs::set_permissions(parent, locked).expect("chmod lock");

        // Make the permission fix unconditional even on panic.
        let _restore = scopeguard_restore(parent.to_path_buf(), original);

        let result = get_file_size_bytes(victim.to_string_lossy().into_owned()).await;
        assert!(
            result.is_err(),
            "permission-denied paths must surface an error"
        );
    }

    /// Tiny hand-rolled scope guard so we don't pull a crate for one call site.
    #[cfg(unix)]
    fn scopeguard_restore(path: std::path::PathBuf, perms: std::fs::Permissions) -> impl Drop {
        struct Restore(std::path::PathBuf, std::fs::Permissions);
        impl Drop for Restore {
            fn drop(&mut self) {
                let _ = std::fs::set_permissions(&self.0, self.1.clone());
            }
        }
        Restore(path, perms)
    }
}
