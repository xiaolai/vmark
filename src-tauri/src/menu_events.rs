//! # Menu Event Dispatcher
//!
//! Purpose: Routes native menu clicks to the correct frontend window via Tauri events.
//!
//! Pipeline: User clicks menu item → `handle_menu_event` → emits `menu:{id}` to focused window.
//!
//! Key decisions:
//!   - Window readiness tracking prevents events from being lost during cold start.
//!     Events are queued until the frontend signals "ready", then flushed atomically.
//!   - Quit and Settings are handled entirely in Rust (no frontend round-trip needed).
//!   - Recent files/workspaces/genies resolve paths from snapshot Mutexes in `menu.rs`
//!     to avoid TOCTOU races if the store changes between menu build and click.
//!   - "close" events include the target window label so the frontend can filter correctly.
//!
//! Known limitations:
//!   - On Windows, clicking a menu item can momentarily defocus the webview, so
//!     we fall back to "any document window" when no focused window is found.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::quit;

/// Pending menu event to emit when window becomes ready
#[derive(Clone)]
struct PendingMenuEvent {
    event_name: String,
    /// For simple events, payload is just the window label
    /// For recent-file events, payload includes the file path
    recent_file_path: Option<String>,
}

/// Global state for window readiness tracking
/// - ready_windows: windows that have emitted "ready"
/// - pending_events: events waiting to be emitted when window becomes ready
static WINDOW_READY_STATE: Mutex<Option<WindowReadyState>> = Mutex::new(None);

struct WindowReadyState {
    ready_windows: HashSet<String>,
    pending_events: HashMap<String, Vec<PendingMenuEvent>>,
}

impl WindowReadyState {
    fn new() -> Self {
        Self {
            ready_windows: HashSet::new(),
            pending_events: HashMap::new(),
        }
    }
}

fn get_state() -> std::sync::MutexGuard<'static, Option<WindowReadyState>> {
    // Recover from poisoned mutex - state may be inconsistent but app won't crash
    WINDOW_READY_STATE.lock().unwrap_or_else(|poisoned| {
        #[cfg(debug_assertions)]
        eprintln!("[menu_events] WARNING: Mutex was poisoned, recovering");
        poisoned.into_inner()
    })
}

/// Mark a window as ready and flush any pending events
pub fn mark_window_ready(app: &AppHandle, label: &str) {
    let pending: Vec<PendingMenuEvent>;
    {
        let mut state = get_state();
        let s = state.get_or_insert_with(WindowReadyState::new);
        s.ready_windows.insert(label.to_string());
        pending = s.pending_events.remove(label).unwrap_or_default();
    }

    // Emit pending events outside the lock
    if let Some(window) = app.get_webview_window(label) {
        for event in &pending {
            #[cfg(debug_assertions)]
            eprintln!(
                "[menu_events] Flushing pending event '{}' to window '{}'",
                event.event_name, label
            );
            emit_event(&window, event);
        }
    }
}

/// Queue an event to be emitted when window becomes ready.
/// Used internally - callers should use `emit_or_queue_atomic`.
fn queue_event(label: &str, event: PendingMenuEvent) {
    let mut state = get_state();
    let s = state.get_or_insert_with(WindowReadyState::new);
    s.pending_events
        .entry(label.to_string())
        .or_default()
        .push(event);
}

/// Remove window from ready state (called when window is destroyed)
pub fn clear_window_ready(label: &str) {
    let mut state = get_state();
    if let Some(s) = state.as_mut() {
        s.ready_windows.remove(label);
        s.pending_events.remove(label);
    }
}

/// Atomically check if window is ready and either return true (emit now) or queue the event.
/// This prevents TOCTOU race conditions by doing check-and-queue in single lock acquisition.
fn check_ready_or_queue(label: &str, event: PendingMenuEvent) -> bool {
    let mut state = get_state();
    let s = state.get_or_insert_with(WindowReadyState::new);
    if s.ready_windows.contains(label) {
        true // Window is ready, caller should emit directly
    } else {
        // Window not ready, queue the event atomically
        s.pending_events
            .entry(label.to_string())
            .or_default()
            .push(event);
        false
    }
}

/// Check if there are any document windows open (ignores settings window)
fn has_document_windows(app: &AppHandle) -> bool {
    app.webview_windows()
        .values()
        .any(|w| w.label() != "settings")
}

/// Get the focused window, if any
fn get_focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .cloned()
}

/// Get the focused document window (excludes settings window)
fn get_focused_document_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .values()
        .find(|w| {
            let label = w.label();
            w.is_focused().unwrap_or(false) && (label == "main" || label.starts_with("doc-"))
        })
        .cloned()
}

/// Get any document window (main or doc-*), regardless of focus state.
/// Prefers "main" for deterministic behavior; falls back to any doc-* window.
fn get_any_document_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    windows.get("main").cloned().or_else(|| {
        windows
            .values()
            .find(|w| w.label().starts_with("doc-"))
            .cloned()
    })
}

/// Emit an event immediately using its payload format
fn emit_event(window: &tauri::WebviewWindow, event: &PendingMenuEvent) {
    let label = window.label();
    if let Some(ref path) = event.recent_file_path {
        let _ = window.emit(&event.event_name, (path.as_str(), label));
    } else {
        let _ = window.emit(&event.event_name, label);
    }
}

/// Atomically emit an event to a window if ready, or queue it for later.
/// This is race-condition safe: check and queue happen in a single lock acquisition.
fn emit_or_queue_atomic(window: &tauri::WebviewWindow, event: PendingMenuEvent) {
    let label = window.label();
    #[cfg(debug_assertions)]
    let event_name = event.event_name.clone(); // For logging

    if check_ready_or_queue(label, event.clone()) {
        #[cfg(debug_assertions)]
        eprintln!(
            "[menu_events] Window '{}' is ready, emitting '{}' directly",
            label, event_name
        );
        emit_event(window, &event);
    } else {
        #[cfg(debug_assertions)]
        eprintln!(
            "[menu_events] Window '{}' not ready, queued '{}'",
            label, event_name
        );
    }
}

/// Create a PendingMenuEvent for a simple menu event (payload is just window label)
fn make_menu_event(event_name: &str) -> PendingMenuEvent {
    PendingMenuEvent {
        event_name: event_name.to_string(),
        recent_file_path: None,
    }
}

/// Create a PendingMenuEvent for a recent-file event (payload includes file path)
fn make_recent_file_event(path: &str) -> PendingMenuEvent {
    PendingMenuEvent {
        event_name: "menu:open-recent-file".to_string(),
        recent_file_path: Some(path.to_string()),
    }
}

/// Create a PendingMenuEvent for a recent-workspace event (payload includes workspace path)
fn make_recent_workspace_event(path: &str) -> PendingMenuEvent {
    PendingMenuEvent {
        event_name: "menu:open-recent-workspace".to_string(),
        recent_file_path: Some(path.to_string()),
    }
}

/// Create a new document window and queue an event to it.
/// The event will be emitted when the window becomes ready.
fn create_window_and_queue(app: &AppHandle, event: PendingMenuEvent) {
    if let Ok(label) = crate::window_manager::create_document_window(app, None, None) {
        #[cfg(debug_assertions)]
        eprintln!(
            "[menu_events] Created window '{}', queueing event '{}'",
            label, event.event_name
        );
        queue_event(&label, event);
    }
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    // Custom Quit (Cmd+Q) is handled in Rust so we can coordinate unsaved-changes prompts.
    // request_quit applies the confirm-quit gate internally before starting coordinated quit.
    if id == "quit" {
        quit::request_quit(app);
        return;
    }

    // Save All and Quit (Alt+Shift+Cmd+Q) - emit to document window to handle save-all logic
    // Uses get_focused_document_window to skip Settings window
    if id == "save-all-quit" {
        let event = make_menu_event("menu:save-all-quit");
        if let Some(focused) = get_focused_document_window(app) {
            emit_or_queue_atomic(&focused, event);
        } else if let Some(window) = get_any_document_window(app) {
            emit_or_queue_atomic(&window, event);
        } else {
            // No document windows - nothing to save, just quit
            crate::window_manager::force_quit(app.clone());
        }
        return;
    }

    // Handle recent file clicks specially - look up path from snapshot and emit
    // Emit to focused window with (path, windowLabel) tuple
    // Three cases: focused window, no windows, windows exist but not focused
    if let Some(index_str) = id.strip_prefix("recent-file-") {
        if let Ok(index) = index_str.parse::<usize>() {
            // Look up path from the snapshot stored when menu was built
            // This prevents race conditions if store changed since menu creation
            if let Some(path) = crate::menu::get_recent_file_path(index) {
                let event = make_recent_file_event(&path);
                if let Some(focused) = get_focused_window(app) {
                    // Case 1: Focused window - emit directly (window is ready)
                    emit_event(&focused, &event);
                } else if !has_document_windows(app) {
                    // Case 2: No windows - create one and queue event
                    create_window_and_queue(app, event);
                } else if let Some(window) = get_any_document_window(app) {
                    // Case 3: Window exists but not focused (just created by Reopen)
                    // Atomically queue event - will be flushed when window becomes ready
                    emit_or_queue_atomic(&window, event);
                }
            }
            return;
        }
    }

    // Handle recent workspace clicks - similar to recent files
    if let Some(index_str) = id.strip_prefix("recent-workspace-") {
        if let Ok(index) = index_str.parse::<usize>() {
            if let Some(path) = crate::menu::get_recent_workspace_path(index) {
                let event = make_recent_workspace_event(&path);
                if let Some(focused) = get_focused_window(app) {
                    emit_event(&focused, &event);
                } else if !has_document_windows(app) {
                    create_window_and_queue(app, event);
                } else if let Some(window) = get_any_document_window(app) {
                    emit_or_queue_atomic(&window, event);
                }
            }
            return;
        }
    }

    // Handle genie item clicks — look up path from snapshot and emit
    if let Some(index_str) = id.strip_prefix("genie-item-") {
        if let Ok(index) = index_str.parse::<usize>() {
            if let Some(path) = crate::menu::get_genie_path(index) {
                let event = PendingMenuEvent {
                    event_name: "menu:invoke-genie".to_string(),
                    recent_file_path: Some(path),
                };
                if let Some(focused) = get_focused_window(app) {
                    emit_event(&focused, &event);
                }
                return;
            }
        }
    }

    // Handle clear-recent-workspaces
    if id == "clear-recent-workspaces" {
        if let Some(focused) = get_focused_window(app) {
            let _ = focused.emit("menu:clear-recent-workspaces", focused.label());
        }
        return;
    }

    // "new-window" creates a new window directly in Rust
    if id == "new-window" {
        let _ = crate::window_manager::create_document_window(app, None, None);
        return;
    }

    // "preferences" - always handle in Rust to ensure it works in all scenarios:
    // - Settings already open and focused
    // - Settings open but in background
    // - No Settings window exists
    // - No document windows exist
    if id == "preferences" {
        #[cfg(debug_assertions)]
        eprintln!("[menu_events] Handling 'preferences' menu event");
        match crate::window_manager::show_settings_window(app) {
            Ok(_label) => {
                #[cfg(debug_assertions)]
                eprintln!("[menu_events] Settings window ready: {}", _label);
            }
            Err(e) => {
                eprintln!("[menu_events] ERROR: Failed to show settings: {}", e);
            }
        }
        return;
    }

    // "about" - open Settings window at About section
    if id == "about" {
        #[cfg(debug_assertions)]
        eprintln!("[menu_events] Handling 'about' menu event");
        match crate::window_manager::show_settings_window_section(app, Some("about")) {
            Ok(_label) => {
                #[cfg(debug_assertions)]
                eprintln!("[menu_events] Settings window (about) ready: {}", _label);
            }
            Err(e) => {
                eprintln!("[menu_events] ERROR: Failed to show about: {}", e);
            }
        }
        return;
    }

    // "new" creates a tab in current window, but if no windows exist, create a new window
    // (Cmd+N when last window closed should open a new window)
    if id == "new"
        && !has_document_windows(app) {
            let _ = crate::window_manager::create_document_window(app, None, None);
            return;
        }

    // "close" (Cmd+W) should only affect the focused window
    // Note: window.emit() broadcasts to all windows, so include target label in payload
    if id == "close" {
        if let Some(focused) = get_focused_window(app) {
            let _ = focused.emit("menu:close", focused.label());
        }
        return;
    }

    // File operations that should work without windows
    // Three cases to handle:
    // 1. Focused window exists → emit directly
    // 2. No windows at all → create window, queue event for when ready
    // 3. Windows exist but none focused → queue event for when ready
    if matches!(id, "open" | "open-folder") {
        let event = make_menu_event(&format!("menu:{id}"));
        if let Some(focused) = get_focused_window(app) {
            // Case 1: Focused window - emit directly (window is ready)
            emit_event(&focused, &event);
        } else if !has_document_windows(app) {
            // Case 2: No windows - create one and queue event
            create_window_and_queue(app, event);
        } else if let Some(window) = get_any_document_window(app) {
            // Case 3: Window exists but not focused (just created by Reopen)
            // Atomically queue event - will be flushed when window becomes ready
            emit_or_queue_atomic(&window, event);
        }
        return;
    }

    // "clear-recent" can be handled without a window if needed
    // But for consistency, we still emit to a window (frontend handles storage)

    // All other menu events: try focused document window first, fall back to any document window.
    // On Windows, clicking a menu item can momentarily shift focus away from the webview,
    // causing is_focused() to return false. The fallback prevents silent event loss.
    // Uses get_focused_document_window (not get_focused_window) to avoid sending
    // document events (save, undo, etc.) to the settings window.
    let target = get_focused_document_window(app).or_else(|| get_any_document_window(app));
    if let Some(window) = target {
        let event_name = format!("menu:{id}");
        let _ = window.emit(&event_name, window.label());
    }
}
