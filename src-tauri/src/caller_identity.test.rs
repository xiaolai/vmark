// WI-RA7C.5 — commands that act FOR the calling window take that window from
// Tauri, not from a label in their arguments. Each test sends the call from one
// window while naming another in the arguments, the way any page could, and
// checks that the window the message came from is the one acted for.
//
// (`close_window` is pinned in `window_manager/commands.test.rs`,
// `live_docs_response`/`collect_live_document_refs` in `live_docs.test.rs` and
// `cancel_workspace_transfer` in `workspace/transfer.test.rs`, beside the state
// they read.)

use crate::hot_exit::session::{UiState, WindowState};
use crate::hot_exit::state::HotExitState;
use crate::ipc_caller::{app_with, invoke_from, window};
use crate::mcp_bridge::managed::McpBridgeState;
use serde_json::json;
use std::collections::HashSet;
use tauri::Manager;

fn window_state(label: &str) -> WindowState {
    WindowState {
        window_label: label.to_string(),
        is_main_window: false,
        active_tab_id: Some(format!("tab-of-{label}")),
        tabs: Vec::new(),
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

fn hot_exit_app() -> tauri::App<tauri::test::MockRuntime> {
    let app = app_with(tauri::generate_handler![
        crate::hot_exit::commands::hot_exit_get_window_state,
        crate::hot_exit::commands::hot_exit_window_restore_complete,
    ]);
    let state = HotExitState::default();
    state.store(
        [
            ("doc-1".to_string(), window_state("doc-1")),
            ("doc-2".to_string(), window_state("doc-2")),
        ],
        ["doc-1", "doc-2"]
            .iter()
            .map(|l| l.to_string())
            .collect::<HashSet<_>>(),
    );
    app.manage(state);
    app
}

/// A window reads ITS restore state, whatever label it names.
#[test]
fn a_window_reads_its_own_restore_state() {
    let app = hot_exit_app();
    let caller = window(&app, "doc-1");

    let answer = invoke_from(
        &caller,
        "hot_exit_get_window_state",
        json!({ "windowLabel": "doc-2" }),
    )
    .expect("answered");

    assert_eq!(answer["window_label"], "doc-1", "{answer}");
}

/// A window can report only ITSELF restored. Reporting another would end the
/// restore early, and its end is what clears the session file.
#[test]
fn a_window_reports_only_itself_restored() {
    let app = hot_exit_app();
    let first = window(&app, "doc-1");
    let second = window(&app, "doc-2");

    let after_first = invoke_from(
        &first,
        "hot_exit_window_restore_complete",
        json!({ "windowLabel": "doc-2" }),
    );
    // Naming doc-2 again from doc-1 still marks doc-1, so nothing is complete
    // until doc-2 itself reports.
    let again = invoke_from(
        &first,
        "hot_exit_window_restore_complete",
        json!({ "windowLabel": "doc-2" }),
    );
    let after_second = invoke_from(&second, "hot_exit_window_restore_complete", json!({}));

    assert_eq!(after_first, Ok(json!(false)));
    assert_eq!(again, Ok(json!(false)), "doc-1 reported doc-2 as restored");
    assert_eq!(after_second, Ok(json!(true)));
}

/// A window registers ITS workspace with the MCP bridge. Claiming another's
/// would route that window's workspace requests to the caller.
#[test]
fn a_window_registers_only_its_own_workspace_with_the_bridge() {
    let app = app_with(tauri::generate_handler![
        crate::mcp_bridge::commands::mcp_bridge_set_window_workspace
    ]);
    app.manage(McpBridgeState::default());
    let caller = window(&app, "doc-1");

    let answer = invoke_from(
        &caller,
        "mcp_bridge_set_window_workspace",
        json!({ "windowLabel": "doc-2", "workspaceRoot": "/ws" }),
    );

    assert!(answer.is_ok(), "{answer:?}");
    let registered = tauri::async_runtime::block_on(async {
        app.state::<McpBridgeState>()
            .lock()
            .await
            .window_workspaces
            .clone()
    });
    assert_eq!(registered.get("doc-1").map(String::as_str), Some("/ws"));
    assert_eq!(registered.get("doc-2"), None, "doc-1 registered for doc-2");
}

/// A window publishes ITS tabs to the bridge. Claiming another window's tab
/// would route requests naming that tab to the caller; an oversized list is
/// refused rather than stored.
#[test]
fn a_window_registers_only_its_own_tabs_with_the_bridge() {
    let app = app_with(tauri::generate_handler![
        crate::mcp_bridge::commands::mcp_bridge_set_window_tabs
    ]);
    app.manage(McpBridgeState::default());
    let caller = window(&app, "doc-1");

    let answer = invoke_from(
        &caller,
        "mcp_bridge_set_window_tabs",
        json!({ "windowLabel": "doc-2", "tabIds": ["tab-a", "tab-b"] }),
    );
    assert!(answer.is_ok(), "{answer:?}");

    let too_many: Vec<String> = (0..=crate::mcp_bridge::commands::MAX_WINDOW_TABS)
        .map(|i| format!("tab-{i}"))
        .collect();
    let refused = invoke_from(
        &caller,
        "mcp_bridge_set_window_tabs",
        json!({ "tabIds": too_many }),
    );
    assert!(refused.is_err(), "an oversized tab list was accepted");

    let registered = tauri::async_runtime::block_on(async {
        app.state::<McpBridgeState>()
            .lock()
            .await
            .window_tabs
            .clone()
    });
    assert_eq!(
        registered.get("doc-1").cloned(),
        Some(vec!["tab-a".to_string(), "tab-b".to_string()]),
        "the refused list replaced the stored one, or the caller's list was not stored"
    );
    assert_eq!(
        registered.get("doc-2"),
        None,
        "doc-1 registered tabs for doc-2"
    );
}
