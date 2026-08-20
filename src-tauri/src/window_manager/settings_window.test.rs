//! Tests for `settings_window.rs` (included via `#[path]`).
//!
//! `show_settings_window_section` itself needs a live Tauri runtime, so what
//! is covered here is the pure part it delegates to: turning an optional
//! section into the URL the Settings window is built with. That URL is the
//! one difference between the two Settings entry points (#1141), so it is
//! worth pinning down exactly.

use super::*;

#[test]
fn no_section_is_the_bare_route() {
    assert_eq!(settings_url(None), "/settings");
}

#[test]
fn section_becomes_a_query_param() {
    assert_eq!(
        settings_url(Some("integrations")),
        "/settings?section=integrations"
    );
}

/// Every section the frontend's `validSections` accepts must survive the
/// round trip unescaped — they are all plain lowercase words, so a section
/// that comes back percent-mangled means the encoder was applied too broadly.
#[test]
fn known_sections_round_trip_unescaped() {
    for section in [
        "about",
        "appearance",
        "editor",
        "files",
        "formats",
        "integrations",
        "language",
        "markdown",
        "shortcuts",
        "terminal",
        "advanced",
    ] {
        assert_eq!(
            settings_url(Some(section)),
            format!("/settings?section={section}"),
            "section `{section}` should not be escaped"
        );
    }
}

/// A section carrying reserved URL characters must not be able to smuggle in
/// extra query params or a fragment.
#[test]
fn reserved_characters_are_percent_encoded() {
    let url = settings_url(Some("a&b=c#d?e"));
    assert!(
        !url.contains('&') && !url.contains('#'),
        "reserved chars must be encoded, got {url}"
    );
    assert_eq!(url, "/settings?section=a%26b%3Dc%23d%3Fe");
}

#[test]
fn spaces_and_unicode_are_encoded() {
    assert_eq!(settings_url(Some("a b")), "/settings?section=a%20b");
    assert_eq!(
        settings_url(Some("中文")),
        "/settings?section=%E4%B8%AD%E6%96%87"
    );
}

/// The command filters empty sections to `None` before calling through, but
/// the builder should still be well-behaved if one arrives: an empty query
/// value must not produce a route the SPA cannot match.
#[test]
fn empty_section_still_yields_a_matchable_route() {
    let url = settings_url(Some(""));
    assert!(
        url.starts_with("/settings"),
        "route must stay /settings, got {url}"
    );
}

// ---------------------------------------------------------------------------
// Idempotent creation (#1301)
//
// `open_settings_window` became `#[tauri::command(async)]` because a
// synchronous command builds the window on the main thread and deadlocks
// WebView2 on Windows. That removed the accidental serialization the blocking
// IPC loop used to provide: two clicks can now both see "no settings window"
// before either builds. Exactly one `build()` can win — labels are registered
// on the main thread — so the loser must focus the winner's window instead of
// returning `WindowLabelAlreadyExists` to the user as a failed Settings open.
//
// `MockRuntime` reproduces the losing call exactly: a second `build()` with a
// live label fails the same way it does under Wry.

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

#[test]
fn a_second_open_focuses_the_existing_window_instead_of_creating_one() {
    let app = mock_app();
    let first = show_settings_window_section(app.handle(), None).expect("first open");
    let second = show_settings_window_section(app.handle(), Some("about")).expect("second open");

    assert_eq!(first, SETTINGS_LABEL);
    assert_eq!(second, SETTINGS_LABEL);
    assert_eq!(
        app.webview_windows()
            .keys()
            .filter(|l| *l == SETTINGS_LABEL)
            .count(),
        1,
        "Settings must stay a singleton"
    );
}

#[test]
fn a_build_that_loses_the_race_reports_success_rather_than_label_already_exists() {
    let app = mock_app();
    // Stand in for the winning concurrent call: the label is already taken by
    // the time this call's `build()` runs, which is the whole losing case.
    let _winner = tauri::webview::WebviewWindowBuilder::new(
        app.handle(),
        SETTINGS_LABEL,
        tauri::WebviewUrl::default(),
    )
    .visible(false)
    .build()
    .expect("build the winning settings window");

    // Prove the premise rather than assuming it: a duplicate label must fail.
    let duplicate = tauri::webview::WebviewWindowBuilder::new(
        app.handle(),
        SETTINGS_LABEL,
        tauri::WebviewUrl::default(),
    )
    .build();
    assert!(
        duplicate.is_err(),
        "premise: a duplicate window label must be rejected by the runtime"
    );

    // The real entry point must nonetheless succeed — the user's window exists.
    let label = show_settings_window_section(app.handle(), Some("integrations"))
        .expect("losing the create race is not a user-visible failure");
    assert_eq!(label, SETTINGS_LABEL);
}

#[test]
fn focus_existing_reports_absence_rather_than_pretending_it_focused() {
    let app = mock_app();
    assert!(
        !focus_existing(app.handle(), None),
        "no settings window yet — must report false so the caller builds one"
    );
    show_settings_window_section(app.handle(), None).expect("open settings");
    assert!(focus_existing(app.handle(), Some("about")));
}
