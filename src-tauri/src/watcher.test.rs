//! Tests for `watcher.rs` (included via `#[path]`).
//!
//! WI-RA11.1 — a watcher that lost track of the tree says so (an error or the
//! OS's overflow report becomes a rescan), and its batches reach only the
//! window that owns it.

use super::*;
use notify::event::{AccessKind, CreateKind, DataChange, Flag, ModifyKind, RemoveKind, RenameMode};
use notify::EventKind;
use std::path::PathBuf;

fn scope(root: &str) -> WatchScope {
    WatchScope {
        watch_id: "main".to_string(),
        root_path: root.to_string(),
        canonical_root: root.to_string(),
    }
}

fn event(kind: EventKind, paths: &[&str]) -> Event {
    paths.iter().fold(Event::new(kind), |event, path| {
        event.add_path(PathBuf::from(path))
    })
}

fn change(kind: FsChangeKind, paths: &[&str]) -> Signal {
    Signal::Change(FsChange {
        kind,
        paths: paths.iter().map(|p| p.to_string()).collect(),
    })
}

// ── classification ───────────────────────────────────────────────────────────

#[test]
fn test_event_kind_create() {
    let kind = EventKind::Create(CreateKind::File);
    assert_eq!(
        classify_kind(&kind),
        KindClass::Change(FsChangeKind::Create)
    );
}

#[test]
fn test_event_kind_modify() {
    let kind = EventKind::Modify(ModifyKind::Data(DataChange::Content));
    assert_eq!(
        classify_kind(&kind),
        KindClass::Change(FsChangeKind::Modify)
    );
}

#[test]
fn test_event_kind_rename() {
    let kind = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
    assert_eq!(
        classify_kind(&kind),
        KindClass::Change(FsChangeKind::Rename)
    );
}

#[test]
fn test_event_kind_remove() {
    let kind = EventKind::Remove(RemoveKind::File);
    assert_eq!(
        classify_kind(&kind),
        KindClass::Change(FsChangeKind::Remove)
    );
}

#[test]
fn test_event_kind_access_ignored() {
    let kind = EventKind::Access(AccessKind::Read);
    assert_eq!(classify_kind(&kind), KindClass::Ignore);
}

#[test]
fn an_event_about_the_watch_itself_asks_for_a_rescan() {
    // `Other` is how notify reports a dropped-events / must-rescan condition.
    // Ignoring it left the explorer stale after a burst.
    assert_eq!(classify_kind(&EventKind::Other), KindClass::Rescan);
    // `Any` is an event notify could not classify: unknown is not "nothing".
    assert_eq!(classify_kind(&EventKind::Any), KindClass::Rescan);
}

// ── notify result → signal ───────────────────────────────────────────────────

#[test]
fn a_watcher_error_asks_for_a_rescan() {
    let error = notify::Error::generic("FSEvents stream failed");
    assert_eq!(signal_for(Err(error), &scope("/ws")), Some(Signal::Rescan));
}

#[test]
fn the_os_overflow_report_asks_for_a_rescan() {
    // What notify emits for FSEvents `MustScanSubDirs` and an inotify queue
    // overflow: kind `Other`, flag `Rescan`, no paths.
    let overflow = Event::new(EventKind::Other).set_flag(Flag::Rescan);
    assert_eq!(
        signal_for(Ok(overflow), &scope("/ws")),
        Some(Signal::Rescan)
    );
}

#[test]
fn a_rescan_flag_wins_over_the_event_kind() {
    let flagged = event(EventKind::Create(CreateKind::File), &["/ws/a.md"]).set_flag(Flag::Rescan);
    assert_eq!(signal_for(Ok(flagged), &scope("/ws")), Some(Signal::Rescan));
}

#[test]
fn a_change_carries_its_kind_and_paths() {
    let created = event(EventKind::Create(CreateKind::File), &["/ws/笔记.md"]);
    assert_eq!(
        signal_for(Ok(created), &scope("/ws")),
        Some(change(FsChangeKind::Create, &["/ws/笔记.md"]))
    );
}

#[test]
fn a_read_is_not_a_signal() {
    let read = event(EventKind::Access(AccessKind::Read), &["/ws/a.md"]);
    assert_eq!(signal_for(Ok(read), &scope("/ws")), None);
}

#[test]
fn a_change_with_only_ignored_paths_is_not_a_signal() {
    let noise = event(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &["/ws/.git/index", "/ws/node_modules/pkg/index.js"],
    );
    assert_eq!(signal_for(Ok(noise), &scope("/ws")), None);
}

#[test]
fn an_atomic_write_rename_keeps_only_its_visible_target() {
    // temp → target: the temp half is noise, the target half is the change.
    let rename = event(
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
        &["/ws/.tmpAb12Cd", "/ws/note.md"],
    );
    assert_eq!(
        signal_for(Ok(rename), &scope("/ws")),
        Some(change(FsChangeKind::Rename, &["/ws/note.md"]))
    );
}

#[test]
fn signal_paths_are_spelled_under_the_requested_root() {
    let scope = WatchScope {
        watch_id: "main".to_string(),
        root_path: "/var/ws".to_string(),
        canonical_root: "/private/var/ws".to_string(),
    };
    let modified = event(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &["/private/var/ws/a.md"],
    );
    assert_eq!(
        signal_for(Ok(modified), &scope),
        Some(change(FsChangeKind::Modify, &["/var/ws/a.md"]))
    );
}

// ── ignore list ──────────────────────────────────────────────────────────────

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

// ── delivery and lifecycle, on a mock runtime ────────────────────────────────
//
// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature off it), so these are gated like every mock-runtime suite.

#[cfg(not(target_os = "windows"))]
mod on_a_mock_app {
    use super::super::*;
    use crate::command_error::ErrorCode;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tauri::Listener;

    type MockApp = tauri::App<tauri::test::MockRuntime>;
    type MockWindow = tauri::WebviewWindow<tauri::test::MockRuntime>;

    fn mock_app() -> MockApp {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    fn window(app: &MockApp, label: &str) -> MockWindow {
        tauri::webview::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("build mock window")
    }

    /// Count `fs:changed` deliveries to one window. Rust listeners run inside
    /// the emit, so a count read after it is final.
    fn deliveries(window: &MockWindow) -> Arc<AtomicUsize> {
        let seen = Arc::new(AtomicUsize::new(0));
        let sink = Arc::clone(&seen);
        window.listen(FS_CHANGED_EVENT, move |_| {
            sink.fetch_add(1, Ordering::SeqCst);
        });
        seen
    }

    fn is_registered(watch_id: &str) -> bool {
        lock_watchers()
            .as_ref()
            .is_some_and(|watchers| watchers.contains_key(watch_id))
    }

    #[test]
    fn a_batch_is_delivered_only_to_the_window_that_owns_the_watcher() {
        let app = mock_app();
        let owner = deliveries(&window(&app, "ra11-owner"));
        let bystander = deliveries(&window(&app, "ra11-bystander"));

        emit_batch(
            app.handle(),
            &FsChangeBatch {
                watch_id: "ra11-owner".to_string(),
                root_path: "/ws".to_string(),
                changes: vec![],
                rescan: true,
            },
        );

        assert_eq!(owner.load(Ordering::SeqCst), 1);
        assert_eq!(
            bystander.load(Ordering::SeqCst),
            0,
            "another window must not be woken by this window's watcher"
        );
    }

    #[test]
    fn starting_registers_the_watcher_and_stopping_removes_it() {
        let app = mock_app();
        let _window = window(&app, "ra11-lifecycle");
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        start_watching_blocking(app.handle(), "ra11-lifecycle".to_string(), root.clone())
            .expect("watcher starts");
        assert!(is_registered("ra11-lifecycle"));

        // Starting again replaces the watcher rather than adding a second.
        start_watching_blocking(app.handle(), "ra11-lifecycle".to_string(), root)
            .expect("watcher restarts");
        assert!(is_registered("ra11-lifecycle"));

        stop_watching("ra11-lifecycle".to_string()).expect("stop is infallible");
        assert!(!is_registered("ra11-lifecycle"));
        // Idempotent: the window-destroyed cleanup and the frontend both stop.
        stop_watching("ra11-lifecycle".to_string()).expect("stopping twice is fine");
    }

    /// True when one `fs:changed` payload names a create or modify of the
    /// file the test writes. A startup rescan carries `rescan: true` and no
    /// changes, so it cannot stand in for the write the backend must report.
    fn reports_the_note_write(payload: &str) -> bool {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
            return false;
        };
        value["changes"].as_array().is_some_and(|changes| {
            changes.iter().any(|change| {
                let kind = change["kind"].as_str().unwrap_or_default();
                (kind == "create" || kind == "modify")
                    && change["paths"].as_array().is_some_and(|paths| {
                        paths
                            .iter()
                            .any(|path| path.as_str().is_some_and(|p| p.ends_with("note.md")))
                    })
            })
        })
    }

    /// The OS backend itself, end to end: a real write under a watched root
    /// must reach the owning window as an `fs:changed` batch naming the file.
    /// The tests above pin what each notify event maps to; this one proves the
    /// backend still produces those events (FSEvents on macOS, inotify on
    /// Linux). The write repeats until the payload lands, so a coalesced or
    /// slow first notification cannot flake the assertion.
    #[test]
    fn a_real_file_write_is_delivered_to_the_owning_window() {
        let app = mock_app();
        let win = window(&app, "ra11-real-event");
        let delivered = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&delivered);
        win.listen(FS_CHANGED_EVENT, move |event| {
            if reports_the_note_write(event.payload()) {
                seen.fetch_add(1, Ordering::SeqCst);
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let file = dir.path().join("note.md");

        start_watching_blocking(app.handle(), "ra11-real-event".to_string(), root)
            .expect("watcher starts");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut attempt = 0;
        while delivered.load(Ordering::SeqCst) == 0 && std::time::Instant::now() < deadline {
            attempt += 1;
            std::fs::write(&file, format!("# write {attempt}\n")).expect("write under the root");
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        stop_watching("ra11-real-event".to_string()).expect("stop is infallible");

        assert!(
            delivered.load(Ordering::SeqCst) > 0,
            "a write to note.md must be delivered as a {FS_CHANGED_EVENT} create/modify"
        );
    }

    #[test]
    fn a_watcher_started_for_a_window_that_is_gone_is_not_left_behind() {
        // The window-destroyed cleanup already ran: nobody else will ever stop
        // a watcher registered under this label.
        let app = mock_app();
        let dir = tempfile::tempdir().unwrap();

        let error = start_watching_blocking(
            app.handle(),
            "ra11-closed".to_string(),
            dir.path().to_string_lossy().to_string(),
        )
        .expect_err("a closed window cannot own a watcher");

        assert_eq!(error.code(), ErrorCode::Conflict);
        assert!(!is_registered("ra11-closed"));
    }

    #[test]
    fn a_missing_path_is_reported_as_not_found() {
        let app = mock_app();
        let _window = window(&app, "ra11-missing");
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("no-such-dir");

        let error = start_watching_blocking(
            app.handle(),
            "ra11-missing".to_string(),
            gone.to_string_lossy().to_string(),
        )
        .expect_err("a missing root cannot be watched");

        assert_eq!(error.code(), ErrorCode::NotFound);
        assert!(!is_registered("ra11-missing"));
    }
}
