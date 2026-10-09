//! # First-press quit feedback
//!
//! Purpose: tell the user that the first Cmd+Q was heard. The confirm-quit
//! gate swallows that press on purpose, so the "press again to quit" hint is
//! the only sign it did anything; without it quit looks dead (#1528).
//!
//! Key decisions:
//!   - The hint goes to the focused window, and to EVERY document window when
//!     none reports focus. Focus is not a given at the moment a menu command
//!     runs (a menu click, or a focus change in flight), and "tell nobody"
//!     is exactly the silent failure this module exists to remove.
//!   - Selection is a pure function over `(label, focused)` pairs so the rule
//!     is testable without an app.
//!
//! @coordinates-with quit.rs — `request_quit` calls this when the gate blocks
//! @coordinates-with components/StatusBar/useQuitFeedback.ts — renders the hint
//! @module quit::feedback

use tauri::{AppHandle, Emitter, Manager};

/// The event the status bar listens for to show the press-again hint.
const QUIT_FIRST_PRESS_EVENT: &str = "app:quit-first-press";

/// Pick the windows that should show the hint: the focused ones, else every
/// document window.
pub(super) fn select_feedback_labels(windows: &[(String, bool)]) -> Vec<String> {
    let focused: Vec<String> = windows
        .iter()
        .filter(|(_, is_focused)| *is_focused)
        .map(|(label, _)| label.clone())
        .collect();
    if !focused.is_empty() {
        return focused;
    }
    windows
        .iter()
        .filter(|(label, _)| super::is_document_window_label(label))
        .map(|(label, _)| label.clone())
        .collect()
}

/// Show the press-again-to-quit hint (see the module docs for who gets it).
pub(super) fn emit_first_press_feedback(app: &AppHandle) {
    let windows: Vec<(String, bool)> = app
        .webview_windows()
        .iter()
        .map(|(label, window)| (label.clone(), window.is_focused().unwrap_or(false)))
        .collect();
    let labels = select_feedback_labels(&windows);
    if labels.is_empty() {
        log::warn!("[quit] first press armed the gate but there is no window to tell");
    }
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            if let Err(e) = window.emit(QUIT_FIRST_PRESS_EVENT, ()) {
                log::error!("[quit] Failed to emit {QUIT_FIRST_PRESS_EVENT} to {label:?}: {e}");
            }
        }
    }
}

#[cfg(test)]
#[path = "quit_feedback.test.rs"]
mod tests;
