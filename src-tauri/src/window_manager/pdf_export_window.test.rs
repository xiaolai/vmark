//! Export-PDF window (#1377).
//!
//! The defect: the window was created from TypeScript with
//! `new WebviewWindow("pdf-export", …)`, and Tauri's JS window options carry no
//! `menu` field. Off macOS the menu bar belongs to each window, so a 440x640
//! utility dialog opened carrying the whole application menu.
//!
//! Building a real window needs a running app, which these tests do not have.
//! So the URL builder is tested directly, and the menu decision — the actual
//! fix, and a `cfg`-gated line no host-target test can execute — is asserted
//! against the SOURCE, the same instrument `menu/localized.test.rs` uses for
//! accelerator call sites.

use super::*;

/// This file's own text, for the source-level assertions below.
const SOURCE: &str = include_str!("pdf_export_window.rs");

#[test]
fn url_carries_the_html_path() {
    assert_eq!(
        pdf_export_url("/tmp/export.html", None),
        "/pdf-export?htmlPath=%2Ftmp%2Fexport.html"
    );
}

#[test]
fn url_percent_encodes_a_name_that_would_corrupt_the_query() {
    // A document titled `a&b?c#d` must not append a second parameter or a
    // fragment — the same reasoning settings_url records.
    let url = pdf_export_url("/tmp/x.html", Some("a&b?c#d"));
    assert!(
        !url.contains("&b"),
        "an unencoded `&` starts a new query parameter: {url}"
    );
    assert!(
        !url.contains('#'),
        "an unencoded `#` starts a fragment: {url}"
    );
    assert!(url.contains("defaultName=a%26b%3Fc%23d"), "{url}");
}

#[test]
fn url_omits_an_empty_name_rather_than_sending_a_blank_one() {
    assert_eq!(
        pdf_export_url("/tmp/x.html", Some("")),
        "/pdf-export?htmlPath=%2Ftmp%2Fx.html"
    );
}

#[test]
fn label_matches_the_one_progress_events_are_emitted_to() {
    // pdf_export::renderer::progress::PROGRESS_WINDOW addresses this window by
    // name. If the two ever diverge the export dialog sits on "Preparing…"
    // forever, because every progress event goes to a window that is not there.
    assert_eq!(
        PDF_EXPORT_LABEL,
        crate::pdf_export::renderer::progress::PROGRESS_WINDOW
    );
}

#[test]
fn attaches_an_empty_menu_off_macos_and_only_off_macos() {
    // The fix itself. `Menu::new` with nothing added is what the Settings
    // window uses to open bare; without it the window inherits the application
    // menu on Linux and Windows.
    assert!(
        SOURCE.contains("tauri::menu::Menu::new(app)"),
        "no empty-menu attachment — #1377 returns"
    );

    // And it must stay behind `cfg(not(target_os = \"macos\"))`: macOS has ONE
    // app-global menu bar, so attaching an empty menu there would blank the
    // application menu rather than tidy a dialog.
    let menu_at = SOURCE
        .find("tauri::menu::Menu::new(app)")
        .expect("checked above");
    let guard_at = SOURCE
        .find("#[cfg(not(target_os = \"macos\"))]")
        .expect("no non-macOS cfg block");
    assert!(
        guard_at < menu_at,
        "the empty menu is not inside the non-macOS block; on macOS it would \
         replace the application menu"
    );
}

#[test]
fn creates_the_window_asynchronously() {
    // A sync command builds the window on the thread that delivered the IPC
    // message, which on Windows is inside WebView2's WebMessageReceived
    // callback — the reentrancy case that hung #1301/#1302 with a process Task
    // Manager could not end. lint:window-thread enforces this repo-wide; this
    // states it at the site so the reason survives next to the code.
    assert!(
        SOURCE.contains("#[tauri::command(async)]"),
        "window creation must be async"
    );
}

// -- WI-RA7.2: replacing the previous export window --------------------------
//
// The command closes any previous export window and rebuilds under the same
// label. `close()` only posts a request, so the rebuild used to run while the
// old label was still registered and failed with `WindowLabelAlreadyExists` —
// an export that sometimes did not open. It now waits for the old window to
// be destroyed, and says so plainly when the label is still held.

// `tauri::test` does not exist on Windows (see Cargo.toml's target-specific
// dev-dependency); every mock-runtime test in this crate is gated to match.
#[cfg(not(target_os = "windows"))]
mod replacing_the_previous_window {
    use std::time::Duration;

    use tauri::Manager;

    use super::super::{open_export_window, pdf_export_url, PDF_EXPORT_LABEL};
    use crate::command_error::ErrorCode;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    #[test]
    fn with_no_previous_window_the_export_window_opens_on_its_page() {
        let app = mock_app();
        let url = pdf_export_url("/tmp/导出 a&b.html", Some("Doc"));

        let label = open_export_window(app.handle(), url, None, Duration::ZERO)
            .expect("nothing to replace, so nothing to wait for");

        assert_eq!(label, PDF_EXPORT_LABEL);
        let window = app
            .get_webview_window(PDF_EXPORT_LABEL)
            .expect("the export window exists");
        let url = window.url().expect("url");
        assert_eq!(url.path(), "/pdf-export");
        assert!(
            url.query().is_some_and(|q| q.contains("htmlPath=")),
            "{url}"
        );
    }

    /// The mock runtime never reports a closed window destroyed, so its label
    /// stays registered — exactly the state the rebuild used to race into.
    #[test]
    fn a_previous_window_whose_label_is_still_held_is_a_conflict_not_a_failed_build() {
        let app = mock_app();
        tauri::webview::WebviewWindowBuilder::new(
            app.handle(),
            PDF_EXPORT_LABEL,
            tauri::WebviewUrl::default(),
        )
        .visible(false)
        .build()
        .expect("the previous export window");

        let error = open_export_window(
            app.handle(),
            pdf_export_url("/tmp/next.html", None),
            Some((10.0, 20.0)),
            Duration::ZERO,
        )
        .expect_err("the label is still held, so no window may be built over it");

        assert_eq!(
            error.code(),
            ErrorCode::Conflict,
            "the builder must not be run against a label that is still registered: {}",
            error.message()
        );
        assert_eq!(app.webview_windows().len(), 1, "no second export window");
    }
}

// The wait itself, driven by the channel the `Destroyed` listener writes to.
// No clock is involved: a zero limit asks "has it happened already?".

#[test]
fn a_destroyed_window_ends_the_wait() {
    let (destroyed, gone) = std::sync::mpsc::channel();
    destroyed.send(()).expect("receiver alive");
    assert!(await_destroyed(&gone, std::time::Duration::ZERO).is_ok());
}

#[test]
fn a_window_that_has_not_closed_within_the_limit_is_a_timeout_that_says_so() {
    let (_still_listening, gone) = std::sync::mpsc::channel::<()>();
    let error = await_destroyed(&gone, std::time::Duration::ZERO)
        .expect_err("nothing was destroyed, so the rebuild must not proceed");
    assert_eq!(error.code(), ErrorCode::Timeout);
    assert_eq!(error.i18n_key(), Some("errors.window.pdfExportCreate"));
    assert!(
        error.message().contains("did not close within 0 ms"),
        "the reason reaches the user: {}",
        error.message()
    );
}

#[test]
fn listeners_dropped_without_the_event_end_the_wait_for_the_label_check_to_decide() {
    // A window that is already gone drops its listeners; waiting out the limit
    // for an event that can no longer come would only delay the answer.
    let (destroyed, gone) = std::sync::mpsc::channel::<()>();
    drop(destroyed);
    assert!(await_destroyed(&gone, std::time::Duration::from_secs(3600)).is_ok());
}

// The HTML hand-off ends with the window that read it.

#[test]
fn the_hand_off_file_is_discarded_when_the_window_is_destroyed_and_not_before() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = crate::temp_html::write_temp_html_to_dir(dir.path(), "<p>doc</p>").expect("write");

    // Still open (a reload may read it again): the file stays.
    discard_html_when_destroyed(&tauri::WindowEvent::Focused(false), dir.path(), &path);
    assert!(path.exists(), "only Destroyed ends the hand-off");

    discard_html_when_destroyed(&tauri::WindowEvent::Destroyed, dir.path(), &path);
    assert!(!path.exists(), "a destroyed window's HTML is removed");
}

#[test]
fn the_command_registers_the_discard_on_the_window_it_opened() {
    // The mock runtime never delivers `Destroyed`, so the registration itself
    // cannot be driven; without it the hand-off file waits for the hour-old
    // sweep. Pinned at the source, like the menu decision above.
    let command = SOURCE
        .split("pub fn open_pdf_export_window(")
        .nth(1)
        .and_then(|rest| rest.split("\n}\n").next())
        .expect("open_pdf_export_window body");
    assert!(
        command.contains(
            "on_window_event(move |event| discard_html_when_destroyed(event, &dir, &path))"
        ),
        "the export window must discard its HTML when destroyed:\n{command}"
    );
}
