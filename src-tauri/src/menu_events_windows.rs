//! Window-lookup helpers for the menu event dispatcher.
//!
//! Purpose: shared queries over `app.webview_windows()` used by
//! `handle_menu_event` to pick the emit target. Extracted from
//! `menu_events.rs` verbatim (file-size ratchet); included via `#[path]`.
//!
//! All "document window" checks delegate to `quit::is_document_window_label`
//! (`main` or `doc-*`) so the dispatcher agrees with the rest of the backend
//! about what counts as a document window.

use tauri::{AppHandle, Manager};

use crate::quit::is_document_window_label;

/// Pure predicate: does any label in the list identify a document window?
/// Extracted from `has_document_windows` so it can be tested without an
/// `AppHandle`.
pub(super) fn any_document_label<'a>(labels: impl IntoIterator<Item = &'a str>) -> bool {
    labels.into_iter().any(is_document_window_label)
}

/// Check if there are any document windows (`main` or `doc-*`) open.
pub(super) fn has_document_windows(app: &AppHandle) -> bool {
    any_document_label(app.webview_windows().keys().map(String::as_str))
}

/// Get the focused window, if any
pub(super) fn get_focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .cloned()
}

/// Get the focused document window (`main` or `doc-*` only).
pub(super) fn get_focused_document_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false) && is_document_window_label(w.label()))
        .cloned()
}

/// Get any document window (main or doc-*), regardless of focus state.
/// Prefers "main" for deterministic behavior; falls back to any doc-* window.
pub(super) fn get_any_document_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    windows.get("main").cloned().or_else(|| {
        windows
            .values()
            .find(|w| w.label().starts_with("doc-"))
            .cloned()
    })
}

#[cfg(test)]
#[path = "menu_events_windows.test.rs"]
mod tests;
