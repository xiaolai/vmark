//! Tests for `fs_scope.rs` — runtime fs + asset scope extension.
//!
//! Moved out of `file_open.test.rs` with the code they cover, when
//! `file_open.rs` crossed the 300-line limit.

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
use super::{allow_fs_read, allow_fs_read_dir};
#[cfg(not(target_os = "windows"))]
use tauri::Manager;
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

    // The ASSET scope is the other half of the grant, and nothing asserted it:
    // deleting `allow_fs_read`'s asset_protocol_scope() call passed every test
    // in this file while inline images and the media viewer stopped resolving,
    // because `convertFileSrc`/asset:// is scoped separately from the fs plugin.
    assert!(
        !app.asset_protocol_scope().is_allowed(&file),
        "mock asset scope should reject unknown path before extension"
    );

    allow_fs_read(app.handle(), file.to_str().unwrap());

    assert!(
        app.fs_scope().is_allowed(&file),
        "allow_fs_read should extend scope so the webview can read the path"
    );
    assert!(
        app.asset_protocol_scope().is_allowed(&file),
        "allow_fs_read must also extend the asset scope, or asset:// media 404s"
    );
}

/// #1252 — a workspace root must be granted RECURSIVELY.
///
/// `allow_file` grants one path; a workspace needs its whole tree. Tauri's
/// `allow_directory(path, recursive)` pushes `path/*` when false and `path/**`
/// when true, so a non-recursive grant leaves every SUBDIRECTORY out of scope.
///
/// It only reproduces off the home drive: capabilities/default.json covers
/// `$HOME/**`, `/Volumes/**`, `/mnt/**` and `/media/**`, which masks the gap on
/// macOS and Linux. On Windows `$HOME` is `C:\Users\<name>`, so a workspace on
/// `G:\` is covered by nothing at all.
///
/// Gated like every other mock-runtime test in this file: `tauri::test::
/// MockRuntime` crashes the test binary at startup on windows-latest, so the
/// import and `mock_app_with_fs` are both `cfg(not(windows))` — an ungated test
/// referencing them does not fail at runtime, it fails to COMPILE, and only on
/// Windows. The irony is not lost: a fix for a Windows bug, broken on Windows.
#[cfg(not(target_os = "windows"))]
#[test]
fn allow_fs_read_dir_grants_nested_files() {
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("sub").join("deeper");
    std::fs::create_dir_all(&nested).expect("mkdir");
    let file = nested.join("note.md");
    std::fs::write(&file, b"# hi").expect("write");

    let app = mock_app_with_fs();
    assert!(
        !app.fs_scope().is_allowed(&file),
        "mock fs scope should reject the nested path before extension"
    );

    assert!(!app.asset_protocol_scope().is_allowed(&file));

    allow_fs_read_dir(app.handle(), dir.path().to_str().unwrap());

    assert!(
        app.fs_scope().is_allowed(&file),
        "a workspace grant must reach files in SUBDIRECTORIES, not just the top level"
    );
    assert!(
        app.asset_protocol_scope().is_allowed(&file),
        "the RECURSIVE asset grant is what makes a workspace's nested images render"
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

/// #250 — the half of the scope's behaviour the window-creation commands rely
/// on: `Scope::is_allowed` resolves the symlink and canonicalizes the
/// REQUESTED path before matching it against the granted patterns
/// (`tauri/src/scope/fs.rs`, `try_resolve_symlink_and_canonicalize`), so a
/// link re-pointed AFTER a grant resolves to a path no pattern names.
///
/// That is why the raw name can still go in the window URL. It is NOT why the
/// grant is safe: `push_pattern` also inserts the pattern's canonical form
/// resolved at GRANT time, so granting a raw link name would grant whatever it
/// pointed at just then. `window_manager/commands.rs` therefore grants the
/// canonical path validation judged, and `commands.test.rs` drives the swap in
/// the window between the two. This test pins only the request-side property,
/// against the real scope.
#[cfg(all(unix, not(target_os = "windows")))]
#[test]
fn a_symlink_swapped_after_the_grant_is_refused_because_the_request_is_canonicalized() {
    let inside = tempfile::tempdir().expect("inside");
    let outside = tempfile::tempdir().expect("outside");
    let target = inside.path().join("note.md");
    std::fs::write(&target, b"# mine").expect("write");
    let secret = outside.path().join("secret.md");
    std::fs::write(&secret, b"# theirs").expect("write");
    let link = inside.path().join("link.md");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");

    let app = mock_app_with_fs();
    // Granted while the link points at `note.md` — the raw path, as the
    // commands do.
    allow_fs_read(app.handle(), link.to_str().unwrap());
    assert!(
        app.fs_scope().is_allowed(&link),
        "the link as validated is readable"
    );

    // The swap: same raw path, different target.
    std::fs::remove_file(&link).expect("unlink");
    std::os::unix::fs::symlink(&secret, &link).expect("re-link");

    assert!(
        !app.fs_scope().is_allowed(&link),
        "the request resolves to secret.md, which no granted pattern names"
    );
    assert!(
        !app.fs_scope().is_allowed(&secret),
        "and the target itself was never granted"
    );
}

/// #481 — `grant_fs_read` answers "is this readable now?", so a window is not
/// opened on a file whose every read the webview will be refused.
///
/// `allow_fs_read` logs a failed grant and returns, which is right for the
/// Finder/CLI callers and wrong for `open_*_in_new_window`. The verdict is
/// `is_allowed`, not the grant's own `Result` — a path the static scope
/// already covers is readable whether or not the extra pattern took.
#[cfg(not(target_os = "windows"))]
#[test]
fn grant_fs_read_is_ok_exactly_when_the_path_is_readable_afterwards() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("note.md");
    let other = dir.path().join("other.md");
    std::fs::write(&file, b"# hi").expect("write");
    std::fs::write(&other, b"# hi").expect("write");

    let app = mock_app_with_fs();
    super::grant_fs_read(app.handle(), file.to_str().unwrap()).expect("an ordinary path grants");
    assert!(app.fs_scope().is_allowed(&file));
    // The predicate it reports on is a real discriminator, not a constant:
    // a path nothing granted is still refused.
    assert!(!app.fs_scope().is_allowed(&other));
}

/// A filename holding glob metacharacters is NOT the failure this guards.
///
/// It was the obvious candidate — `Scope::allow_file` compiles its argument as
/// a glob — and it is refuted: Tauri escapes the path first, so the grant takes
/// and the file opens. Pinned so the guard above is not read as covering a case
/// it does not, and so a future Tauri that stopped escaping is caught here
/// rather than in a bug report.
#[cfg(not(target_os = "windows"))]
#[test]
fn a_filename_with_glob_metacharacters_still_grants() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("draft[1]*.md");
    std::fs::write(&file, b"# hi").expect("write");

    let app = mock_app_with_fs();
    super::grant_fs_read(app.handle(), file.to_str().unwrap()).expect("escaped, so it grants");
    assert!(app.fs_scope().is_allowed(&file));
}
