//! #1419 — the close decision, pinned on every platform.
//!
//! The feature only ACTS on Windows, but the decision is plain logic and is
//! tested everywhere: this is the part that can quietly do the wrong thing, and
//! the macOS/Linux test binaries are the ones that run on every local change.

use super::*;

/// The whole decision table. Anything not listed here is a regression.
#[test]
fn decide_close_action_table() {
    use CloseAction::{Close, HideToTray};

    let cases = [
        // (enabled, document windows, quit in progress) => action
        ((false, 1, false), Close), // feature off: exactly today's behaviour
        ((false, 3, false), Close),
        ((true, 1, false), HideToTray), // the last window parks in the tray
        ((true, 2, false), Close),      // other windows still close normally
        ((true, 5, false), Close),
        ((true, 1, true), Close), // a quit must never be turned into a hide
        ((true, 2, true), Close),
        ((false, 1, true), Close),
    ];
    for ((enabled, windows, quitting), expected) in cases {
        assert_eq!(
            decide_close_action(enabled, windows, quitting),
            expected,
            "enabled={enabled} windows={windows} quitting={quitting}"
        );
    }
}

/// A count of zero means the window being closed was not counted — a caller
/// bug, not a state to park in the tray. Closing is the conservative answer:
/// hiding a window we cannot account for would strand it.
#[test]
fn zero_document_windows_closes() {
    assert_eq!(decide_close_action(true, 0, false), CloseAction::Close);
}

/// The quit path is the one that must never hang. Quit closes every document
/// window; if the decision turned the last close into a hide, the quit would
/// wait forever for a window that never goes away — and nothing on macOS would
/// show it, because the feature never acts there.
#[test]
fn quit_in_progress_always_wins() {
    for windows in 0..6 {
        assert_eq!(
            decide_close_action(true, windows, true),
            CloseAction::Close,
            "windows={windows}"
        );
    }
}

/// Off by default: a fresh install behaves exactly as before, and a failed
/// push from the webview leaves the app on the old, known-safe behaviour.
#[test]
fn state_starts_disabled() {
    assert!(!CloseToTrayState::default().is_enabled());
}

#[test]
fn state_round_trips() {
    let state = CloseToTrayState::default();
    state.set_enabled(true);
    assert!(state.is_enabled());
    state.set_enabled(false);
    assert!(!state.is_enabled());
}

/// Setting the same value twice is harmless — the webview pushes on mount and
/// on every change, so a repeat must never be an error or a toggle.
#[test]
fn state_set_is_idempotent() {
    let state = CloseToTrayState::default();
    state.set_enabled(true);
    state.set_enabled(true);
    assert!(state.is_enabled());
}

/// The platform gate, stated as a test so it cannot drift silently: off
/// Windows the feature is never enabled, whatever the webview pushed.
#[test]
fn feature_is_only_effective_on_windows() {
    let state = CloseToTrayState::default();
    state.set_enabled(true);
    assert_eq!(effective_enabled(&state), cfg!(target_os = "windows"));
}
