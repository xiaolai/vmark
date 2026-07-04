//! # Menu Event Dispatcher
//!
//! Purpose: Routes native menu clicks to the correct frontend window via Tauri events.
//!
//! Pipeline: User clicks menu item → `handle_menu_event` (in
//! `menu_events_dispatch.rs`) → emits `menu:{id}` to focused window.
//!
//! This file owns the window-readiness/queueing machinery and the event
//! constructors; id classification and per-action handlers live in the
//! `dispatch` child module, window lookups in the `windows` child module
//! (both included via `#[path]` for the file-size ratchet).
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

#[path = "menu_events_dispatch.rs"]
mod dispatch;
#[path = "menu_events_windows.rs"]
mod windows;

pub use dispatch::handle_menu_event;

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
        log::warn!("[menu_events] Mutex was poisoned, recovering");
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
            log::debug!(
                "[menu_events] Flushing pending event '{}' to window '{}'",
                event.event_name,
                label
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

/// Emit an event immediately using its payload format.
///
/// Logs a warning on failure. The most common failure mode is the window
/// being destroyed between the readiness check and the emit (e.g. user
/// closes the window while a menu accelerator is in flight). Silent loss
/// was making race-condition reports very hard to diagnose; the warning
/// makes the dropped event visible without producing a crash.
fn emit_event(window: &tauri::WebviewWindow, event: &PendingMenuEvent) {
    let label = window.label();
    let result = if let Some(ref path) = event.recent_file_path {
        window.emit(&event.event_name, (path.as_str(), label))
    } else {
        window.emit(&event.event_name, label)
    };
    if let Err(e) = result {
        log::warn!(
            "[menu_events] Failed to emit '{}' to window '{}': {}",
            event.event_name,
            label,
            e
        );
    }
}

/// Atomically emit an event to a window if ready, or queue it for later.
/// This is race-condition safe: check and queue happen in a single lock acquisition.
fn emit_or_queue_atomic(window: &tauri::WebviewWindow, event: PendingMenuEvent) {
    let label = window.label();
    let event_name = event.event_name.clone(); // For logging

    if check_ready_or_queue(label, event.clone()) {
        log::debug!(
            "[menu_events] Window '{}' is ready, emitting '{}' directly",
            label,
            event_name
        );
        emit_event(window, &event);
    } else {
        log::debug!(
            "[menu_events] Window '{}' not ready, queued '{}'",
            label,
            event_name
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
        log::debug!(
            "[menu_events] Created window '{}', queueing event '{}'",
            label,
            event.event_name
        );
        queue_event(&label, event);
    }
}
