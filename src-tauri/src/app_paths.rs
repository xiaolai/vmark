//! App Paths - Centralized path management for Tauri app data.
//!
//! Provides:
//! - Port file path resolution for MCP bridge
//! - Legacy ~/.vmark/ directory cleanup
//! - Atomic file operations to prevent race conditions

use crate::atomic_replace::{atomic_replace, AtomicReplaceError};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ============================================================================
// Constants
// ============================================================================

/// Filename of the MCP bridge port discovery file in app data.
pub const MCP_PORT_FILE: &str = "mcp-port";

/// Bootstrap file name — legacy, only used for cleanup
const BOOTSTRAP_FILE: &str = "app-data-path";

/// Legacy MCP settings file — only used for cleanup
const LEGACY_MCP_SETTINGS_FILE: &str = "mcp-settings.json";

// ============================================================================
// Public API (Tauri-dependent)
// ============================================================================

/// Resolve the app data directory, mapping the Tauri path error to a `String`.
/// Replaces the repeated `app.path().app_data_dir().map_err(|e| e.to_string())?`
/// across the backend (WI-3.6 / D7).
pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Get the path to the port file in the app data directory.
pub fn get_port_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(MCP_PORT_FILE))
}

/// Best-effort cleanup of legacy ~/.vmark/ directory.
/// Removes obsolete files (bootstrap, port, settings) and the directory itself if empty.
pub fn cleanup_legacy_home_dir(_app: &tauri::AppHandle) {
    let Some(legacy_dir) = get_legacy_dir() else {
        return;
    };
    remove_legacy_files(&legacy_dir);
}

/// Remove the known legacy files from `legacy_dir`, then the directory
/// itself (only succeeds if empty). Best-effort — errors are ignored.
/// Separated from `cleanup_legacy_home_dir` so tests can exercise the real
/// deletion logic against a temp directory.
fn remove_legacy_files(legacy_dir: &Path) {
    if !legacy_dir.exists() {
        return;
    }

    let _ = fs::remove_file(legacy_dir.join(BOOTSTRAP_FILE));
    let _ = fs::remove_file(legacy_dir.join(MCP_PORT_FILE));
    let _ = fs::remove_file(legacy_dir.join(LEGACY_MCP_SETTINGS_FILE));

    let _ = fs::remove_dir(legacy_dir);
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Get the legacy directory path (~/.vmark/).
fn get_legacy_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".vmark"))
}

/// Write a file atomically using temp file + sync + rename pattern.
/// This prevents partial reads by other processes.
///
/// Thin wrapper over `atomic_replace::atomic_replace` — the shared core also
/// backs `file_write::atomic_write_file_sync`; only the error strings here
/// are caller-specific.
///
/// NOTE: A separate async variant exists in `file_write.rs` as a Tauri
/// command for frontend invocations. They are intentionally separate — this
/// one is sync for internal Rust callers (workspace config, MCP port file).
pub fn atomic_write_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory of {:?}", path))?;

    atomic_replace(path, parent, contents).map_err(|e| match e {
        AtomicReplaceError::CreateTemp { parent, source } => {
            format!("Failed to create temp file in {:?}: {}", parent, source)
        }
        AtomicReplaceError::WriteTemp(e) => format!("Failed to write temp file: {}", e),
        AtomicReplaceError::FlushTemp(e) => format!("Failed to flush temp file: {}", e),
        AtomicReplaceError::SyncTemp(e) => format!("Failed to sync temp file: {}", e),
        AtomicReplaceError::Persist(e) => format!("Failed to persist {:?}: {}", path, e.error),
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use tempfile::tempdir;

    // ------------------------------------------------------------------------
    // atomic_write_file tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_atomic_write_creates_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.txt");

        atomic_write_file(&path, b"hello").unwrap();

        let contents = fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "hello");
    }

    #[test]
    fn test_atomic_write_overwrites_existing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.txt");

        fs::write(&path, "old content").unwrap();
        atomic_write_file(&path, b"new content").unwrap();

        let contents = fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "new content");
    }

    #[test]
    fn test_atomic_write_no_partial_content() {
        // This tests that readers see either old or new content, never partial
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.txt");

        // Write initial content
        atomic_write_file(&path, b"AAAA").unwrap();

        // Concurrent read and write
        let path_clone = path.clone();
        let barrier = Arc::new(Barrier::new(2));
        let barrier_clone = Arc::clone(&barrier);

        let writer = thread::spawn(move || {
            barrier_clone.wait();
            for _ in 0..100 {
                atomic_write_file(&path_clone, b"BBBBBBBB").unwrap();
                atomic_write_file(&path_clone, b"AAAA").unwrap();
            }
        });

        let reader = thread::spawn(move || {
            barrier.wait();
            for _ in 0..100 {
                if let Ok(contents) = fs::read_to_string(&path) {
                    // Should never see partial content
                    assert!(
                        contents == "AAAA" || contents == "BBBBBBBB",
                        "Got partial content: {:?}",
                        contents
                    );
                }
            }
        });

        writer.join().unwrap();
        reader.join().unwrap();
    }

    /// Overwriting an existing file must preserve its permission bits (the
    /// temp file is created 0600 on Unix and would otherwise win the rename).
    #[cfg(unix)]
    #[test]
    fn test_atomic_write_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        atomic_write_file(&path, b"new").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o644, "atomic write must not reset permissions");
    }

    #[test]
    fn test_atomic_write_cleans_up_temp_on_failure() {
        let dir = tempdir().unwrap();
        // Create a directory where we expect a file - this will cause write to fail
        let path = dir.path().join("subdir");
        fs::create_dir(&path).unwrap();

        let result = atomic_write_file(&path, b"test");
        assert!(result.is_err());

        // No temp files should be left behind
        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(entries.len(), 1); // Only the subdir
    }

    // ------------------------------------------------------------------------
    // cleanup_legacy_home_dir tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_cleanup_removes_legacy_files_and_empty_dir() {
        let dir = tempdir().unwrap();
        let legacy_dir = dir.path().join(".vmark");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(legacy_dir.join(BOOTSTRAP_FILE), "/some/path").unwrap();
        fs::write(legacy_dir.join(MCP_PORT_FILE), "12345:token").unwrap();
        fs::write(legacy_dir.join(LEGACY_MCP_SETTINGS_FILE), "{}").unwrap();

        remove_legacy_files(&legacy_dir);

        assert!(!legacy_dir.exists());
    }

    #[test]
    fn test_cleanup_keeps_dir_with_unknown_files() {
        // Best-effort contract: unknown user files are never touched, and a
        // non-empty directory is left in place.
        let dir = tempdir().unwrap();
        let legacy_dir = dir.path().join(".vmark");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(legacy_dir.join(BOOTSTRAP_FILE), "/some/path").unwrap();
        fs::write(legacy_dir.join("user-note.md"), "keep me").unwrap();

        remove_legacy_files(&legacy_dir);

        assert!(!legacy_dir.join(BOOTSTRAP_FILE).exists());
        assert!(legacy_dir.join("user-note.md").exists());
        assert!(legacy_dir.exists());
    }

    #[test]
    fn test_cleanup_is_noop_when_dir_missing() {
        let dir = tempdir().unwrap();
        let legacy_dir = dir.path().join(".vmark");

        remove_legacy_files(&legacy_dir); // must not panic

        assert!(!legacy_dir.exists());
    }
}
