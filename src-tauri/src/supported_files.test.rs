//! Tests for `supported_files.rs` (moved with the extension gate out of
//! `lib.rs`; included via `#[path]`).

use super::{
    filter_supported_args, has_supported_extension, is_openable_supported, SUPPORTED_EXTENSIONS,
};
use std::path::{Path, PathBuf};

/// Strict markdown-only subset. Test-only: no production caller means
/// "markdown editor candidate" today, so the list lives here (not compiled
/// into the app). If a production caller appears, move it back into
/// `supported_files.rs` next to `SUPPORTED_EXTENSIONS`.
const MARKDOWN_ONLY_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"];

// -- SUPPORTED_EXTENSIONS constant ----------------------------------------

#[test]
fn supported_extensions_cover_phase1a_set() {
    // Freezes the Phase 1A accepted set — if this list changes, every
    // entry point (CLI args, Finder RunEvent::Opened,
    // open_*_in_new_window commands, `dialog:allow-open` filters,
    // `validate_openable_path`, the macOS quarantine strip pass)
    // must be audited for consistency. The TS side is verified by
    // `scripts/check-ext-sync.sh` (ADR-12).
    assert!(SUPPORTED_EXTENSIONS.contains(&"md"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"txt"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"json"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"yaml"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"toml"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"html"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"ts"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"py"));
    assert!(SUPPORTED_EXTENSIONS.contains(&"rs"));
    // The strict markdown subset must stay within the registered set.
    for ext in MARKDOWN_ONLY_EXTENSIONS {
        assert!(
            SUPPORTED_EXTENSIONS.contains(ext),
            "markdown extension '{ext}' missing from SUPPORTED_EXTENSIONS",
        );
    }
}

// -- has_supported_extension ----------------------------------------------

#[test]
fn accepts_every_markdown_extension() {
    for ext in SUPPORTED_EXTENSIONS {
        let path = PathBuf::from(format!("/some/file.{ext}"));
        assert!(
            has_supported_extension(&path),
            "expected '.{ext}' to be accepted",
        );
    }
}

#[test]
fn accepts_uppercase_and_mixed_case_extensions() {
    assert!(has_supported_extension(Path::new("/a/NOTE.MD")));
    assert!(has_supported_extension(Path::new("/a/note.Md")));
    assert!(has_supported_extension(Path::new("/a/Readme.MARKDOWN")));
}

#[test]
fn rejects_unregistered_extensions() {
    assert!(!has_supported_extension(Path::new("/a/archive.zip")));
    assert!(!has_supported_extension(Path::new("/a/installer.exe")));
    // `.md.bak` resolves to extension `bak`, which is not registered.
    assert!(!has_supported_extension(Path::new("/a/note.md.bak")));
}

#[test]
fn accepts_phase1a_non_markdown_extensions() {
    // Phase 1B verification: txt, json, yaml etc. now pass.
    assert!(has_supported_extension(Path::new("/a/notes.txt")));
    assert!(has_supported_extension(Path::new("/a/data.json")));
    assert!(has_supported_extension(Path::new("/a/config.yaml")));
    assert!(has_supported_extension(Path::new("/a/Cargo.toml")));
    assert!(has_supported_extension(Path::new("/a/page.html")));
}

#[test]
fn rejects_path_without_extension() {
    assert!(!has_supported_extension(Path::new("/a/README")));
    assert!(!has_supported_extension(Path::new("/a/.hiddenrc")));
}

#[test]
fn rejects_empty_path() {
    assert!(!has_supported_extension(Path::new("")));
}

// -- is_openable_supported (requires real filesystem) ---------------------

#[test]
fn rejects_missing_path() {
    let missing = PathBuf::from("/definitely/does/not/exist-vmark-test.md");
    assert!(!is_openable_supported(&missing));
}

#[test]
fn rejects_directory_even_with_markdown_name() {
    // Build a temp directory whose name ends in .md — the extension
    // check alone would pass, so this proves is_file() is consulted.
    let dir = tempfile::tempdir().expect("create tempdir");
    let md_dir = dir.path().join("looks-like-note.md");
    std::fs::create_dir(&md_dir).expect("create subdir");
    assert!(!is_openable_supported(&md_dir));
}

#[test]
fn accepts_existing_markdown_file() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let file_path = dir.path().join("note.MD");
    std::fs::write(&file_path, b"# hi").expect("write temp file");
    assert!(is_openable_supported(&file_path));
}

#[test]
fn rejects_existing_unregistered_file() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let file_path = dir.path().join("archive.zip");
    std::fs::write(&file_path, b"PK\x03\x04").expect("write temp file");
    assert!(!is_openable_supported(&file_path));
}

#[test]
fn accepts_existing_phase1a_files() {
    let dir = tempfile::tempdir().expect("create tempdir");
    for ext in ["txt", "json", "yaml", "toml", "html"] {
        let file_path = dir.path().join(format!("file.{ext}"));
        std::fs::write(&file_path, b"data").expect("write");
        assert!(is_openable_supported(&file_path), ".{ext} file should pass");
    }
}

// -- filter_supported_args -------------------------------------------------
// Covers the Windows/Linux CLI entry point. macOS Finder
// (RunEvent::Opened) and the `open_*_in_new_window` commands go through
// the same `is_openable_supported` gate, so the acceptance policy is
// uniform across all three surfaces.

#[test]
fn cli_filter_keeps_every_supported_variant() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let mut inputs = Vec::new();
    for ext in SUPPORTED_EXTENSIONS {
        let path = dir.path().join(format!("note.{ext}"));
        std::fs::write(&path, b"# hi").expect("write");
        inputs.push(path.to_string_lossy().into_owned());
    }
    let kept = filter_supported_args(inputs.clone());
    assert_eq!(kept, inputs, "every supported extension should pass");
}

#[test]
fn cli_filter_drops_unregistered_and_missing_and_directory() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let good = dir.path().join("keep.md");
    std::fs::write(&good, b"# hi").expect("write good");

    let unregistered = dir.path().join("drop.zip");
    std::fs::write(&unregistered, b"zip").expect("write unregistered");

    let md_dir = dir.path().join("looks-markdown.md");
    std::fs::create_dir(&md_dir).expect("mkdir");

    let missing = dir.path().join("vanished.md");

    let inputs = vec![
        good.to_string_lossy().into_owned(),
        unregistered.to_string_lossy().into_owned(),
        md_dir.to_string_lossy().into_owned(),
        missing.to_string_lossy().into_owned(),
    ];

    let kept = filter_supported_args(inputs);
    assert_eq!(kept, vec![good.to_string_lossy().into_owned()]);
}

#[test]
fn cli_filter_empty_input_returns_empty() {
    let kept = filter_supported_args(Vec::<String>::new());
    assert!(kept.is_empty());
}

// -- parity across entry points ------------------------------------------

#[test]
fn finder_and_cli_share_acceptance_policy() {
    // The Finder RunEvent::Opened handler uses `is_openable_supported`
    // directly (file_open.rs `handle_finder_opened`). The CLI filter
    // routes through the same predicate via filter_supported_args. This
    // test pins that invariant — if either surface diverges, this
    // fails loudly rather than letting drift recur silently.
    let dir = tempfile::tempdir().expect("create tempdir");
    let file = dir.path().join("note.MD");
    std::fs::write(&file, b"# hi").expect("write");
    let raw = file.to_string_lossy().into_owned();

    // Finder path (the predicate called inside RunEvent::Opened)
    let finder_accepts = is_openable_supported(&file);
    // CLI path (the wrapper used in the setup closure)
    let cli_accepts = !filter_supported_args(vec![raw.clone()]).is_empty();

    assert!(finder_accepts, "finder arm must accept note.MD");
    assert!(cli_accepts, "cli arm must accept note.MD");
    assert_eq!(finder_accepts, cli_accepts);
}
