//! Which windows have their close routed through the frontend (and, on
//! Windows, the close-to-tray decision, #1419).
//!
//! The handler used to carry its own copy of the document-window rule
//! (`label == "main" || label.starts_with("doc-")`) — one of seven copies of
//! the same rule across the crate. It now asks `quit::is_document_window_label`,
//! so the window whose close is intercepted and the window quit waits for can
//! never disagree. If they did, quit could wait on a window whose close was
//! never routed, or route one it never waits for.

use super::intercepts_close;

#[test]
fn intercepts_the_main_window() {
    assert!(intercepts_close("main"));
}

#[test]
fn intercepts_every_document_window() {
    for label in ["doc-1", "doc-42", "doc-abc"] {
        assert!(intercepts_close(label), "{label}");
    }
}

/// Settings and every other auxiliary window close normally — they hold no
/// document, so there is no save flow to run and nothing to park in a tray.
#[test]
fn lets_other_windows_close_normally() {
    for label in ["settings", "", "document", "doc", "main-2", "Doc-1"] {
        assert!(!intercepts_close(label), "{label:?}");
    }
}

/// Pinned against the one definition, so a future inline copy that drifts —
/// the shape this file used to have — fails here instead of silently.
#[test]
fn agrees_with_the_quit_definition() {
    for label in ["main", "doc-1", "settings", "", "doc", "main-2", "doc-"] {
        assert_eq!(
            intercepts_close(label),
            crate::quit::is_document_window_label(label),
            "{label:?}"
        );
    }
}
