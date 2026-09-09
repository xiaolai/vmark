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
        SOURCE.contains("tauri::menu::Menu::new(&app)"),
        "no empty-menu attachment — #1377 returns"
    );

    // And it must stay behind `cfg(not(target_os = \"macos\"))`: macOS has ONE
    // app-global menu bar, so attaching an empty menu there would blank the
    // application menu rather than tidy a dialog.
    let menu_at = SOURCE
        .find("tauri::menu::Menu::new(&app)")
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
