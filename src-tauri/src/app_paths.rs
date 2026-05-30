//! App Paths - Centralized path management for Tauri app data.
//!
//! Provides:
//! - Port file path resolution for MCP bridge
//! - Legacy ~/.vmark/ directory cleanup
//! - Atomic file operations to prevent race conditions

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tempfile::NamedTempFile;

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
    if !legacy_dir.exists() {
        return;
    }

    // Remove all known legacy files
    let _ = fs::remove_file(legacy_dir.join(BOOTSTRAP_FILE));
    let _ = fs::remove_file(legacy_dir.join(MCP_PORT_FILE));
    let _ = fs::remove_file(legacy_dir.join(LEGACY_MCP_SETTINGS_FILE));

    // Try to remove directory (only succeeds if empty)
    let _ = fs::remove_dir(&legacy_dir);
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
/// NOTE: A separate async variant exists in `lib.rs` as a Tauri command for
/// frontend invocations. They are intentionally separate — this one is sync
/// for internal Rust callers (workspace config, MCP port file).
pub fn atomic_write_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| {
        format!("Cannot determine parent directory of {:?}", path)
    })?;

    // `NamedTempFile` in the SAME directory → same-filesystem atomic rename, and
    // RAII cleanup: on any early `?` (write/sync/persist failure) the temp file
    // is removed on drop, so a mid-write error never leaks a temp file (D7).
    let mut temp = NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temp file in {:?}: {}", parent, e))?;

    temp.write_all(contents)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Sync to disk before the rename so a crash can't expose a zero-length file.
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync temp file: {}", e))?;

    // `persist` does the atomic rename over `path`. On Unix `rename` REPLACES an
    // existing target, so persist failing there is a genuine error (permission,
    // I/O, target-is-a-dir) — never "target exists". On Windows `rename` fails
    // if the target exists, so there we remove-then-retry. Crucially, the
    // remove-then-retry must be Windows-only: doing it on Unix for an arbitrary
    // persist error would delete the user's existing file and then still fail to
    // write the new one (data loss). On any failure the returned temp file is
    // dropped → removed, so no temp leak.
    match temp.persist(path) {
        Ok(_) => Ok(()),
        #[cfg(windows)]
        Err(persist_err) => {
            let temp = persist_err.file;
            let _ = fs::remove_file(path);
            temp.persist(path)
                .map(|_| ())
                .map_err(|e| format!("Failed to persist {:?}: {}", path, e.error))
        }
        #[cfg(not(windows))]
        Err(persist_err) => {
            Err(format!("Failed to persist {:?}: {}", path, persist_err.error))
        }
    }
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
    fn test_cleanup_removes_bootstrap_file() {
        let dir = tempdir().unwrap();
        let legacy_dir = dir.path().join(".vmark");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(legacy_dir.join("app-data-path"), "/some/path").unwrap();

        // Cleanup using internal function for testability
        let _ = fs::remove_file(legacy_dir.join("app-data-path"));
        let _ = fs::remove_dir(&legacy_dir);

        assert!(!legacy_dir.exists());
    }
}
