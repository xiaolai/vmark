//! Tests for `workspace/grants/scope.rs` — the recursive workspace grant.
//!
//! WI-LX1.1 — the grant is the widest the app makes, so it is strict (a grant
//! that did not take is an error) and confirmed (a root that moved while it was
//! being granted is refused, and what it moved to is forbidden). Gated like
//! every mock-runtime suite in the crate: tauri's `test` feature is off on
//! Windows.
#![cfg(not(target_os = "windows"))]

use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

use super::{grant_then_confirm, grant_workspace_scope};
use crate::command_error::ErrorCode;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// `<tmp>/root/sub/note.md`: the tempdir, the canonical root, the nested file.
fn workspace() -> (tempfile::TempDir, String, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().join("root");
    std::fs::create_dir_all(root.join("sub")).expect("mkdir");
    let nested = root.join("sub").join("note.md");
    std::fs::write(&nested, b"# hi").expect("write");
    let root = root
        .canonicalize()
        .expect("canonical")
        .to_str()
        .expect("utf-8")
        .to_owned();
    (dir, root, nested)
}

fn readable(app: &tauri::App<tauri::test::MockRuntime>, path: &Path) -> (bool, bool) {
    (
        app.fs_scope().is_allowed(path),
        app.asset_protocol_scope().is_allowed(path),
    )
}

#[test]
fn a_root_is_granted_recursively_to_both_scopes() {
    let app = mock_app();
    let (_dir, root, nested) = workspace();

    grant_workspace_scope(app.handle(), &root).expect("a real folder");

    assert_eq!(readable(&app, &nested), (true, true), "the whole tree");
}

#[test]
fn a_grant_that_does_not_take_is_an_error() {
    let app = mock_app();
    let (_dir, root, _nested) = workspace();
    app.fs_scope()
        .forbid_directory(&root, true)
        .expect("forbid");

    let err = grant_workspace_scope(app.handle(), &root).expect_err("not readable");

    assert_eq!(err.code(), ErrorCode::Internal);
}

/// The swap a name-based check cannot guard: the root was judged, then turned
/// into a link, then granted. Tauri's `push_pattern` (tauri 2.11.5
/// `src/scope/fs.rs:92`, canonical insertion at `:143`, reached from
/// `allow_directory` at `:351`) resolves the name again and ALSO allows what
/// it resolves to — so the grant is reported as failed, never as a root.
#[cfg(unix)]
#[test]
fn a_root_swapped_for_a_link_before_the_grant_is_refused() {
    let app = mock_app();
    let (_dir, root, _nested) = workspace();
    let unchosen = tempfile::tempdir().expect("unchosen");

    let result = grant_then_confirm(app.handle(), &root, |app, root| {
        swap_for_link(root, unchosen.path());
        super::allow_tree(app, root)
    });

    let err = result.expect_err("the root moved while it was being granted");
    assert_eq!(err.code(), ErrorCode::Internal);
}

/// Replace the folder at `root` with a link to `target`.
#[cfg(unix)]
fn swap_for_link(root: &str, target: &Path) {
    std::fs::remove_dir_all(root).expect("rm root");
    std::os::unix::fs::symlink(target, root).expect("link");
}

/// Undoing the stray grant is NOT attempted, because nothing can undo it
/// safely: Tauri has no call that removes an allow pattern, and a forbid
/// pattern outranks every allow. Pointed at a workspace the user DID choose —
/// or at a folder containing one — a revocation would make that workspace
/// unreadable, handing a script a way to lock the user out of their own work.
#[cfg(unix)]
#[test]
fn a_swap_onto_an_authorized_workspace_never_revokes_it() {
    let app = mock_app();
    let (_chosen_dir, chosen, chosen_file) = workspace();
    grant_workspace_scope(app.handle(), &chosen).expect("the user's workspace");
    let (_dir, root, _nested) = workspace();

    let result = grant_then_confirm(app.handle(), &root, |app, root| {
        swap_for_link(root, Path::new(&chosen));
        super::allow_tree(app, root)
    });

    assert!(result.is_err(), "the swap is still detected");
    assert_eq!(
        readable(&app, &chosen_file),
        (true, true),
        "the authorized workspace stays readable"
    );
}

#[cfg(unix)]
#[test]
fn a_swap_onto_a_folder_containing_an_authorized_workspace_never_revokes_it() {
    let app = mock_app();
    let (outer, root, _nested) = workspace();
    let chosen_dir = outer.path().join("chosen");
    std::fs::create_dir_all(&chosen_dir).expect("mkdir");
    let chosen_file = chosen_dir.join("note.md");
    std::fs::write(&chosen_file, b"# mine").expect("write");
    let chosen = chosen_dir.canonicalize().expect("canonical");
    grant_workspace_scope(app.handle(), chosen.to_str().expect("utf-8")).expect("chosen");

    let result = grant_then_confirm(app.handle(), &root, |app, root| {
        swap_for_link(root, outer.path());
        super::allow_tree(app, root)
    });

    assert!(result.is_err(), "the swap is still detected");
    assert_eq!(readable(&app, &chosen_file), (true, true));
}

// -- Dot-prefixed segments inside a granted root -------------------------------
//
// Tauri's glob matcher takes ONE `require_literal_leading_dot` setting for the
// whole scope, so `root/**` pushed by `allow_directory` cannot match a `.name`
// segment unless the scope was configured with the switch off. The scope here
// is built from the real `tauri.conf.json`, so the shipped switch is what is
// tested, not a copy of it.

const TAURI_CONF: &str = include_str!("../../../tauri.conf.json");

fn mock_app_with_shipped_asset_scope() -> tauri::App<tauri::test::MockRuntime> {
    let mut conf: serde_json::Value = serde_json::from_str(TAURI_CONF).expect("tauri.conf.json");
    // Keep the shipped match options but drop the static roots, so only the
    // runtime grant under test can make a path reachable (a temp dir under
    // `$HOME` would otherwise pass for the wrong reason).
    conf["app"]["security"]["assetProtocol"]["scope"]["allow"] = serde_json::json!([]);
    let asset: tauri::utils::config::AssetProtocolConfig =
        serde_json::from_value(conf["app"]["security"]["assetProtocol"].clone())
            .expect("assetProtocol config");
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().app.security.asset_protocol = asset;
    context
        .config_mut()
        .plugins
        .0
        .insert("fs".to_owned(), conf["plugins"]["fs"].clone());
    tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .build(context)
        .expect("build mock app")
}

/// A workspace holding a dot dir, a nested dot dir, a dot file, a CJK dir and a
/// dir with a space, each with one image; plus a sibling folder OUTSIDE it.
fn dotted_workspace() -> (tempfile::TempDir, String, Vec<PathBuf>, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().join("root");
    let mut files = Vec::new();
    for rel in [
        ".gitbook/assets/x.webp",
        "img/.hidden/h.png",
        "img/.a/.b/deep.png",
        "img/.dotfile.png",
        "图片/.隐藏/图.png",
        "my pics/.hid den/p.png",
    ] {
        let file = root.join(rel);
        std::fs::create_dir_all(file.parent().expect("parent")).expect("mkdir");
        std::fs::write(&file, b"x").expect("write");
        files.push(file);
    }
    let outside = dir.path().join("outside");
    std::fs::create_dir_all(outside.join(".secret")).expect("mkdir");
    let secret = outside.join(".secret").join("s.png");
    std::fs::write(&secret, b"x").expect("write");
    let root = root
        .canonicalize()
        .expect("canonical")
        .to_str()
        .expect("utf-8")
        .to_owned();
    (dir, root, files, secret)
}

#[test]
fn dot_prefixed_paths_inside_a_granted_root_are_reachable() {
    let app = mock_app_with_shipped_asset_scope();
    let (_dir, root, files, _secret) = dotted_workspace();
    let files: Vec<PathBuf> = files
        .iter()
        .map(|f| f.canonicalize().expect("canonical"))
        .collect();
    for file in &files {
        assert_eq!(
            readable(&app, file),
            (false, false),
            "{file:?} before the grant"
        );
    }

    grant_workspace_scope(app.handle(), &root).expect("a real folder");

    for file in &files {
        assert_eq!(readable(&app, file), (true, true), "{file:?}");
    }
}

#[test]
fn dot_paths_outside_every_granted_root_stay_refused() {
    let app = mock_app_with_shipped_asset_scope();
    let (_dir, root, _files, secret) = dotted_workspace();

    grant_workspace_scope(app.handle(), &root).expect("a real folder");

    let escaped = Path::new(&root)
        .join("..")
        .join("outside")
        .join(".secret")
        .join("s.png");
    assert_eq!(readable(&app, &secret), (false, false), "a sibling folder");
    assert_eq!(
        readable(&app, &escaped),
        (false, false),
        "`..` out of the root"
    );
}

/// A link inside the root to a dot folder outside it is reachable by neither
/// name: Tauri canonicalizes before matching, so the grant never follows it.
#[cfg(unix)]
#[test]
fn a_link_out_of_the_root_to_a_dot_folder_stays_refused() {
    let app = mock_app_with_shipped_asset_scope();
    let (dir, root, _files, secret) = dotted_workspace();
    let link = Path::new(&root).join("escape");
    std::os::unix::fs::symlink(dir.path().join("outside").join(".secret"), &link).expect("link");

    grant_workspace_scope(app.handle(), &root).expect("a real folder");

    assert_eq!(readable(&app, &link.join("s.png")), (false, false));
    assert_eq!(readable(&app, &secret), (false, false));
}
