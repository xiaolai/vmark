// WI-3.5 F5 — workspace-aware routing precedence (design-3.md D4.1).

use super::*;

fn win(label: &str, workspace: Option<&str>, focused: bool) -> WindowCandidate {
    WindowCandidate {
        label: label.into(),
        workspace: workspace.map(str::to_string),
        focused,
        is_document: label == "main" || label.starts_with("doc-"),
    }
}

#[test]
fn workspace_containment_beats_focus() {
    let cands = vec![
        win("main", None, true), // focused but no workspace
        win("doc-0", Some("/repo"), false),
    ];
    // A path under doc-0's workspace routes there, not to focused main.
    assert_eq!(
        pick_target_window(None, Some("/repo/notes/a.md"), &cands).unwrap(),
        "doc-0"
    );
}

#[test]
fn workspace_root_arg_routes_to_owner() {
    let cands = vec![win("main", None, true), win("doc-0", Some("/repo"), false)];
    assert_eq!(
        pick_target_window(None, Some("/repo"), &cands).unwrap(),
        "doc-0"
    );
}

#[test]
fn nested_workspaces_pick_the_deepest() {
    let cands = vec![
        win("doc-0", Some("/repo"), false),
        win("doc-1", Some("/repo/sub"), false),
    ];
    assert_eq!(
        pick_target_window(None, Some("/repo/sub/x.md"), &cands).unwrap(),
        "doc-1"
    );
    // A path only in the outer workspace still routes to the outer window.
    assert_eq!(
        pick_target_window(None, Some("/repo/top.md"), &cands).unwrap(),
        "doc-0"
    );
}

#[test]
fn two_windows_same_workspace_is_ambiguous() {
    let cands = vec![
        win("doc-0", Some("/repo"), false),
        win("doc-1", Some("/repo"), true),
    ];
    let err = pick_target_window(None, Some("/repo/a.md"), &cands).unwrap_err();
    assert!(err.contains("ambiguous"), "{err}");
}

#[test]
fn explicit_window_wins_but_conflicts_fail_loud() {
    let cands = vec![
        win("doc-0", Some("/repo"), false),
        win("doc-1", Some("/other"), false),
    ];
    // Explicit + owned path → honored.
    assert_eq!(
        pick_target_window(Some("doc-0"), Some("/repo/a.md"), &cands).unwrap(),
        "doc-0"
    );
    // Explicit window that does NOT own the path → conflict error, not a
    // silent override (D4.1).
    let err = pick_target_window(Some("doc-1"), Some("/repo/a.md"), &cands).unwrap_err();
    assert!(err.contains("does not own"), "{err}");
    // Explicit window that isn't open → error.
    let err = pick_target_window(Some("ghost"), None, &cands).unwrap_err();
    assert!(err.contains("not open"), "{err}");
}

#[test]
fn workspaceless_request_falls_back_to_focused_then_main() {
    let cands = vec![win("main", None, false), win("doc-0", Some("/repo"), true)];
    // No scoping path → the focused document window.
    assert_eq!(pick_target_window(None, None, &cands).unwrap(), "doc-0");
    // Nothing focused → main.
    let none_focused = vec![win("main", None, false), win("doc-0", None, false)];
    assert_eq!(
        pick_target_window(None, None, &none_focused).unwrap(),
        "main"
    );
}

#[test]
fn unowned_path_does_not_error_it_falls_through() {
    // A path no window owns must not fail routing — the frontend guard
    // rejects it. Routing stays permissive; the guard is the gate.
    let cands = vec![win("main", None, true), win("doc-0", Some("/repo"), false)];
    assert_eq!(
        pick_target_window(None, Some("/elsewhere/x.md"), &cands).unwrap(),
        "main"
    );
}

#[test]
fn scoping_path_prefers_workspace_root_then_filepath() {
    let with_root = serde_json::json!({ "workspace_root": "/a", "filePath": "/b/c.md" });
    assert_eq!(scoping_path(&with_root).as_deref(), Some("/a"));
    let with_file = serde_json::json!({ "filePath": "/b/c.md" });
    assert_eq!(scoping_path(&with_file).as_deref(), Some("/b/c.md"));
    let neither = serde_json::json!({ "tabId": "t1" });
    assert_eq!(scoping_path(&neither), None);
}

#[test]
fn segment_boundary_containment_rejects_prefix_siblings() {
    // "/repo-two" is not inside "/repo" despite the string prefix.
    let cands = vec![win("doc-0", Some("/repo"), false), win("main", None, true)];
    assert_eq!(
        pick_target_window(None, Some("/repo-two/x.md"), &cands).unwrap(),
        "main",
        "prefix-sibling must not match; falls through to main"
    );
}
