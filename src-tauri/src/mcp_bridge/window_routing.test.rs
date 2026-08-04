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
        pick_target_window(Some("/repo/notes/a.md"), &cands).unwrap(),
        "doc-0"
    );
}

#[test]
fn workspace_root_arg_routes_to_owner() {
    let cands = vec![win("main", None, true), win("doc-0", Some("/repo"), false)];
    assert_eq!(pick_target_window(Some("/repo"), &cands).unwrap(), "doc-0");
}

#[test]
fn nested_workspaces_pick_the_deepest() {
    let cands = vec![
        win("doc-0", Some("/repo"), false),
        win("doc-1", Some("/repo/sub"), false),
    ];
    assert_eq!(
        pick_target_window(Some("/repo/sub/x.md"), &cands).unwrap(),
        "doc-1"
    );
    // A path only in the outer workspace still routes to the outer window.
    assert_eq!(
        pick_target_window(Some("/repo/top.md"), &cands).unwrap(),
        "doc-0"
    );
}

#[test]
fn two_windows_same_workspace_is_ambiguous() {
    let cands = vec![
        win("doc-0", Some("/repo"), false),
        win("doc-1", Some("/repo"), true),
    ];
    let err = pick_target_window(Some("/repo/a.md"), &cands).unwrap_err();
    assert!(err.contains("ambiguous"), "{err}");
}

/// WI-15 — every payload a shipped MCP tool can send routes to a window
/// without an explicit pin. The pin used to be `args.windowId`, which no
/// tool has ever sent; these are the real wire shapes, taken from the
/// contract in `server/mcp/src/bridge/operationSchemas.ts`.
#[test]
fn every_shipped_payload_shape_routes_without_an_explicit_pin() {
    let cands = vec![win("main", None, false), win("doc-0", Some("/repo"), true)];
    let shipped = [
        // targeting by tab, the common case — no scoping path at all
        serde_json::json!({ "tabId": "t1" }),
        serde_json::json!({ "tabId": "t1", "content": "# x", "expected_revision": "r1" }),
        // workspace.new / focus_window carry a windowLabel the WEBVIEW honors
        serde_json::json!({ "kind": "markdown", "windowLabel": "doc-0" }),
        serde_json::json!({ "windowLabel": "doc-0" }),
        // browser + session shapes carry nothing routable
        serde_json::json!({ "url": "https://example.test", "timeoutMs": 100 }),
        serde_json::json!({ "clientProtocol": "0.3.0" }),
        // no args at all
        serde_json::json!({}),
    ];
    for args in shipped {
        let target = pick_target_window(scoping_path(&args).as_deref(), &cands)
            .unwrap_or_else(|e| panic!("{args} failed to route: {e}"));
        assert_eq!(target, "doc-0", "{args} routed to the wrong window");
    }
}

/// A `windowLabel` on the payload does NOT pin routing — the webview handler
/// that receives the request resolves it. Pinning it here would give routing
/// a precedence it has never had, and would conflict with workspace scoping.
#[test]
fn window_label_does_not_pin_routing() {
    let cands = vec![
        win("main", None, true),
        win("doc-0", Some("/repo"), false),
        win("doc-1", None, false),
    ];
    let args = serde_json::json!({ "filePath": "/repo/a.md", "windowLabel": "doc-1" });
    assert_eq!(
        pick_target_window(scoping_path(&args).as_deref(), &cands).unwrap(),
        "doc-0",
        "workspace containment decides the target window, not windowLabel"
    );
}

/// The ambiguity refusal must not advertise a parameter no client can send.
#[test]
fn ambiguity_error_names_a_remedy_the_caller_can_actually_apply() {
    let cands = vec![
        win("doc-0", Some("/repo"), false),
        win("doc-1", Some("/repo"), true),
    ];
    let err = pick_target_window(Some("/repo/a.md"), &cands).unwrap_err();
    assert!(err.contains("close one of them"), "{err}");
    assert!(
        !err.contains("windowId"),
        "the refusal still advertises a field no tool sends: {err}"
    );
}

#[test]
fn workspaceless_request_falls_back_to_focused_then_main() {
    let cands = vec![win("main", None, false), win("doc-0", Some("/repo"), true)];
    // No scoping path → the focused document window.
    assert_eq!(pick_target_window(None, &cands).unwrap(), "doc-0");
    // Nothing focused → main.
    let none_focused = vec![win("main", None, false), win("doc-0", None, false)];
    assert_eq!(pick_target_window(None, &none_focused).unwrap(), "main");
}

#[test]
fn unowned_path_does_not_error_it_falls_through() {
    // A path no window owns must not fail routing — the frontend guard
    // rejects it. Routing stays permissive; the guard is the gate.
    let cands = vec![win("main", None, true), win("doc-0", Some("/repo"), false)];
    assert_eq!(
        pick_target_window(Some("/elsewhere/x.md"), &cands).unwrap(),
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
        pick_target_window(Some("/repo-two/x.md"), &cands).unwrap(),
        "main",
        "prefix-sibling must not match; falls through to main"
    );
}
