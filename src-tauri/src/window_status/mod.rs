//! # Window status registry (#1057)
//!
//! Purpose: a cross-window registry of per-window "Claude Code" status so a
//! single panel (under the Window menu, opened in any window) can list every
//! open VMark window with its live status and jump to it. Windows are isolated
//! webviews, so each reports its own status via `invoke`; this module keeps the
//! aggregate in managed state and broadcasts `window-status:changed` (global
//! `app.emit`) on every change. Entries are pruned when a window is destroyed.
//!
//! Status is built from the two reliable signals (plan ADR-1): VMark's AI-genie
//! invocation state (`ai`: idle/running/error + `elapsedSeconds`) and a
//! terminal-bell `attention` flag (set on an unfocused bell, cleared on focus).
//! We deliberately do NOT parse PTY output for a run-state.
//!
//! @coordinates-with src/stores/windowStatusStore.ts — frontend listener
//! @coordinates-with src/hooks/useWindowStatusReporter.ts — per-window reporter
//! @module window_status

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Window};

/// One window's current status. Serialized to the frontend in camelCase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowStatus {
    pub label: String,
    pub doc_name: String,
    /// "idle" | "running" | "error" — VMark AI-genie invocation state.
    pub ai: String,
    pub elapsed_seconds: u32,
    /// A terminal bell rang while this window was unfocused; cleared on focus.
    pub attention: bool,
}

/// Managed cross-window registry: window label → status.
#[derive(Default)]
pub struct WindowStatusRegistry(pub Mutex<HashMap<String, WindowStatus>>);

const EVENT: &str = "window-status:changed";

fn base(label: &str) -> WindowStatus {
    WindowStatus {
        label: label.to_string(),
        doc_name: String::new(),
        ai: "idle".to_string(),
        elapsed_seconds: 0,
        attention: false,
    }
}

// --- Pure reducers (unit-tested without a Tauri Window) ---------------------

fn upsert_status(
    map: &mut HashMap<String, WindowStatus>,
    label: &str,
    doc_name: String,
    ai: String,
    elapsed_seconds: u32,
) {
    let entry = map.entry(label.to_string()).or_insert_with(|| base(label));
    entry.doc_name = doc_name;
    entry.ai = ai;
    entry.elapsed_seconds = elapsed_seconds;
}

/// Set/clear a window's attention flag. Returns `true` only when the value
/// actually changed, so callers can skip a redundant broadcast (rapid repeat
/// bells don't re-emit identical snapshots). A *clear* never creates an entry —
/// only a window that already exists can lose attention (no phantom idle rows).
fn set_attention(map: &mut HashMap<String, WindowStatus>, label: &str, on: bool) -> bool {
    match map.get_mut(label) {
        Some(entry) => {
            if entry.attention == on {
                false
            } else {
                entry.attention = on;
                true
            }
        }
        None if on => {
            let mut entry = base(label);
            entry.attention = true;
            map.insert(label.to_string(), entry);
            true
        }
        None => false,
    }
}

/// Snapshot the registry as a stable, label-sorted Vec for the frontend.
fn snapshot(map: &HashMap<String, WindowStatus>) -> Vec<WindowStatus> {
    let mut v: Vec<WindowStatus> = map.values().cloned().collect();
    v.sort_by(|a, b| a.label.cmp(&b.label));
    v
}

fn broadcast(app: &AppHandle) {
    let snap = {
        let registry = app.state::<WindowStatusRegistry>();
        let map = registry.0.lock().expect("window status registry poisoned");
        snapshot(&map)
    };
    let _ = app.emit(EVENT, snap);
}

// --- Commands ---------------------------------------------------------------

/// Upsert the calling window's AI status + active-document name.
#[tauri::command]
pub fn report_window_status(window: Window, doc_name: String, ai: String, elapsed_seconds: u32) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    {
        let registry = app.state::<WindowStatusRegistry>();
        let mut map = registry.0.lock().expect("window status registry poisoned");
        upsert_status(&mut map, &label, doc_name, ai, elapsed_seconds);
    }
    broadcast(&app);
}

/// Flag the calling window as needing attention (unfocused terminal bell).
#[tauri::command]
pub fn set_window_attention(window: Window) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let changed = {
        let registry = app.state::<WindowStatusRegistry>();
        let mut map = registry.0.lock().expect("window status registry poisoned");
        set_attention(&mut map, &label, true)
    };
    if changed {
        broadcast(&app);
    }
}

/// Clear the calling window's attention flag (it just gained focus).
#[tauri::command]
pub fn clear_window_attention(window: Window) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let changed = {
        let registry = app.state::<WindowStatusRegistry>();
        let mut map = registry.0.lock().expect("window status registry poisoned");
        set_attention(&mut map, &label, false)
    };
    if changed {
        broadcast(&app);
    }
}

/// Current snapshot of all window statuses (for a panel that just opened).
#[tauri::command]
pub fn get_window_statuses(app: AppHandle) -> Vec<WindowStatus> {
    let registry = app.state::<WindowStatusRegistry>();
    let map = registry.0.lock().expect("window status registry poisoned");
    snapshot(&map)
}

/// Focus (and unminimize) the window with the given label.
#[tauri::command]
pub fn focus_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window not found: {label}"))?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())
}

/// Remove a destroyed window from the registry and broadcast the change.
pub fn prune(app: &AppHandle, label: &str) {
    {
        let registry = app.state::<WindowStatusRegistry>();
        let mut map = registry.0.lock().expect("window status registry poisoned");
        map.remove(label);
    }
    broadcast(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_creates_then_updates() {
        let mut m = HashMap::new();
        upsert_status(&mut m, "w1", "doc.md".into(), "running".into(), 3);
        assert_eq!(m["w1"].ai, "running");
        assert_eq!(m["w1"].doc_name, "doc.md");
        assert_eq!(m["w1"].elapsed_seconds, 3);
        assert!(!m["w1"].attention);

        upsert_status(&mut m, "w1", "doc.md".into(), "idle".into(), 0);
        assert_eq!(m["w1"].ai, "idle");
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn attention_preserved_across_status_report() {
        let mut m = HashMap::new();
        set_attention(&mut m, "w1", true);
        assert!(m["w1"].attention);
        // A status report must not clobber the attention flag.
        upsert_status(&mut m, "w1", "d".into(), "running".into(), 1);
        assert!(m["w1"].attention);
        set_attention(&mut m, "w1", false);
        assert!(!m["w1"].attention);
    }

    #[test]
    fn set_attention_reports_changes_and_never_inserts_on_clear() {
        let mut m = HashMap::new();
        // Clearing an unknown window is a no-op — no change, no phantom entry.
        assert!(!set_attention(&mut m, "ghost", false));
        assert!(m.is_empty());
        // First set: changed, creates the entry.
        assert!(set_attention(&mut m, "w1", true));
        assert!(m["w1"].attention);
        // Redundant set: no change (so callers skip the broadcast).
        assert!(!set_attention(&mut m, "w1", true));
        // Clearing an existing entry: changed.
        assert!(set_attention(&mut m, "w1", false));
        assert!(!m["w1"].attention);
        // Redundant clear: no change.
        assert!(!set_attention(&mut m, "w1", false));
    }

    #[test]
    fn snapshot_is_label_sorted() {
        let mut m = HashMap::new();
        upsert_status(&mut m, "zeta", "z".into(), "idle".into(), 0);
        upsert_status(&mut m, "alpha", "a".into(), "idle".into(), 0);
        let snap = snapshot(&m);
        assert_eq!(
            snap.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(),
            ["alpha", "zeta"]
        );
    }
}
