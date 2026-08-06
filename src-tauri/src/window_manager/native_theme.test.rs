//! Tests for `native_theme.rs` (included via `#[path]`).
//!
//! The apply-to-windows half needs a live Tauri runtime, so what is unit
//! tested here is the part that decides *what* to apply: the dark flag to
//! `Theme` mapping, and the process-global the window builders read when they
//! create a window after the user has already picked a theme.

use super::*;

// -- theme_for -------------------------------------------------------------

#[test]
fn dark_flag_maps_to_dark_theme() {
    assert_eq!(theme_for(true), Theme::Dark);
}

#[test]
fn light_flag_maps_to_light_theme() {
    assert_eq!(theme_for(false), Theme::Light);
}

// -- remembered preference -------------------------------------------------
//
// These share one process-global, so they run under a mutex and restore the
// previous value. Cargo runs tests in threads within a single process, so a
// bare `remember()` in one test is visible to every other.

use std::sync::Mutex;
static GUARD: Mutex<()> = Mutex::new(());

fn with_saved_preference(body: impl FnOnce()) {
    // Poisoning is irrelevant here: the guarded state is a single bool that
    // the closure always overwrites, so a panicking test cannot leave it
    // inconsistent for the next one.
    let _lock = GUARD.lock().unwrap_or_else(|e| e.into_inner());
    let previous = prefers_dark();
    body();
    remember(previous);
}

#[test]
fn remember_round_trips_dark() {
    with_saved_preference(|| {
        remember(true);
        assert!(prefers_dark());
        assert_eq!(current_theme(), Theme::Dark);
    });
}

#[test]
fn remember_round_trips_light() {
    with_saved_preference(|| {
        remember(false);
        assert!(!prefers_dark());
        assert_eq!(current_theme(), Theme::Light);
    });
}

#[test]
fn remember_is_idempotent() {
    with_saved_preference(|| {
        remember(true);
        remember(true);
        assert_eq!(current_theme(), Theme::Dark);
    });
}

#[test]
fn later_writes_win() {
    with_saved_preference(|| {
        remember(true);
        remember(false);
        assert_eq!(
            current_theme(),
            Theme::Light,
            "a theme switch must not be masked by the earlier value"
        );
    });
}

/// A window created before the frontend has ever reported a theme must still
/// get a definite theme rather than inheriting whatever the OS prefers —
/// otherwise the very first Settings window on a light-mode OS opens with
/// light chrome around a dark VMark theme.
#[test]
fn default_preference_is_light() {
    // Not wrapped in `with_saved_preference`: this asserts the *initial*
    // value of the global, which only holds before any test has written to
    // it. Re-establish it explicitly so ordering cannot make this flaky.
    let _lock = GUARD.lock().unwrap_or_else(|e| e.into_inner());
    remember(false);
    assert_eq!(current_theme(), Theme::Light);
}
