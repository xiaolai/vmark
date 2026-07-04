//! Tests for `temp_html.rs` (included via `#[path]`).
//!
//! Exercises the testable core `write_temp_html_to_dir` — the Tauri command
//! only resolves the app-data directory and delegates here.

use super::*;

// -- write_temp_html_to_dir ---------------------------------------------------

#[test]
fn writes_html_and_returns_readable_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write_temp_html_to_dir(dir.path(), "<h1>hi</h1>").expect("write");

    assert!(path.starts_with(dir.path()), "file must live in target dir");
    let name = path.file_name().unwrap().to_str().unwrap();
    assert!(name.starts_with("vmark-export-"), "name was {name}");
    assert!(name.ends_with(".html"), "name was {name}");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "<h1>hi</h1>");
}

#[test]
fn creates_missing_target_directory() {
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("temp");
    assert!(!nested.exists());
    let path = write_temp_html_to_dir(&nested, "<p>x</p>").expect("write");
    assert!(nested.is_dir());
    assert!(path.starts_with(&nested));
}

#[test]
fn successive_writes_get_unique_names() {
    let dir = tempfile::tempdir().expect("tempdir");
    let a = write_temp_html_to_dir(dir.path(), "<p>a</p>").expect("write a");
    let b = write_temp_html_to_dir(dir.path(), "<p>b</p>").expect("write b");
    assert_ne!(a, b, "each export must get its own file");
    // Both survive: a later export must not clobber an earlier one.
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "<p>a</p>");
    assert_eq!(std::fs::read_to_string(&b).unwrap(), "<p>b</p>");
}

#[test]
fn empty_html_is_accepted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write_temp_html_to_dir(dir.path(), "").expect("write");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
}

#[test]
fn oversized_html_is_rejected_without_writing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let oversized = "a".repeat(MAX_HTML_BYTES + 1);
    let result = write_temp_html_to_dir(dir.path(), &oversized);
    assert!(result.is_err(), "51MB+ input must be rejected");
    // Nothing was written — the size gate runs before any fs work.
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn html_at_exact_limit_is_accepted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let at_limit = "a".repeat(MAX_HTML_BYTES);
    assert!(write_temp_html_to_dir(dir.path(), &at_limit).is_ok());
}

#[test]
fn unicode_html_roundtrips() {
    let dir = tempfile::tempdir().expect("tempdir");
    let html = "<p>\u{4e2d}\u{6587} \u{1f680} caf\u{e9}</p>";
    let path = write_temp_html_to_dir(dir.path(), html).expect("write");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), html);
}

// -- cleanup_stale_temp_files -------------------------------------------------

fn touch(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, b"x").expect("write");
    path
}

#[test]
fn cleanup_removes_only_stale_export_files() {
    let dir = tempfile::tempdir().expect("tempdir");
    let export = touch(dir.path(), "vmark-export-abc.html");
    let print = touch(dir.path(), "print-doc.html");
    let unrelated_name = touch(dir.path(), "keep-me.html");
    let unrelated_ext = touch(dir.path(), "vmark-export-notes.txt");

    // Cutoff in the future: every matching file counts as stale.
    let future = SystemTime::now() + Duration::from_secs(60);
    cleanup_stale_temp_files(dir.path(), future);

    assert!(
        !export.exists(),
        "stale vmark-export-*.html must be removed"
    );
    assert!(!print.exists(), "stale print-*.html must be removed");
    assert!(unrelated_name.exists(), "non-export names must be kept");
    assert!(unrelated_ext.exists(), "non-.html files must be kept");
}

#[test]
fn cleanup_keeps_fresh_export_files() {
    let dir = tempfile::tempdir().expect("tempdir");
    let export = touch(dir.path(), "vmark-export-fresh.html");

    // Cutoff in the past: the just-written file is newer, so it stays.
    let past = SystemTime::now() - Duration::from_secs(60);
    cleanup_stale_temp_files(dir.path(), past);

    assert!(export.exists(), "fresh export files must survive cleanup");
}

#[test]
fn cleanup_of_missing_directory_is_a_noop() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("nope");
    // Must not panic or create the directory.
    cleanup_stale_temp_files(&missing, SystemTime::now());
    assert!(!missing.exists());
}

#[test]
fn write_does_not_remove_fresh_files_from_previous_exports() {
    // End-to-end: a fresh file from a prior export survives the cleanup pass
    // that runs inside a subsequent write.
    let dir = tempfile::tempdir().expect("tempdir");
    let first = write_temp_html_to_dir(dir.path(), "<p>1</p>").expect("first");
    let second = write_temp_html_to_dir(dir.path(), "<p>2</p>").expect("second");
    assert!(first.exists());
    assert!(second.exists());
}
