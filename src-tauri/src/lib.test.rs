//! Tests for `lib.rs` (extracted to keep the production file under the
//! size gate; included via `#[path]`).

use super::{
    atomic_write_file_sync, filter_supported_args, has_supported_extension, is_openable_supported,
    MARKDOWN_ONLY_EXTENSIONS, SUPPORTED_EXTENSIONS, PARENT_MISSING_ERROR_PREFIX,
};
use std::path::{Path, PathBuf};

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
    // Strict markdown subset is still available for narrow callers.
    assert_eq!(
        MARKDOWN_ONLY_EXTENSIONS,
        &["md", "markdown", "mdown", "mkd", "mdx"],
    );
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
    assert!(!has_supported_extension(Path::new("/a/image.png")));
    assert!(!has_supported_extension(Path::new("/a/video.mp4")));
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
    let file_path = dir.path().join("photo.png");
    std::fs::write(&file_path, b"\x89PNG").expect("write temp file");
    assert!(!is_openable_supported(&file_path));
}

#[test]
fn accepts_existing_phase1a_files() {
    let dir = tempfile::tempdir().expect("create tempdir");
    for ext in ["txt", "json", "yaml", "toml", "html"] {
        let file_path = dir.path().join(format!("file.{ext}"));
        std::fs::write(&file_path, b"data").expect("write");
        assert!(
            is_openable_supported(&file_path),
            ".{ext} file should pass"
        );
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

    let unregistered = dir.path().join("drop.png");
    std::fs::write(&unregistered, b"png").expect("write unregistered");

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
    // directly (lib.rs `tauri::RunEvent::Opened` arm). The CLI filter
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

// -- allow_fs_read runtime scope extension (mock Tauri app) --------------
//
// Covers the wiring that the CLI, Finder, and `open_*_in_new_window`
// entry points all rely on: calling `allow_fs_read(app, path)` must
// mutate the fs plugin's scope so `readTextFile(path)` in the webview
// later succeeds. Without this, the bug reported in #676 recurs
// silently — validators pass, but the webview read is still denied.

// tauri::test::MockRuntime crashes the test binary at startup on
// windows-latest (STATUS_ENTRYPOINT_NOT_FOUND). The `test` feature of
// tauri is not enabled on Windows (see Cargo.toml target-specific
// dev-dependency), and these tests are cfg-gated to match. macOS/Linux
// still exercise the scope-extension wiring end-to-end.
#[cfg(not(target_os = "windows"))]
use super::allow_fs_read;
#[cfg(not(target_os = "windows"))]
use tauri_plugin_fs::FsExt;

#[cfg(not(target_os = "windows"))]
fn mock_app_with_fs() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app with fs plugin")
}

#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_extends_scope_so_read_is_permitted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("note.md");
    std::fs::write(&file, b"# hi").expect("write");

    let app = mock_app_with_fs();
    // Sanity: a fresh mock scope does NOT already allow this arbitrary
    // path. If this flips, the rest of the test is meaningless.
    assert!(
        !app.fs_scope().is_allowed(&file),
        "mock fs scope should reject unknown path before extension"
    );

    allow_fs_read(app.handle(), file.to_str().unwrap());

    assert!(
        app.fs_scope().is_allowed(&file),
        "allow_fs_read should extend scope so the webview can read the path"
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_is_idempotent() {
    // Calling twice must not panic, error, or double-allow in a way
    // that breaks subsequent reads. The Finder cold-start path does
    // this when a file arrives via both the pending queue and a later
    // hot event.
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("note.md");
    std::fs::write(&file, b"# hi").expect("write");

    let app = mock_app_with_fs();
    allow_fs_read(app.handle(), file.to_str().unwrap());
    allow_fs_read(app.handle(), file.to_str().unwrap());

    assert!(app.fs_scope().is_allowed(&file));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_does_not_grant_unrelated_paths() {
    // Extending scope for one file must not leak into neighbors.
    let dir = tempfile::tempdir().expect("tempdir");
    let allowed = dir.path().join("keep.md");
    let other = dir.path().join("other.md");
    std::fs::write(&allowed, b"# hi").expect("write allowed");
    std::fs::write(&other, b"# hi").expect("write other");

    let app = mock_app_with_fs();
    allow_fs_read(app.handle(), allowed.to_str().unwrap());

    assert!(app.fs_scope().is_allowed(&allowed));
    assert!(
        !app.fs_scope().is_allowed(&other),
        "scope extension must be per-file, not per-directory"
    );
}

// -- atomic_write_file_sync ----------------------------------------------

#[test]
fn atomic_write_succeeds_when_parent_dir_exists() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let target = dir.path().join("note.md");

    atomic_write_file_sync(&target, "hello").expect("write should succeed");

    let read_back = std::fs::read_to_string(&target).expect("read back");
    assert_eq!(read_back, "hello");
}

#[test]
fn atomic_write_returns_parent_missing_sentinel_when_dir_gone() {
    // Regression test: if the parent directory was renamed/deleted
    // between open and save, `NamedTempFile::new_in` would fail with a
    // raw "No such file or directory (os error 2)". Our explicit
    // pre-flight check converts that to a recognizable sentinel so the
    // frontend can route into Save As instead of leaking the OS error.
    let dir = tempfile::tempdir().expect("create tempdir");
    let gone = dir.path().join("renamed-away");
    let target = gone.join("note.md");
    // gone/ is intentionally never created — the parent does not exist.

    let err = atomic_write_file_sync(&target, "hello")
        .expect_err("write must fail when parent dir is missing");

    assert!(
        err.starts_with(PARENT_MISSING_ERROR_PREFIX),
        "expected sentinel prefix, got: {err}",
    );
    assert!(
        err.contains("renamed-away"),
        "expected missing dir path in error, got: {err}",
    );
    // Belt-and-suspenders: ensure we did NOT leak the raw OS error.
    assert!(
        !err.contains("os error 2"),
        "raw OS error must not leak when parent is missing, got: {err}",
    );
}

#[test]
fn atomic_write_returns_parent_missing_when_parent_is_a_file() {
    // Edge case: parent path exists but isn't a directory (someone
    // replaced the folder with a file of the same name).
    let dir = tempfile::tempdir().expect("create tempdir");
    let parent_as_file = dir.path().join("not-a-dir");
    std::fs::write(&parent_as_file, b"oops").expect("create file");
    let target = parent_as_file.join("note.md");

    let err = atomic_write_file_sync(&target, "hello")
        .expect_err("write must fail when parent is a file, not a dir");
    assert!(err.starts_with(PARENT_MISSING_ERROR_PREFIX), "got: {err}");
}
