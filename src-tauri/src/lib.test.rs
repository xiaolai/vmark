//! Tests for `lib.rs` (included via `#[path]`).
//!
//! Guards the crate-root re-export surface left behind by the 2026-07
//! decomposition of `lib.rs`: legacy `crate::` call sites depend on these
//! re-exports, and because some consumers are platform-gated the exact set
//! must stay compilable on every target (an unconditional re-export whose
//! only user is macOS-gated is an unused-import clippy error on
//! Linux/Windows CI — the exact regression this pins).

use std::path::Path;

#[test]
fn is_openable_supported_is_reachable_at_crate_root() {
    // Cross-platform consumers (external_editor, window_manager path
    // validation) call this via `crate::` — the re-export must exist and
    // behave on every target this test runs on. The gate requires an
    // existing regular file, so probe with a real one.
    let dir = tempfile::tempdir().expect("tempdir");
    let md = dir.path().join("notes.md");
    std::fs::write(&md, "# hi").expect("write");
    assert!(crate::is_openable_supported(&md));
    assert!(!crate::is_openable_supported(Path::new("missing.md")));
    let zip = dir.path().join("archive.zip");
    std::fs::write(&zip, b"zip").expect("write");
    assert!(!crate::is_openable_supported(&zip));
}

#[cfg(target_os = "macos")]
#[test]
fn has_supported_extension_is_reachable_at_crate_root_on_macos() {
    // Sole consumer (quarantine sweep) is macOS-gated, so the re-export is
    // deliberately cfg(target_os = "macos") — see lib.rs.
    assert!(crate::has_supported_extension(Path::new("notes.md")));
    assert!(!crate::has_supported_extension(Path::new("archive.zip")));
}

#[test]
fn pending_file_open_is_constructible_at_crate_root() {
    let pending = crate::PendingFileOpen {
        path: "/tmp/a.md".to_string(),
        workspace_root: None,
    };
    assert_eq!(pending.path, "/tmp/a.md");
}
