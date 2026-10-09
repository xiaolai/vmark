//! Tests for `quit_feedback.rs` (included via `#[path]`).

use super::select_feedback_labels;

fn windows(spec: &[(&str, bool)]) -> Vec<(String, bool)> {
    spec.iter().map(|(l, f)| (l.to_string(), *f)).collect()
}

#[test]
fn focused_window_gets_the_hint_alone() {
    let w = windows(&[("main", false), ("doc-1", true)]);
    assert_eq!(select_feedback_labels(&w), vec!["doc-1".to_string()]);
}

#[test]
fn no_focused_window_tells_every_document_window() {
    let w = windows(&[("main", false), ("doc-1", false)]);
    let mut got = select_feedback_labels(&w);
    got.sort();
    assert_eq!(got, vec!["doc-1".to_string(), "main".to_string()]);
}

#[test]
fn unfocused_non_document_windows_are_not_told() {
    let w = windows(&[("main", false), ("settings", false)]);
    assert_eq!(select_feedback_labels(&w), vec!["main".to_string()]);
}

#[test]
fn no_windows_means_nobody_to_tell() {
    assert!(select_feedback_labels(&[]).is_empty());
}
