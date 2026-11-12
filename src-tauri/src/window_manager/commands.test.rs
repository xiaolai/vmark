//! Tests for `window_manager/commands.rs`.
//!
//! These commands mostly create real windows, which the mock runtime does: the
//! creation commands' real bodies run below (#249), and `close_window` is driven
//! through the IPC layer at the end of the file, where the window that sends a
//! message is a fact the test can choose.

// tauri::test::MockRuntime crashes the test binary at startup on
// windows-latest (STATUS_ENTRYPOINT_NOT_FOUND); the `test` feature of tauri is
// not enabled there (see the target-specific dev-dependency in Cargo.toml), so
// these are cfg-gated to match the other mock-runtime suites in this crate.
#![cfg(not(target_os = "windows"))]

use crate::command_error::ErrorCode;

/// The fs plugin is registered because the creation commands extend its
/// scope (`allow_fs_read`) before they build a window.
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

// -- #249: the three creation commands, on a mock runtime --------------------
//
// The commands are generic over the runtime, so the mock app runs the REAL
// command bodies: validation, scope extension and the window build.

use super::{
    open_file_in_new_window, open_workspace_in_new_window, open_workspace_with_files_in_new_window,
    validate_then_grant,
};
use tauri::Manager;

fn workspace_with(names: &[&str]) -> (tempfile::TempDir, Vec<String>) {
    let dir = tempfile::tempdir().expect("tempdir");
    let files = names
        .iter()
        .map(|name| {
            let path = dir.path().join(name);
            std::fs::write(&path, b"# hi").expect("write");
            path.to_str().expect("utf-8").to_string()
        })
        .collect();
    (dir, files)
}

fn doc_labels(app: &tauri::App<tauri::test::MockRuntime>) -> Vec<String> {
    let mut labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("doc-"))
        .cloned()
        .collect();
    labels.sort();
    labels
}

#[test]
fn open_file_opens_a_document_window_whose_url_carries_the_file() {
    let (_dir, files) = workspace_with(&["note.md"]);
    let app = mock_app();

    let label = open_file_in_new_window(app.handle().clone(), files[0].clone())
        .expect("a real markdown file opens");

    assert!(label.starts_with("doc-"), "{label}");
    let window = app
        .get_webview_window(&label)
        .expect("the returned label names a live window");
    let url = window.url().expect("mock windows carry their URL");
    assert!(
        url.query().is_some_and(|q| q.contains("file=")),
        "the frontend reads the file from the URL: {url}"
    );
    assert!(
        url.to_string().contains("note.md"),
        "the URL names the file: {url}"
    );
}

#[test]
fn open_file_refuses_a_missing_path_with_invalid_input_and_opens_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("gone.md").to_str().unwrap().to_string();
    let app = mock_app();

    let err = open_file_in_new_window(app.handle().clone(), missing).expect_err("missing");

    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(app.webview_windows().is_empty(), "a refusal opens nothing");
}

#[test]
fn open_file_refuses_an_unregistered_extension_before_creating_anything() {
    let (_dir, files) = workspace_with(&["archive.zip"]);
    let app = mock_app();

    let err = open_file_in_new_window(app.handle().clone(), files[0].clone())
        .expect_err(".zip is not an openable VMark file");

    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(app.webview_windows().is_empty());
}

#[test]
fn open_workspace_requires_a_real_directory_and_validates_the_optional_file() {
    let (dir, files) = workspace_with(&["note.md"]);
    let root = dir.path().to_str().unwrap().to_string();
    let app = mock_app();

    // A file where the workspace root should be.
    let err = open_workspace_in_new_window(app.handle().clone(), files[0].clone(), None)
        .expect_err("a file is not a workspace root");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(app.webview_windows().is_empty());

    // A good root with a bad file: refused before any window exists.
    let bad_file = dir.path().join("nope.md").to_str().unwrap().to_string();
    let err = open_workspace_in_new_window(app.handle().clone(), root.clone(), Some(bad_file))
        .expect_err("the file must exist");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(app.webview_windows().is_empty());

    // A good root with a good file opens one window carrying both.
    let label = open_workspace_in_new_window(app.handle().clone(), root, Some(files[0].clone()))
        .expect("opens");
    let url = app
        .get_webview_window(&label)
        .expect("live")
        .url()
        .expect("url");
    let query = url.query().unwrap_or_default().to_string();
    assert!(query.contains("workspaceRoot="), "{url}");
    assert!(query.contains("file="), "{url}");
}

#[test]
fn open_workspace_with_files_validates_the_whole_batch_before_opening_anything() {
    let (dir, mut files) = workspace_with(&["a.md", "b.md"]);
    let root = dir.path().to_str().unwrap().to_string();
    let app = mock_app();

    // One bad entry refuses the batch, and no window exists afterwards.
    let mut with_bad = files.clone();
    with_bad.push(dir.path().join("missing.md").to_str().unwrap().to_string());
    let err = open_workspace_with_files_in_new_window(app.handle().clone(), root.clone(), with_bad)
        .expect_err("one missing file refuses the batch");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(app.webview_windows().is_empty());

    // The good batch opens ONE window whose URL carries every file.
    files.sort();
    let label = open_workspace_with_files_in_new_window(app.handle().clone(), root, files.clone())
        .expect("opens");
    assert_eq!(doc_labels(&app), vec![label.clone()]);
    let url = app
        .get_webview_window(&label)
        .expect("live")
        .url()
        .expect("url");
    let decoded = urlencoding::decode(url.query().unwrap_or_default()).expect("utf-8");
    for file in &files {
        assert!(
            decoded.contains(file.as_str()),
            "{file} missing from {decoded}"
        );
    }
}

#[test]
fn every_successful_open_gets_its_own_fresh_label() {
    let (_dir, files) = workspace_with(&["one.md", "two.md"]);
    let app = mock_app();
    let first = open_file_in_new_window(app.handle().clone(), files[0].clone()).expect("first");
    let second = open_file_in_new_window(app.handle().clone(), files[1].clone()).expect("second");
    assert_ne!(first, second, "labels are never reused");
    assert_eq!(doc_labels(&app).len(), 2);
}

// -- #250: the grant names what validation judged ----------------------------
//
// Validation canonicalizes to judge the target; the grant used to be handed
// the RAW string, and Tauri's `push_pattern` canonicalizes what it is handed
// at grant time. So a link re-pointed BETWEEN the two put the attacker's
// target into the scope with validation's blessing. `validate_then_grant`
// takes the swap as a closure, so the exact window is driven here.

#[cfg(unix)]
#[test]
fn a_link_swapped_between_validation_and_the_grant_grants_nothing_outside() {
    use tauri_plugin_fs::FsExt;

    let inside = tempfile::tempdir().expect("inside");
    let outside = tempfile::tempdir().expect("outside");
    let target = inside.path().join("note.md");
    std::fs::write(&target, b"# mine").expect("write");
    let secret = outside.path().join("secret.md");
    std::fs::write(&secret, b"# theirs").expect("write");
    let link = inside.path().join("link.md");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");
    let app = mock_app();

    let granted = validate_then_grant(
        app.handle(),
        std::slice::from_ref(&link.to_str().unwrap().to_string()),
        || {
            // The swap, after validation saw note.md and before the grant.
            std::fs::remove_file(&link).expect("unlink");
            std::os::unix::fs::symlink(&secret, &link).expect("re-link");
        },
    )
    .expect("validated while the link pointed at note.md");

    let judged = target.canonicalize().expect("canonical");
    assert_eq!(
        granted
            .iter()
            .map(std::path::PathBuf::from)
            .collect::<Vec<_>>(),
        vec![judged.clone()],
        "the grant names what was judged"
    );
    assert!(
        !app.fs_scope().is_allowed(&secret),
        "the attacker's target must never enter the scope"
    );
    assert!(
        !app.fs_scope().is_allowed(&link),
        "a read of the raw name now resolves to secret.md, which no pattern names"
    );
    assert!(
        app.fs_scope().is_allowed(&judged),
        "what validation judged is readable"
    );
}

#[cfg(unix)]
#[test]
fn opening_through_a_link_grants_the_target_it_resolves_to() {
    use tauri_plugin_fs::FsExt;

    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("note.md");
    std::fs::write(&target, b"# mine").expect("write");
    let link = dir.path().join("today.md");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");
    let app = mock_app();

    open_file_in_new_window(app.handle().clone(), link.to_str().unwrap().to_string())
        .expect("a link to a markdown file opens");

    assert!(app.fs_scope().is_allowed(&target), "the judged target");
    assert!(
        app.fs_scope().is_allowed(&link),
        "and the name still resolves to it — while it still points there"
    );
}

// -- #250 (round 3): the JUDGED path is the one that flows on ----------------
//
// Granting the canonical target closed the scope half. The other half is that
// the raw string was still handed to the window: every later step — the
// frontend's read, its watcher, its save — resolves that NAME again, so a link
// re-pointed after validation redirects all of them to a file the user never
// chose. What validation judged is what the window is given.

#[cfg(unix)]
#[test]
fn the_window_is_given_the_target_validation_judged_not_the_link_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("note.md");
    std::fs::write(&target, b"# mine").expect("write");
    let link = dir.path().join("today.md");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");
    let app = mock_app();

    let label = open_file_in_new_window(app.handle().clone(), link.to_str().unwrap().to_string())
        .expect("a link to a markdown file opens");

    let url = app
        .get_webview_window(&label)
        .expect("live")
        .url()
        .expect("url");
    let judged = target.canonicalize().expect("canonical");
    let decoded = urlencoding::decode(url.query().unwrap_or_default()).expect("utf-8");
    assert!(
        decoded.contains(judged.to_str().unwrap()),
        "the window opens what was judged: {decoded}"
    );
    assert!(
        !decoded.contains("today.md"),
        "the link NAME must not travel on — a later swap would redirect every \
         read of it: {decoded}"
    );
}

#[cfg(unix)]
#[test]
fn a_workspace_root_reaches_the_window_canonicalized_too() {
    let real = tempfile::tempdir().expect("real");
    let link = real.path().parent().expect("parent").join(format!(
        "vmark-ws-link-{}-{}",
        std::process::id(),
        line!()
    ));
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(real.path(), &link).expect("symlink");
    let app = mock_app();

    let label = open_workspace_in_new_window(
        app.handle().clone(),
        link.to_str().unwrap().to_string(),
        None,
    )
    .expect("a link to a directory opens");

    let url = app
        .get_webview_window(&label)
        .expect("live")
        .url()
        .expect("url");
    let decoded = urlencoding::decode(url.query().unwrap_or_default()).expect("utf-8");
    let judged = real.path().canonicalize().expect("canonical");
    let _ = std::fs::remove_file(&link);
    assert!(
        decoded.contains(judged.to_str().unwrap()),
        "the window is scoped to the directory validation judged: {decoded}"
    );
}

// -- WI-RA7C.5: the window that asks is the window that closes ----------------

mod caller_identity {
    use crate::ipc_caller::{app_with, invoke_from, window};

    fn app() -> tauri::App<tauri::test::MockRuntime> {
        app_with(tauri::generate_handler![super::super::close_window])
    }

    /// Invoke `close_window` from `caller` with `args`; its answer, and the
    /// window it reported destroying. The mock runtime drops a destroyed window
    /// from its own table but never tells the app, so the command's
    /// destroy-result line — written after `destroy()` returned, naming the
    /// window it was called on — is where the test reads which one went.
    fn close_from(
        caller: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        args: serde_json::Value,
    ) -> (Result<serde_json::Value, serde_json::Value>, Vec<String>) {
        let mut answer = Ok(serde_json::Value::Null);
        let lines = crate::peer_text::log_capture::captured_logs(|| {
            answer = invoke_from(caller, "close_window", args);
        });
        let destroyed = lines
            .iter()
            .filter(|line| line.contains("destroy result: Ok"))
            .cloned()
            .collect();
        (answer, destroyed)
    }

    /// The label used to be an argument, so any webview could close any
    /// window by writing its name. The page's words about which window it is
    /// are now ignored: the caller is the window the message came from.
    #[test]
    fn a_webview_closes_itself_whatever_label_it_names() {
        let app = app();
        let caller = window(&app, "doc-1");
        let _other = window(&app, "doc-2");

        let (answer, destroyed) = close_from(&caller, serde_json::json!({ "label": "doc-2" }));

        assert!(answer.is_ok(), "{answer:?}");
        assert_eq!(destroyed.len(), 1, "{destroyed:?}");
        assert!(destroyed[0].contains(r#""doc-1""#), "{destroyed:?}");
    }

    #[test]
    fn a_webview_that_names_no_window_still_closes_itself() {
        let app = app();
        let caller = window(&app, "doc-3");

        let (answer, destroyed) = close_from(&caller, serde_json::json!({}));

        assert!(answer.is_ok(), "{answer:?}");
        assert_eq!(destroyed.len(), 1, "{destroyed:?}");
        assert!(destroyed[0].contains(r#""doc-3""#), "{destroyed:?}");
    }
}
