// #226 — a path the native webviews cannot name is refused with a typed
// error, never handed on with U+FFFD in it.

use super::utf8_path;

#[test]
fn a_utf8_path_passes_through_unchanged() {
    let path = std::path::Path::new("/tmp/vmark-pdf-export-abc.html");
    assert_eq!(
        utf8_path(path).expect("utf-8"),
        "/tmp/vmark-pdf-export-abc.html"
    );
}

// Unix only: an `OsStr` that is not UTF-8 needs bytes, and a Windows path
// (UTF-16) cannot be built from them.
#[cfg(unix)]
#[test]
fn a_non_utf8_path_is_refused_with_its_lossy_spelling_in_the_error() {
    use crate::command_error::ErrorCode;
    use std::os::unix::ffi::OsStrExt;
    let raw = std::ffi::OsStr::from_bytes(b"/tmp/vm\xffark/doc.html");
    let err = utf8_path(std::path::Path::new(raw)).expect_err("not UTF-8");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.pdf.badTempPath"));
    assert!(
        err.message().contains("vm\u{FFFD}ark"),
        "the message names the path in the only spelling it has: {}",
        err.message()
    );
}

// ── the temp document the sink owns ───────────────────────────────────────
//
// #439 — `write_render_temp` is the one step that puts the user's entire
// document on disk, and it had no test at all. What matters about it is the
// three things its header claims: the file is written whole, it is PRIVATE,
// and it is inside the directory `dispatch` grants the webview read access to.

use super::write_render_temp;

#[tokio::test]
async fn the_document_is_written_whole_under_the_requested_prefix() {
    // Over 2 MiB, which is the ceiling that made a FILE necessary (ADR-PDF4):
    // a truncated write is the failure this would hide.
    let html = "<p>x</p>".repeat(300_000);
    let path = write_render_temp("vmark-pdf-export-", html.clone())
        .await
        .expect("written");

    assert_eq!(std::fs::read_to_string(&path).expect("read"), html);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .expect("a UTF-8 name");
    assert!(name.starts_with("vmark-pdf-export-"), "{name}");
    assert!(name.ends_with(".html"), "{name}");
    let temp_dir = std::env::temp_dir();
    assert_eq!(
        path.parent(),
        Some(temp_dir.as_path()),
        "the webview is granted read access to the temp dir and nothing else"
    );

    std::fs::remove_file(&path).expect("the sink would have removed it");
}

// The document can be a private note, and /tmp is shared. `fs::write` on a
// predictable name left it world-readable; `tempfile` creates with O_EXCL and
// 0600, and the write goes through THAT handle.
#[cfg(unix)]
#[tokio::test]
async fn the_document_is_created_private_to_this_user() {
    use std::os::unix::fs::PermissionsExt;
    let path = write_render_temp("vmark-print-", "<p>secret</p>".to_string())
        .await
        .expect("written");
    let mode = std::fs::metadata(&path)
        .expect("metadata")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "mode was {:o}", mode & 0o777);
    std::fs::remove_file(&path).expect("cleanup");
}

// Two renders can run concurrently for different outputs (`mod.rs` says so),
// so two temp documents must never be the same file.
#[tokio::test]
async fn two_documents_never_share_a_path() {
    let a = write_render_temp("vmark-pdf-export-", "<p>a</p>".to_string())
        .await
        .expect("a");
    let b = write_render_temp("vmark-pdf-export-", "<p>b</p>".to_string())
        .await
        .expect("b");
    assert_ne!(a, b);
    assert_eq!(std::fs::read_to_string(&a).expect("read a"), "<p>a</p>");
    assert_eq!(std::fs::read_to_string(&b).expect("read b"), "<p>b</p>");
    std::fs::remove_file(&a).expect("cleanup a");
    std::fs::remove_file(&b).expect("cleanup b");
}
