//! Tests for `restore_plan.rs` (audit 20260906, B4).
//!
//! Split out of `coordinator.test.rs` alongside the module they cover.

use super::*;
use crate::hot_exit::session::UiState;

fn make_window_state(label: &str, is_main: bool) -> WindowState {
    WindowState {
        window_label: label.to_string(),
        is_main_window: is_main,
        active_tab_id: None,
        tabs: vec![],
        ui_state: UiState {
            sidebar_visible: true,
            sidebar_width: 260,
            outline_visible: false,
            sidebar_view_mode: "files".to_string(),
            status_bar_visible: true,
            source_mode_enabled: false,
            focus_mode_enabled: false,
            typewriter_mode_enabled: false,
            terminal_visible: false,
            terminal_height: 250,
        },
        geometry: None,
        workspace_instance_ids: Vec::new(),
        active_workspace_instance_id: None,
        workspace_instances: Vec::new(),
        ui_state_by_instance: None,
        closed_tab_scopes: None,
        browser_session: None,
    }
}

/// The ORDINARY no-main topology: open a second document window, close the
/// original `main`, keep working. Capture flags only the literal `main` label,
/// so nothing in the saved session is flagged.
#[test]
fn a_session_with_no_main_window_restores_each_window_exactly_once() {
    let saved = vec![make_window_state("doc-1", false)];

    let plan = plan_window_restore(&saved);

    assert!(plan.main_state.is_some(), "the survivor becomes main");
    assert!(
        plan.secondary_windows.is_empty(),
        "it must not ALSO be restored as a secondary — that is the duplicate"
    );
}

#[test]
fn no_main_multi_window_session_does_not_gain_a_window() {
    let saved = vec![
        make_window_state("doc-1", false),
        make_window_state("doc-2", false),
        make_window_state("doc-3", false),
    ];

    let plan = plan_window_restore(&saved);

    let restored = usize::from(plan.main_state.is_some()) + plan.secondary_windows.len();
    assert_eq!(restored, saved.len(), "N saved windows must restore as N");
}

/// The duplicate was identifiable by label: the first survivor appeared as
/// both the main source and a secondary.
#[test]
fn the_first_survivor_is_not_restored_twice() {
    let saved = vec![
        make_window_state("doc-1", false),
        make_window_state("doc-2", false),
    ];

    let plan = plan_window_restore(&saved);

    assert_eq!(plan.main_state.unwrap().window_label, "doc-1");
    let secondary_labels: Vec<_> = plan
        .secondary_windows
        .iter()
        .map(|w| w.window_label.as_str())
        .collect();
    assert_eq!(secondary_labels, vec!["doc-2"]);
}

#[test]
fn a_flagged_main_window_is_chosen_over_the_first() {
    let saved = vec![
        make_window_state("doc-1", false),
        make_window_state("main", true),
        make_window_state("doc-2", false),
    ];

    let plan = plan_window_restore(&saved);

    assert_eq!(plan.main_state.unwrap().window_label, "main");
    let labels: Vec<_> = plan
        .secondary_windows
        .iter()
        .map(|w| w.window_label.as_str())
        .collect();
    assert_eq!(labels, vec!["doc-1", "doc-2"]);
}

/// Malformed input: several windows flagged main. The old secondary filter
/// dropped every extra flagged window; a saved window with content is worth
/// more than the flag is.
#[test]
fn extra_main_flagged_windows_are_restored_as_secondaries_not_dropped() {
    let saved = vec![
        make_window_state("main", true),
        make_window_state("also-main", true),
    ];

    let plan = plan_window_restore(&saved);

    assert_eq!(plan.main_state.unwrap().window_label, "main");
    assert_eq!(plan.secondary_windows.len(), 1);
    assert_eq!(plan.secondary_windows[0].window_label, "also-main");
}

#[test]
fn an_empty_session_plans_no_windows() {
    let plan = plan_window_restore(&[]);

    assert!(plan.main_state.is_none());
    assert!(plan.secondary_windows.is_empty());
}

#[test]
fn every_saved_window_appears_exactly_once_across_the_plan() {
    for flags in [
        vec![false, false, false],
        vec![true, false, false],
        vec![false, true, false],
        vec![false, false, true],
        vec![true, true, false],
    ] {
        let saved: Vec<_> = flags
            .iter()
            .enumerate()
            .map(|(i, main)| make_window_state(&format!("w{i}"), *main))
            .collect();

        let plan = plan_window_restore(&saved);

        let mut seen: Vec<&str> = plan
            .secondary_windows
            .iter()
            .map(|w| w.window_label.as_str())
            .collect();
        if let Some(m) = plan.main_state.as_ref() {
            seen.push(&m.window_label);
        }
        seen.sort_unstable();
        let mut expected: Vec<&str> = saved.iter().map(|w| w.window_label.as_str()).collect();
        expected.sort_unstable();
        assert_eq!(
            seen, expected,
            "flags {flags:?} lost or duplicated a window"
        );
    }
}
