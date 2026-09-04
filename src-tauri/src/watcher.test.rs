//! Tests for `watcher.rs` (moved from the inline `#[cfg(test)]` module;
//! included via `#[path]`).

use super::*;
use notify::EventKind;

#[test]
fn test_event_kind_create() {
    let kind = EventKind::Create(notify::event::CreateKind::File);
    assert_eq!(event_kind_to_string(&kind), Some("create"));
}

#[test]
fn test_event_kind_modify() {
    let kind = EventKind::Modify(notify::event::ModifyKind::Data(
        notify::event::DataChange::Content,
    ));
    assert_eq!(event_kind_to_string(&kind), Some("modify"));
}

#[test]
fn test_event_kind_remove() {
    let kind = EventKind::Remove(notify::event::RemoveKind::File);
    assert_eq!(event_kind_to_string(&kind), Some("remove"));
}

#[test]
fn test_event_kind_access_ignored() {
    let kind = EventKind::Access(notify::event::AccessKind::Read);
    assert_eq!(event_kind_to_string(&kind), None);
}

#[test]
fn test_event_kind_other_ignored() {
    let kind = EventKind::Other;
    assert_eq!(event_kind_to_string(&kind), None);
}

#[test]
fn test_ignore_git_dir() {
    assert!(should_ignore_path(Path::new("/project/.git/objects/abc")));
    assert!(should_ignore_path(Path::new("/project/.git/HEAD")));
}

#[test]
fn test_ignore_obsidian_dir() {
    assert!(should_ignore_path(Path::new(
        "/vault/.obsidian/workspace.json"
    )));
    assert!(should_ignore_path(Path::new(
        "/vault/.obsidian/plugins/foo"
    )));
}

#[test]
fn test_ignore_node_modules() {
    assert!(should_ignore_path(Path::new(
        "/project/node_modules/pkg/index.js"
    )));
}

#[test]
fn test_allow_dot_directories_not_in_ignore_list() {
    // User-visible dot-directories must NOT be filtered — external change
    // detection depends on events reaching the frontend.
    assert!(!should_ignore_path(Path::new(
        "/project/.github/workflows/ci.yml"
    )));
    assert!(!should_ignore_path(Path::new(
        "/project/.vscode/settings.json"
    )));
    assert!(!should_ignore_path(Path::new("/home/.config/app.toml")));
    assert!(!should_ignore_path(Path::new("/project/.husky/pre-commit")));
    assert!(!should_ignore_path(Path::new(
        "/project/.devcontainer/devcontainer.json"
    )));
}

#[test]
fn test_allow_normal_paths() {
    assert!(!should_ignore_path(Path::new("/project/src/foo.md")));
    assert!(!should_ignore_path(Path::new("/project/notes/chapter1.md")));
    assert!(!should_ignore_path(Path::new("/project/README.md")));
}

#[test]
fn test_ignore_ds_store() {
    assert!(should_ignore_path(Path::new("/project/.DS_Store")));
}

#[test]
fn test_ignore_pycache() {
    assert!(should_ignore_path(Path::new(
        "/project/__pycache__/mod.pyc"
    )));
}

#[test]
fn test_ignore_temp_files_from_named_temp_file() {
    // NamedTempFile creates files like ".tmpXXXXXX"
    assert!(should_ignore_path(Path::new("/workspace/.tmpabcdef")));
    assert!(should_ignore_path(Path::new("/workspace/.tmp123456")));
}

#[test]
fn test_ignore_temp_files_from_app_paths() {
    // app_paths.rs creates files like ".{name}.tmp.{pid}"
    assert!(should_ignore_path(Path::new(
        "/workspace/.test.md.tmp.12345"
    )));
    assert!(should_ignore_path(Path::new("/workspace/.notes.tmp.9999")));
}

#[test]
fn test_allow_normal_tmp_extension() {
    // Files that happen to end in .tmp but aren't our temp files
    // should still be allowed (no ".tmp." infix, no ".tmp" prefix)
    assert!(!should_ignore_path(Path::new("/workspace/notes.md")));
    assert!(!should_ignore_path(Path::new("/workspace/data.txt")));
}

// --- debounce keying -------------------------------------------------

#[test]
fn test_debounce_suppresses_same_kind_within_window() {
    let mut map = HashMap::new();
    let now = Instant::now();
    assert!(should_emit_and_record(
        &mut map, "main", "/ws/a.md", "modify", now
    ));
    // Same kind, 50ms later — inside the 200ms window, suppressed.
    let later = now + Duration::from_millis(50);
    assert!(!should_emit_and_record(
        &mut map, "main", "/ws/a.md", "modify", later
    ));
}

#[test]
fn test_debounce_does_not_swallow_different_kind() {
    // A `create` followed by a `remove` within the window must both emit —
    // suppressing the remove would leave a phantom file in the frontend.
    let mut map = HashMap::new();
    let now = Instant::now();
    assert!(should_emit_and_record(
        &mut map, "main", "/ws/a.md", "create", now
    ));
    let later = now + Duration::from_millis(50);
    assert!(should_emit_and_record(
        &mut map, "main", "/ws/a.md", "remove", later
    ));
}

#[test]
fn test_debounce_emits_same_kind_after_window() {
    let mut map = HashMap::new();
    let now = Instant::now();
    assert!(should_emit_and_record(
        &mut map, "main", "/ws/a.md", "modify", now
    ));
    let after = now + DEBOUNCE_INTERVAL + Duration::from_millis(1);
    assert!(should_emit_and_record(
        &mut map, "main", "/ws/a.md", "modify", after
    ));
}

#[test]
fn test_debounce_is_scoped_per_watch_id_and_path() {
    let mut map = HashMap::new();
    let now = Instant::now();
    assert!(should_emit_and_record(
        &mut map, "main", "/ws/a.md", "modify", now
    ));
    // Different watcher and different path are independent keys.
    assert!(should_emit_and_record(
        &mut map, "doc-1", "/ws/a.md", "modify", now
    ));
    assert!(should_emit_and_record(
        &mut map, "main", "/ws/b.md", "modify", now
    ));
}

#[test]
fn test_fs_change_event_serialization() {
    let event = FsChangeEvent {
        watch_id: "main".to_string(),
        root_path: "/Users/test".to_string(),
        paths: vec!["/Users/test/file.md".to_string()],
        kind: "modify".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"watchId\":\"main\""));
    assert!(json.contains("\"rootPath\":\"/Users/test\""));
    assert!(json.contains("\"kind\":\"modify\""));
}

// ── #1357 live check: events under a symlinked root must stay in scope ────────

#[test]
fn a_path_reported_under_the_canonical_root_is_rebased_onto_the_requested_root() {
    // macOS: a root given as /var/… is reported as /private/var/….
    assert_eq!(
        rebase_onto_root(
            "/private/var/folders/x/ws/new.md",
            "/var/folders/x/ws",
            "/private/var/folders/x/ws"
        ),
        "/var/folders/x/ws/new.md"
    );
    // The root itself.
    assert_eq!(
        rebase_onto_root("/private/var/ws", "/var/ws", "/private/var/ws"),
        "/var/ws"
    );
}

#[test]
fn a_canonical_root_leaves_paths_untouched_and_a_sibling_prefix_never_matches() {
    assert_eq!(
        rebase_onto_root("/home/me/ws/a.md", "/home/me/ws", "/home/me/ws"),
        "/home/me/ws/a.md"
    );
    // `/root2/…` is not under `/root`.
    assert_eq!(
        rebase_onto_root("/real/root2/a.md", "/link/root", "/real/root"),
        "/real/root2/a.md"
    );
    // A path outside the root comes back as reported.
    assert_eq!(
        rebase_onto_root("/elsewhere/a.md", "/link/root", "/real/root"),
        "/elsewhere/a.md"
    );
}

#[cfg(unix)]
#[test]
fn a_root_reached_through_a_real_symlink_rebases_the_os_spelling() {
    let dir = tempfile::tempdir().unwrap();
    let real = dir.path().join("real");
    std::fs::create_dir(&real).unwrap();
    let link = dir.path().join("link");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let requested = link.to_string_lossy().to_string();
    let canonical = std::fs::canonicalize(&link)
        .unwrap()
        .to_string_lossy()
        .to_string();
    let reported = format!("{canonical}/note.md");
    assert_eq!(
        rebase_onto_root(&reported, &requested, &canonical),
        format!("{requested}/note.md")
    );
}
