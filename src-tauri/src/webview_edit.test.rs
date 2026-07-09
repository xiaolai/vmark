//! Tests for `webview_edit.rs` (included via `#[path]`).
//!
//! WI-0.1 / WI-2.2 — validates the edit-action parser that guards the
//! `trigger_webview_edit` command: only the four known actions are
//! accepted, everything else (including case variants and empty input)
//! is rejected so the command fails loud instead of silently no-opping.

use super::EditAction;

#[test]
fn parses_the_four_known_actions() {
    assert_eq!(EditAction::parse("cut"), Some(EditAction::Cut));
    assert_eq!(EditAction::parse("copy"), Some(EditAction::Copy));
    assert_eq!(EditAction::parse("paste"), Some(EditAction::Paste));
    assert_eq!(EditAction::parse("selectAll"), Some(EditAction::SelectAll));
}

#[test]
fn rejects_unknown_and_malformed_input() {
    for bad in [
        "",
        "Cut",
        "COPY",
        "paste ",
        " paste",
        "select_all",
        "selectall",
        "delete",
        "undo",
        "paste:\u{0000}",
        "粘贴",
    ] {
        assert_eq!(EditAction::parse(bad), None, "should reject {bad:?}");
    }
}

#[cfg(target_os = "macos")]
#[test]
fn outcome_mapping_covers_every_branch() {
    use super::{outcome_to_result, SendOutcome};
    assert!(outcome_to_result(SendOutcome::Handled(true)).is_ok());
    let unhandled = outcome_to_result(SendOutcome::Handled(false)).unwrap_err();
    assert!(unhandled.contains("No responder"), "got: {unhandled}");
    let unfocused = outcome_to_result(SendOutcome::NotFocused).unwrap_err();
    assert!(unfocused.contains("focused"), "got: {unfocused}");
}

#[cfg(target_os = "macos")]
#[test]
fn every_action_maps_to_a_distinct_selector() {
    let sels = [
        EditAction::Cut.selector(),
        EditAction::Copy.selector(),
        EditAction::Paste.selector(),
        EditAction::SelectAll.selector(),
    ];
    for (i, a) in sels.iter().enumerate() {
        for b in sels.iter().skip(i + 1) {
            assert_ne!(a, b, "selectors must be distinct");
        }
    }
    assert_eq!(EditAction::Paste.selector().name().to_str(), Ok("paste:"));
}
