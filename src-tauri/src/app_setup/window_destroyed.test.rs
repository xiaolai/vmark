//! `release_destroyed_window` driven on a mock runtime: once a window is gone,
//! the per-window state it left in the backend is forgotten, and a window the
//! app never managed optional state for (no terminals, no agent journal) is
//! released without panicking.

// `tauri::test` does not exist on Windows (AGENTS.md).
#![cfg(not(target_os = "windows"))]

use super::release_destroyed_window;
use crate::menu::events::{is_window_ready, mark_window_ready};
use crate::window_manager::file_open_state;
use crate::window_status::{report_window_status, WindowStatusRegistry};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[test]
fn a_destroyed_window_leaves_no_per_window_state_behind() {
    let app = tauri::test::mock_builder()
        .manage(WindowStatusRegistry::default())
        .manage(crate::mcp_bridge::McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds");
    // A label no other test uses: the ready set is process-wide.
    let label = "doc-destroyed-cleanup";
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::default())
        .build()
        .expect("mock window builds");
    let handle = app.handle();

    mark_window_ready(handle, label);
    crate::files::open::record_document_window_focus(handle, label, true, true);
    report_window_status(
        window.as_ref().window(),
        "notes.md".into(),
        "running".into(),
        3,
    );
    assert!(is_window_ready(label));
    assert_eq!(
        file_open_state(handle)
            .lock()
            .last_focused_document_window(),
        Some(label)
    );

    release_destroyed_window(handle, label);

    assert!(
        !is_window_ready(label),
        "menu events would queue for a dead window"
    );
    assert_eq!(
        file_open_state(handle)
            .lock()
            .last_focused_document_window(),
        None,
        "Finder would route a file to a dead window"
    );
    let statuses = app.state::<WindowStatusRegistry>();
    assert!(
        !statuses.0.lock().unwrap().contains_key(label),
        "the Window Status panel would list a dead window"
    );
}
