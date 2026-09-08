//! Tests for second-launch handling (#1330).
//!
//! The argv→files decision is pure and pinned first: a dropped `skip(1)`
//! opens the executable, a missing filter opens a `.exe` as a document. The
//! routing and the surfacing (#246) run on a mock runtime below: a launch
//! with a file forwards exactly that file and opens nothing, a bare launch
//! reveals a hidden window or builds one when none is left.

use super::openable_files_from_argv;

/// Real files on disk — `filter_supported_args` calls `is_file()`, so a
/// fabricated path would be rejected for the wrong reason and the test would
/// pass no matter what the filter did.
struct Fixture {
    dir: std::path::PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("vmark-single-instance-{tag}"));
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Self { dir }
    }

    fn file(&self, name: &str) -> String {
        let path = self.dir.join(name);
        std::fs::write(&path, b"# doc\n").expect("write fixture file");
        path.to_string_lossy().into_owned()
    }

    fn subdir(&self, name: &str) -> String {
        let path = self.dir.join(name);
        std::fs::create_dir_all(&path).expect("create fixture subdir");
        path.to_string_lossy().into_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn empty_argv_asks_for_nothing() {
    assert!(openable_files_from_argv(Vec::new()).is_empty());
}

#[test]
fn a_bare_launch_carries_no_files() {
    // Double-clicking the app icon while VMark is already running.
    assert!(openable_files_from_argv(vec!["C:/Program Files/VMark/vmark.exe".into()]).is_empty());
}

#[test]
fn forwards_the_supported_files_after_argv0() {
    let fx = Fixture::new("forwards");
    let note = fx.file("note.md");
    let data = fx.file("data.yaml");

    let files =
        openable_files_from_argv(vec!["/opt/vmark/vmark".into(), note.clone(), data.clone()]);

    assert_eq!(files, vec![note, data]);
}

#[test]
fn argv0_is_dropped_before_the_gate_not_after() {
    // The regression a missing `skip(1)` produces. argv[0] is a REAL openable
    // file here, so the filter alone cannot reject it — only the skip can. A
    // contrived program name, but the failure it guards (opening the program
    // itself as a document) is the same one a `.md`-suffixed launcher causes.
    let fx = Fixture::new("argv0");
    let program = fx.file("vmark.md");
    let note = fx.file("note.md");

    let files = openable_files_from_argv(vec![program, note.clone()]);

    assert_eq!(files, vec![note]);
}

#[test]
fn drops_paths_this_app_cannot_open() {
    let fx = Fixture::new("drops");
    let note = fx.file("note.md");
    let binary = fx.file("installer.exe");
    let folder = fx.subdir("a-folder");
    let missing = fx.dir.join("gone.md").to_string_lossy().into_owned();

    let files = openable_files_from_argv(vec![
        "/opt/vmark/vmark".into(),
        binary,
        folder,
        missing,
        note.clone(),
    ]);

    // A directory is dropped rather than opened as a workspace: that matches
    // the cold-start CLI path in `app_setup`, which filters argv identically.
    // Changing it is a product decision, and it belongs in both places at once.
    assert_eq!(files, vec![note]);
}

// -- #246: routing and surfacing, on a mock runtime --------------------------
//
// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature off it), so these are gated like every mock-runtime suite.

#[cfg(not(target_os = "windows"))]
mod on_a_mock_app {
    use super::super::{
        create_and_reveal_main, reveal_or_retry, second_launch_with, surface_a_window,
    };
    use super::Fixture;
    use std::cell::RefCell;
    use tauri::Manager;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    fn hidden_document_window(
        app: &tauri::App<tauri::test::MockRuntime>,
        label: &str,
    ) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        tauri::webview::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("build mock document window")
    }

    #[test]
    fn a_launch_with_a_file_forwards_exactly_that_file_and_opens_no_window() {
        let fx = Fixture::new("forward-mock");
        let note = fx.file("note.md");
        let app = mock_app();
        let forwarded = RefCell::new(None);

        second_launch_with(
            app.handle(),
            vec!["/opt/vmark/vmark".into(), note.clone()],
            |_, files| {
                *forwarded.borrow_mut() = Some(files);
            },
        );

        assert_eq!(forwarded.into_inner(), Some(vec![note]));
        assert!(
            app.webview_windows().is_empty(),
            "forwarding delivers to a window; surfacing here would open a second one"
        );
    }

    #[test]
    fn a_bare_launch_with_no_window_left_creates_the_main_window_and_forwards_nothing() {
        let app = mock_app();
        second_launch_with(app.handle(), vec!["/opt/vmark/vmark".into()], |_, _| {
            panic!("a bare launch has nothing to forward");
        });
        assert!(
            app.get_webview_window("main").is_some(),
            "no document window was left, so one is built"
        );
        assert_eq!(app.webview_windows().len(), 1);
    }

    #[test]
    fn a_bare_launch_surfaces_the_existing_document_window_instead_of_building_another() {
        // MockRuntime reports every window visible and its `show()` is a
        // no-op, so the reveal itself cannot be observed here; what can be
        // is the choice — an existing document window is surfaced and no
        // second one is built, which is the half that goes wrong silently.
        let app = mock_app();
        let _window = hidden_document_window(&app, "doc-3");

        surface_a_window(app.handle());

        assert_eq!(app.webview_windows().len(), 1, "no second window");
        assert!(app.get_webview_window("doc-3").is_some());
        assert!(app.get_webview_window("main").is_none());
    }

    #[test]
    fn a_non_document_window_does_not_count_as_a_window_to_surface() {
        // Settings is not a document window; with only Settings open, a bare
        // launch still needs a document window built.
        let app = mock_app();
        let _settings = hidden_document_window(&app, "settings");
        surface_a_window(app.handle());
        assert!(app.get_webview_window("main").is_some());
    }

    // ===== #478/#479 — surfacing a window is TOTAL ========================

    #[test]
    fn a_target_that_closed_while_it_was_being_chosen_surfaces_the_next_one() {
        // The window list is a snapshot taken under no lock, so the chosen
        // window can be gone by the time it is looked up. Returning silently
        // there made the second launch do nothing at all — which, from the
        // outside, is exactly what "the launch was ignored" looks like.
        let app = mock_app();
        let live = hidden_document_window(&app, "doc-2");

        reveal_or_retry(app.handle(), "doc-1-已关闭");

        assert!(
            app.get_webview_window("doc-2").is_some(),
            "the live window is what a second launch should surface"
        );
        assert_eq!(
            app.webview_windows().len(),
            1,
            "a live window was available, so nothing new is built"
        );
        drop(live);
    }

    #[test]
    fn a_target_that_closed_with_nothing_left_builds_a_window_rather_than_doing_nothing() {
        let app = mock_app();
        reveal_or_retry(app.handle(), "doc-1");
        assert!(
            app.get_webview_window("main").is_some(),
            "nothing was left to surface, so one is built"
        );
    }

    #[test]
    fn a_creation_that_lost_the_label_race_surfaces_the_winners_window() {
        // Window creation is check-then-create against every other path in
        // the process. Losing that race is not a failure — the user asked for
        // a window and there is one — but it used to log
        // `WindowLabelAlreadyExists` and leave the screen unchanged.
        let app = mock_app();
        let winner = hidden_document_window(&app, "main");

        create_and_reveal_main(app.handle());

        assert_eq!(
            app.webview_windows().len(),
            1,
            "the loser must not build a second window beside the winner's"
        );
        assert!(app.get_webview_window("main").is_some());
        drop(winner);
    }
}
