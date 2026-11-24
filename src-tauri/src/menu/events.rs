//! # Menu Event Dispatcher
//!
//! Purpose: Routes native menu clicks to the correct frontend window and uses
//! listener readiness to seed Finder hot-open target selection.
//!
//! Pipeline: User clicks menu item → `handle_menu_event` (in
//! `events/dispatch.rs`) → emits `menu:{id}` to focused window.
//!
//! This file owns the window-readiness/queueing machinery and the event
//! constructors; id classification and per-action handlers live in the
//! `dispatch` child module, window lookups in the `windows` child module
//! (both under `menu/events/`, split out for the file-size ratchet).
//!
//! Key decisions:
//!   - Window readiness tracking prevents events from being lost during cold start.
//!     Events are queued until the frontend signals "ready", then flushed atomically.
//!   - Quit and Settings are handled entirely in Rust (no frontend round-trip needed).
//!   - Recent files/workspaces/genies resolve paths from snapshot Mutexes in `menu/mod.rs`
//!     to avoid TOCTOU races if the store changes between menu build and click.
//!   - "close" events include the target window label so the frontend can filter correctly.
//!   - The readiness queue is shared with quit (`deliver_when_ready`): a window
//!     still mounting has no listener for a quit request either, and one
//!     record of who is listening cannot disagree with itself.
//!
//! Known limitations:
//!   - On Windows, clicking a menu item can momentarily defocus the webview, so
//!     we fall back to "any document window" when no focused window is found.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

mod dispatch;
mod fullscreen;
mod windows;

pub use dispatch::handle_menu_event;
pub(crate) use fullscreen::{forget_window as forget_fullscreen_window, note_window_focus};

/// Pending menu event to emit when window becomes ready
#[derive(Clone)]
struct PendingMenuEvent {
    event_name: String,
    /// For simple events, payload is just the window label
    /// For recent-file events, payload includes the file path
    recent_file_path: Option<String>,
    /// A payload emitted as it is, in place of the two forms above: what
    /// [`deliver_when_ready`] was handed. `None` for every menu event.
    payload: Option<serde_json::Value>,
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
pub fn mark_window_ready<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) {
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
                "[menu_events] Flushing pending event {:?} to window {:?}",
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

/// Whether a window has emitted `ready` after mounting its frontend listeners.
pub fn is_window_ready(label: &str) -> bool {
    let state = get_state();
    state
        .as_ref()
        .is_some_and(|s| s.ready_windows.contains(label))
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
fn emit_event<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, event: &PendingMenuEvent) {
    let label = window.label();
    let result = if let Some(ref payload) = event.payload {
        window.emit(&event.event_name, payload)
    } else if let Some(ref path) = event.recent_file_path {
        window.emit(&event.event_name, (path.as_str(), label))
    } else {
        window.emit(&event.event_name, label)
    };
    if let Err(e) = result {
        log::warn!(
            "[menu_events] Failed to emit {:?} to window {:?}: {}",
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
            "[menu_events] Window {:?} is ready, emitting {:?} directly",
            label,
            event_name
        );
        emit_event(window, &event);
    } else {
        log::debug!(
            "[menu_events] Window {:?} not ready, queued {:?}",
            label,
            event_name
        );
    }
}

/// What [`deliver_when_ready`] did with an event.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Delivery {
    /// The window's frontend is listening; the event was emitted.
    Emitted,
    /// The window has not signalled `ready`; the event is queued and will be
    /// emitted when it does.
    Deferred,
}

/// Deliver `payload` as `event_name` to `window`: now if its frontend is
/// listening, when it signals `ready` otherwise.
///
/// Unlike a menu event, the caller needs the outcome — a failed emit is
/// returned rather than logged — and asking twice must not deliver twice, so
/// an event already waiting for this window is not queued again. It takes the
/// newer payload instead: a quit asked again can ask for more (save
/// everything rather than ask), and the window must get what is asked now.
pub(crate) fn deliver_when_ready<R: tauri::Runtime, P: serde::Serialize>(
    window: &tauri::WebviewWindow<R>,
    event_name: &str,
    payload: &P,
) -> tauri::Result<Delivery> {
    let payload = serde_json::to_value(payload)?;
    let label = window.label();
    {
        let mut state = get_state();
        let s = state.get_or_insert_with(WindowReadyState::new);
        if !s.ready_windows.contains(label) {
            let waiting = s.pending_events.entry(label.to_string()).or_default();
            match waiting
                .iter_mut()
                .find(|event| event.event_name == event_name)
            {
                Some(event) => event.payload = Some(payload),
                None => waiting.push(PendingMenuEvent {
                    payload: Some(payload),
                    ..make_menu_event(event_name)
                }),
            }
            return Ok(Delivery::Deferred);
        }
    }
    window.emit(event_name, payload)?;
    Ok(Delivery::Emitted)
}

/// Withdraw `event_name` from every window it is still waiting for, so a
/// window that becomes ready later is not handed a request that was called off.
pub(crate) fn withdraw_deferred(event_name: &str) {
    if let Some(s) = get_state().as_mut() {
        for waiting in s.pending_events.values_mut() {
            waiting.retain(|event| event.event_name != event_name);
        }
    }
}

/// Create a PendingMenuEvent for a simple menu event (payload is just window label)
fn make_menu_event(event_name: &str) -> PendingMenuEvent {
    PendingMenuEvent {
        event_name: event_name.to_string(),
        recent_file_path: None,
        payload: None,
    }
}

/// Create a PendingMenuEvent for a recent-file event (payload includes file path)
fn make_recent_file_event(path: &str) -> PendingMenuEvent {
    PendingMenuEvent {
        event_name: "menu:open-recent-file".to_string(),
        recent_file_path: Some(path.to_string()),
        payload: None,
    }
}

/// Create a PendingMenuEvent for a recent-workspace event (payload includes workspace path)
fn make_recent_workspace_event(path: &str) -> PendingMenuEvent {
    PendingMenuEvent {
        event_name: "menu:open-recent-workspace".to_string(),
        recent_file_path: Some(path.to_string()),
        payload: None,
    }
}

/// Create a new document window and queue an event to it.
/// The event will be emitted when the window becomes ready.
fn create_window_and_queue(app: &AppHandle, event: PendingMenuEvent) {
    if let Ok(label) = crate::window_manager::create_document_window(app, None, None) {
        log::debug!(
            "[menu_events] Created window {:?}, queueing event {:?}",
            label,
            event.event_name
        );
        queue_event(&label, event);
    }
}

#[cfg(test)]
#[path = "events.test.rs"]
mod tests;
