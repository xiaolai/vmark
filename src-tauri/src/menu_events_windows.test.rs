//! Tests for `menu_events_windows.rs` — document-window predicate.
//!
//! The dispatcher's "does a document window exist?" check must use the same
//! definition of "document window" as the rest of the backend
//! (`quit::is_document_window_label`: `main` or `doc-*`). The old predicate
//! ("any window except settings/pdf-export") counted utility windows as
//! documents, which suppressed new-window creation when only a utility
//! window (e.g. a workflow viewer) was open.

use super::any_document_label;

#[test]
fn no_windows_means_no_documents() {
    assert!(!any_document_label([]));
}

#[test]
fn main_window_is_a_document() {
    assert!(any_document_label(["main"]));
}

#[test]
fn doc_windows_are_documents() {
    assert!(any_document_label(["doc-0"]));
    assert!(any_document_label(["settings", "doc-42"]));
}

#[test]
fn settings_and_pdf_export_are_not_documents() {
    assert!(!any_document_label(["settings"]));
    assert!(!any_document_label(["pdf-export"]));
    assert!(!any_document_label(["settings", "pdf-export"]));
}

#[test]
fn utility_windows_are_not_documents() {
    // Regression: the old predicate ("anything except settings/pdf-export")
    // would return true here and suppress new-window creation.
    assert!(!any_document_label(["workflow-viewer"]));
    assert!(!any_document_label(["settings", "some-future-utility"]));
}

#[test]
fn mixed_labels_detect_the_document() {
    assert!(any_document_label(["settings", "pdf-export", "main"]));
    assert!(any_document_label(["some-utility", "doc-1"]));
}
