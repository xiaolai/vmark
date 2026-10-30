//! What the backend forgets when a window is destroyed.
//!
//! Purpose: one place for the per-window state a closed window leaves in the
//! backend, so `handle_run_event`'s `Destroyed` arm stays a single call and the
//! whole release can be driven on a mock runtime (`window_destroyed.test.rs`).
//!
//! Key decisions:
//!   - The webview's own cleanup calls (`stop_watching`, `pty_close`, the MCP
//!     workspace release) die with the webview and can race its teardown, so
//!     the backend repeats each of them here; every step is idempotent.
//!   - The quit coordinator is not part of this: it is told separately by
//!     `handle_run_event`, because finishing a quit exits the app.

use tauri::{AppHandle, Runtime};

use crate::{menu, tab_transfer, window_status, workspace};

/// Forget every piece of per-window state the window `label` left behind.
pub(crate) fn release_destroyed_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    crate::files::open::remove_document_window(app, label);
    menu::events::clear_window_ready(label);
    tab_transfer::clear_unclaimed_transfer(label);
    workspace::transfer::clear_unclaimed_transfer(label);
    window_status::prune(app, label);
    // Drop the window's filesystem watcher: without this each closed window
    // would leak a recursive watcher.
    if let Err(e) = crate::watcher::stop_watching(label.to_string()) {
        log::warn!("[Tauri] Failed to stop watcher for {:?}: {}", label, e);
    }
    // An idle shell would otherwise outlive the window.
    crate::pty::close_window_sessions(app, label);
    // A stale agent-journal base-root pin would outlive it too.
    crate::agent_journal::service::release_window_label(app, label);
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        crate::mcp_bridge::managed::bridge(&app)
            .forget_window(&label)
            .await;
    });
}

#[cfg(test)]
#[path = "window_destroyed.test.rs"]
mod tests;
