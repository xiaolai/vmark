//! Menu event dispatch: id classification and per-action handlers.
//!
//! Purpose: Routes a clicked menu id to its handler. Split out of
//! `menu_events.rs` (which keeps the readiness/queueing machinery); included
//! via `#[path]` as a child module so it can use the parent's private
//! emit/queue helpers.
//!
//! Pipeline: `handle_menu_event` → `classify_menu_id` (pure) → small handler
//! → emit/queue helper in `menu_events.rs`.
//!
//! Key decisions:
//!   - `classify_menu_id` and `decide_document_routing` are pure so the
//!     dispatch contract is testable without a Tauri `AppHandle`.
//!   - Malformed dynamic ids (e.g. `recent-file-abc`) classify as `Generic`,
//!     matching the historical fall-through behavior.
//!   - Recent-file/workspace and open/open-folder/quick-open share one
//!     routing helper (`route_to_document_window`): focused window → direct
//!     emit; no document window → create one and queue; otherwise → queue to
//!     an existing document window.

use tauri::{AppHandle, Emitter};

use super::windows::{
    get_any_document_window, get_focused_document_window, get_focused_window, has_document_windows,
};
use super::{
    create_window_and_queue, emit_event, emit_or_queue_atomic, make_menu_event,
    make_recent_file_event, make_recent_workspace_event, PendingMenuEvent,
};
use crate::quit;

/// Pure classification of a menu item id into a dispatch action.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum MenuAction {
    Quit,
    SaveAllQuit,
    RecentFile(usize),
    RecentWorkspace(usize),
    GenieItem(usize),
    ClearRecentWorkspaces,
    InstallCli,
    NewWindow,
    Preferences,
    About,
    New,
    Close,
    /// `open` | `open-folder` | `quick-open`: must work without windows.
    OpenLike,
    /// Everything else: emit `menu:{id}` to a document window.
    Generic,
}

/// Classify a menu id. Malformed dynamic indices fall through to `Generic`,
/// preserving the historical dispatcher's behavior.
pub(super) fn classify_menu_id(id: &str) -> MenuAction {
    if let Some(rest) = id.strip_prefix("recent-file-") {
        if let Ok(index) = rest.parse::<usize>() {
            return MenuAction::RecentFile(index);
        }
        return MenuAction::Generic;
    }
    if let Some(rest) = id.strip_prefix("recent-workspace-") {
        if let Ok(index) = rest.parse::<usize>() {
            return MenuAction::RecentWorkspace(index);
        }
        return MenuAction::Generic;
    }
    if let Some(rest) = id.strip_prefix("genie-item-") {
        if let Ok(index) = rest.parse::<usize>() {
            return MenuAction::GenieItem(index);
        }
        return MenuAction::Generic;
    }
    match id {
        "quit" => MenuAction::Quit,
        "save-all-quit" => MenuAction::SaveAllQuit,
        "clear-recent-workspaces" => MenuAction::ClearRecentWorkspaces,
        "install-cli" => MenuAction::InstallCli,
        "new-window" => MenuAction::NewWindow,
        "preferences" => MenuAction::Preferences,
        "about" => MenuAction::About,
        "new" => MenuAction::New,
        "close" => MenuAction::Close,
        "open" | "open-folder" | "quick-open" => MenuAction::OpenLike,
        _ => MenuAction::Generic,
    }
}

/// Where to send an event that targets a document window.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum DocumentRouting {
    /// A focused document window exists — emit directly (it is ready).
    EmitToFocused,
    /// No document windows at all — create one and queue the event.
    CreateWindowAndQueue,
    /// A document window exists but is not focused (e.g. just created by
    /// Reopen) — queue atomically; flushed when the window becomes ready.
    QueueToExistingWindow,
}

/// Pure routing decision shared by recent-file, recent-workspace and
/// open/open-folder/quick-open handling.
pub(super) fn decide_document_routing(
    has_focused_document: bool,
    has_any_document: bool,
) -> DocumentRouting {
    if has_focused_document {
        DocumentRouting::EmitToFocused
    } else if !has_any_document {
        DocumentRouting::CreateWindowAndQueue
    } else {
        DocumentRouting::QueueToExistingWindow
    }
}

/// Route an event to a document window per `decide_document_routing`.
fn route_to_document_window(app: &AppHandle, event: PendingMenuEvent) {
    let focused = get_focused_document_window(app);
    match decide_document_routing(focused.is_some(), has_document_windows(app)) {
        DocumentRouting::EmitToFocused => {
            if let Some(window) = focused {
                emit_event(&window, &event);
            }
        }
        DocumentRouting::CreateWindowAndQueue => create_window_and_queue(app, event),
        DocumentRouting::QueueToExistingWindow => {
            if let Some(window) = get_any_document_window(app) {
                emit_or_queue_atomic(&window, event);
            }
        }
    }
}

/// Route a native menu click to the correct frontend window via Tauri events.
pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match classify_menu_id(id) {
        // Custom Quit (Cmd+Q) is handled in Rust so we can coordinate
        // unsaved-changes prompts. request_quit applies the confirm-quit gate
        // internally before starting coordinated quit.
        MenuAction::Quit => quit::request_quit(app),
        MenuAction::SaveAllQuit => handle_save_all_quit(app),
        MenuAction::RecentFile(index) => handle_recent_file(app, index),
        MenuAction::RecentWorkspace(index) => handle_recent_workspace(app, index),
        MenuAction::GenieItem(index) => handle_genie_item(app, id, index),
        MenuAction::ClearRecentWorkspaces => handle_clear_recent_workspaces(app),
        MenuAction::InstallCli => handle_install_cli(app, id),
        MenuAction::NewWindow => handle_new_window(app),
        MenuAction::Preferences => handle_preferences(app),
        MenuAction::About => handle_about(app),
        MenuAction::New => handle_new(app, id),
        MenuAction::Close => handle_close(app),
        MenuAction::OpenLike => {
            route_to_document_window(app, make_menu_event(&format!("menu:{id}")))
        }
        MenuAction::Generic => emit_generic(app, id),
    }
}

/// Save All and Quit (Alt+Shift+Cmd+Q): emit to a document window so the
/// frontend can run save-all logic; with no document windows there is nothing
/// to save — just quit.
fn handle_save_all_quit(app: &AppHandle) {
    let event = make_menu_event("menu:save-all-quit");
    if let Some(focused) = get_focused_document_window(app) {
        emit_or_queue_atomic(&focused, event);
    } else if let Some(window) = get_any_document_window(app) {
        emit_or_queue_atomic(&window, event);
    } else {
        crate::window_manager::force_quit(app.clone());
    }
}

/// Recent-file click: resolve the path from the snapshot taken at menu build
/// time (avoids TOCTOU races with the store) and route it. A missing path
/// (snapshot shrank since build) is a deliberate no-op.
fn handle_recent_file(app: &AppHandle, index: usize) {
    if let Some(path) = crate::menu::get_recent_file_path(index) {
        route_to_document_window(app, make_recent_file_event(&path));
    }
}

/// Recent-workspace click: same snapshot lookup and routing as recent files.
fn handle_recent_workspace(app: &AppHandle, index: usize) {
    if let Some(path) = crate::menu::get_recent_workspace_path(index) {
        route_to_document_window(app, make_recent_workspace_event(&path));
    }
}

/// Genie click: resolve the genie path from its snapshot and emit to the
/// focused document window only. An unknown index falls back to generic
/// routing (historical behavior).
fn handle_genie_item(app: &AppHandle, id: &str, index: usize) {
    if let Some(path) = crate::menu::get_genie_path(index) {
        let event = PendingMenuEvent {
            event_name: "menu:invoke-genie".to_string(),
            recent_file_path: Some(path),
        };
        if let Some(focused) = get_focused_document_window(app) {
            emit_event(&focused, &event);
        }
    } else {
        emit_generic(app, id);
    }
}

fn handle_clear_recent_workspaces(app: &AppHandle) {
    if let Some(focused) = get_focused_document_window(app) {
        let _ = focused.emit("menu:clear-recent-workspaces", focused.label());
    }
}

/// Install or manage the `vmark` shell command (macOS-only dialog flow);
/// other platforms fall back to generic routing (the item is not in their
/// menus, so this arm is effectively unreachable there).
fn handle_install_cli(app: &AppHandle, id: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = id;
        crate::cli_install::dialog::run_install_toggle(app.clone());
    }
    #[cfg(not(target_os = "macos"))]
    emit_generic(app, id);
}

/// "new-window" creates a new window directly in Rust.
fn handle_new_window(app: &AppHandle) {
    if let Err(e) = crate::window_manager::create_document_window(app, None, None) {
        log::error!("[menu_events] Failed to create window for 'new-window': {e}");
    }
}

/// "preferences" is always handled in Rust so it works whether the Settings
/// window is open, backgrounded, or absent — even with no document windows.
fn handle_preferences(app: &AppHandle) {
    log::debug!("[menu_events] Handling 'preferences' menu event");
    match crate::window_manager::show_settings_window(app) {
        Ok(label) => log::debug!("[menu_events] Settings window ready: {label}"),
        Err(e) => log::error!("[menu_events] Failed to show settings: {e}"),
    }
}

/// "about" opens the Settings window at the About section.
fn handle_about(app: &AppHandle) {
    log::debug!("[menu_events] Handling 'about' menu event");
    match crate::window_manager::show_settings_window_section(app, Some("about")) {
        Ok(label) => log::debug!("[menu_events] Settings window (about) ready: {label}"),
        Err(e) => log::error!("[menu_events] Failed to show about: {e}"),
    }
}

/// "new" creates a tab in the current window; with no document windows it
/// creates a new window instead (Cmd+N after the last window closed).
fn handle_new(app: &AppHandle, id: &str) {
    if !has_document_windows(app) {
        if let Err(e) = crate::window_manager::create_document_window(app, None, None) {
            log::error!("[menu_events] Failed to create window for 'new': {e}");
        }
    } else {
        emit_generic(app, id);
    }
}

/// "close" (Cmd+W) only affects the focused window. `window.emit()`
/// broadcasts to all windows, so the target label rides in the payload.
fn handle_close(app: &AppHandle) {
    if let Some(focused) = get_focused_window(app) {
        let _ = focused.emit("menu:close", focused.label());
    }
}

/// Generic fallback: emit `menu:{id}` to the focused document window, or any
/// document window. On Windows, clicking a menu item can momentarily shift
/// focus away from the webview; the fallback prevents silent event loss.
/// Document events (save, undo, …) must never reach the settings window,
/// hence `get_focused_document_window` rather than `get_focused_window`.
fn emit_generic(app: &AppHandle, id: &str) {
    let target = get_focused_document_window(app).or_else(|| get_any_document_window(app));
    if let Some(window) = target {
        let event_name = format!("menu:{id}");
        let _ = window.emit(&event_name, window.label());
    }
}

#[cfg(test)]
#[path = "menu_events_dispatch.test.rs"]
mod tests;
