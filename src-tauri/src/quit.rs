use std::collections::HashSet;
use std::sync::{Mutex, LazyLock, atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, Emitter, Manager};

use crate::mcp_server;

static QUIT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static QUIT_TARGETS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Determine whether a window label is a document window.
pub fn is_document_window_label(label: &str) -> bool {
    label == "main" || label.starts_with("doc-")
}

/// Check if a coordinated quit is in progress.
pub fn is_quit_in_progress() -> bool {
    QUIT_IN_PROGRESS.load(Ordering::SeqCst)
}

fn set_quit_targets(targets: HashSet<String>) {
    if let Ok(mut guard) = QUIT_TARGETS.lock() {
        *guard = targets;
    }
}

fn remove_quit_target(label: &str) -> bool {
    if let Ok(mut guard) = QUIT_TARGETS.lock() {
        guard.remove(label);
        return guard.is_empty();
    }
    false
}

/// Start coordinated quit: request close of all document windows.
pub fn start_quit(app: &AppHandle) {
    if QUIT_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }

    let mut targets = HashSet::new();
    for (label, window) in app.webview_windows() {
        if is_document_window_label(&label) {
            targets.insert(label.clone());
            let _ = window.emit("app:quit-requested", label);
        } else {
            // Close non-document windows immediately
            let _ = window.close();
        }
    }

    if targets.is_empty() {
        // Keep QUIT_IN_PROGRESS true so ExitRequested handler allows exit
        mcp_server::cleanup();
        app.exit(0);
        return;
    }

    set_quit_targets(targets);
}

/// Cancel an in-progress quit (e.g., user cancelled save prompt).
#[tauri::command]
pub fn cancel_quit() {
    QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
    set_quit_targets(HashSet::new());
}

/// Handle a window being destroyed while quit is in progress.
pub fn handle_window_destroyed(app: &AppHandle, label: &str) {
    let quit_in_progress = QUIT_IN_PROGRESS.load(Ordering::SeqCst);
    #[cfg(debug_assertions)]
    eprintln!("[Tauri] handle_window_destroyed: label={}, quit_in_progress={}", label, quit_in_progress);

    if !quit_in_progress {
        return;
    }

    if !is_document_window_label(label) {
        return;
    }

    if remove_quit_target(label) {
        #[cfg(debug_assertions)]
        eprintln!("[Tauri] handle_window_destroyed: all targets done, calling app.exit(0)");
        // Keep QUIT_IN_PROGRESS true so ExitRequested handler allows exit
        mcp_server::cleanup();
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_document_window_label() {
        assert!(is_document_window_label("main"));
        assert!(is_document_window_label("doc-0"));
        assert!(is_document_window_label("doc-123"));
        assert!(!is_document_window_label("settings"));
        assert!(!is_document_window_label("print-preview"));
    }
}
