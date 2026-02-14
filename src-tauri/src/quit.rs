//! # Coordinated Quit
//!
//! Purpose: Manages graceful application shutdown with unsaved-changes prompts
//! and an optional double-press confirmation gate (Cmd+Q twice to quit).
//!
//! Pipeline: Cmd+Q → `request_quit` → confirm gate → `start_quit` → emit
//! `app:quit-requested` to each document window → windows close one by one →
//! `handle_window_destroyed` → when all targets gone → `finalize_quit` → `app.exit(0)`.
//!
//! Key decisions:
//!   - EXIT_ALLOWED is only set to true immediately before `app.exit(0)` to prevent
//!     premature exit during the coordinated quit flow.
//!   - The confirm-quit gate uses wall-clock timing (Instant) so it works even when
//!     the event loop is busy.
//!   - `cancel_quit` clears all state including the first-press timestamp to prevent
//!     stale timestamps from acting as a second press after cancellation.
//!
//! Known limitations:
//!   - Tests mutate shared statics and must run serially (guarded by TEST_LOCK).

use std::collections::HashSet;
use std::sync::{Mutex, LazyLock, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::mcp_server;

static QUIT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

// --- Confirm-quit gate (double Cmd+Q) ---
/// Whether the confirm-quit gate is active (default: true).
static CONFIRM_QUIT_ENABLED: AtomicBool = AtomicBool::new(true);
/// Timestamp of the first Cmd+Q press (None = no pending press).
static FIRST_QUIT_PRESS: Mutex<Option<Instant>> = Mutex::new(None);
/// Duration within which the second Cmd+Q must arrive.
const CONFIRM_QUIT_WINDOW: Duration = Duration::from_secs(2);

// IMPORTANT: A coordinated quit can be "in progress" while we still need to
// block OS quit requests until all windows have handled unsaved changes.
// This flag is only set to true immediately before calling `app.exit(0)`.
static EXIT_ALLOWED: AtomicBool = AtomicBool::new(false);
static QUIT_TARGETS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Determine whether a window label is a document window.
pub fn is_document_window_label(label: &str) -> bool {
    label == "main" || label.starts_with("doc-")
}

/// Check if a coordinated quit is in progress.
/// Whether ExitRequested should be allowed through.
pub fn is_exit_allowed() -> bool {
    EXIT_ALLOWED.load(Ordering::SeqCst)
}

fn set_exit_allowed(allowed: bool) {
    EXIT_ALLOWED.store(allowed, Ordering::SeqCst);
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

/// Sync the confirm-quit setting from the frontend.
/// Also clears any pending first-press so toggling off/on can't let a stale
/// timestamp pass as the second press.
#[tauri::command]
pub fn set_confirm_quit(enabled: bool) {
    CONFIRM_QUIT_ENABLED.store(enabled, Ordering::SeqCst);
    clear_first_quit_press();
}

fn clear_first_quit_press() {
    if let Ok(mut guard) = FIRST_QUIT_PRESS.lock() {
        *guard = None;
    }
}

/// Result of the pure confirm-quit gate check.
#[derive(Debug, PartialEq)]
pub enum QuitGateResult {
    /// Gate disabled or second press within window — proceed with quit.
    Proceed,
    /// First press recorded — show feedback and wait for second press.
    WaitForSecondPress,
}

/// Pure confirm-quit decision logic. Testable without AppHandle.
///
/// - If the gate is disabled, always returns `Proceed`.
/// - If a first press exists and is within `CONFIRM_QUIT_WINDOW`, clears it and returns `Proceed`.
/// - Otherwise records `now` as first press and returns `WaitForSecondPress`.
pub fn check_confirm_quit_gate(now: Instant) -> QuitGateResult {
    if !CONFIRM_QUIT_ENABLED.load(Ordering::SeqCst) {
        return QuitGateResult::Proceed;
    }

    let mut guard = FIRST_QUIT_PRESS.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(first_press) = *guard {
        if now.duration_since(first_press) < CONFIRM_QUIT_WINDOW {
            *guard = None;
            return QuitGateResult::Proceed;
        }
    }

    // First press (or expired) — record timestamp
    *guard = Some(now);
    QuitGateResult::WaitForSecondPress
}

/// Menu Quit / Cmd+Q entry point.
///
/// Applies the confirm-quit gate, then starts the coordinated quit flow if
/// the gate allows it. Emits `app:quit-first-press` when blocked.
///
/// Note: `RunEvent::ExitRequested` (OS-level quit, e.g. system shutdown)
/// intentionally bypasses this gate — it calls `start_quit` directly.
pub fn request_quit(app: &AppHandle) {
    match check_confirm_quit_gate(Instant::now()) {
        QuitGateResult::Proceed => start_quit(app),
        QuitGateResult::WaitForSecondPress => {
            // Emit feedback to the focused window (if any)
            if let Some(window) = app.webview_windows().values().find(|w| w.is_focused().unwrap_or(false)) {
                if let Err(_e) = window.emit("app:quit-first-press", ()) {
                    #[cfg(debug_assertions)]
                    eprintln!("[quit] Failed to emit quit-first-press: {}", _e);
                }
            }
        }
    }
}

/// Final quit: allow exit, clean up MCP, and terminate the process.
fn finalize_quit(app: &AppHandle) {
    set_exit_allowed(true);
    mcp_server::cleanup(app);
    app.exit(0);
}

/// Start coordinated quit: request close of all document windows.
pub fn start_quit(app: &AppHandle) {
    if QUIT_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }
    set_exit_allowed(false);

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
        finalize_quit(app);
        return;
    }

    set_quit_targets(targets);
}

/// Cancel an in-progress quit (e.g., user cancelled save prompt).
#[tauri::command]
pub fn cancel_quit() {
    QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
    set_exit_allowed(false);
    set_quit_targets(HashSet::new());
    // Clear stale first-press so a leftover timestamp can't pass as second press.
    clear_first_quit_press();
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
        finalize_quit(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests mutate shared statics, so they must run serially.
    // Use a global mutex to prevent parallel test interference.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Reset confirm-quit state. Must be called under TEST_LOCK.
    fn reset_confirm_quit() {
        CONFIRM_QUIT_ENABLED.store(true, Ordering::SeqCst);
        *FIRST_QUIT_PRESS.lock().unwrap() = None;
    }

    #[test]
    fn test_is_document_window_label() {
        assert!(is_document_window_label("main"));
        assert!(is_document_window_label("doc-0"));
        assert!(is_document_window_label("doc-123"));
        assert!(!is_document_window_label("settings"));
    }

    #[test]
    fn gate_disabled_proceeds_immediately() {
        let _lock = TEST_LOCK.lock().unwrap();
        reset_confirm_quit();
        CONFIRM_QUIT_ENABLED.store(false, Ordering::SeqCst);

        let now = Instant::now();
        assert_eq!(check_confirm_quit_gate(now), QuitGateResult::Proceed);
    }

    #[test]
    fn gate_first_press_blocks() {
        let _lock = TEST_LOCK.lock().unwrap();
        reset_confirm_quit();

        let now = Instant::now();
        assert_eq!(check_confirm_quit_gate(now), QuitGateResult::WaitForSecondPress);
        // Timestamp is recorded
        assert!(FIRST_QUIT_PRESS.lock().unwrap().is_some());
    }

    #[test]
    fn gate_second_press_within_window_proceeds() {
        let _lock = TEST_LOCK.lock().unwrap();
        reset_confirm_quit();

        let now = Instant::now();
        assert_eq!(check_confirm_quit_gate(now), QuitGateResult::WaitForSecondPress);

        // Second press 500ms later — within 2s window
        let later = now + Duration::from_millis(500);
        assert_eq!(check_confirm_quit_gate(later), QuitGateResult::Proceed);

        // Timestamp cleared after proceed
        assert!(FIRST_QUIT_PRESS.lock().unwrap().is_none());
    }

    #[test]
    fn gate_expired_first_press_blocks_again() {
        let _lock = TEST_LOCK.lock().unwrap();
        reset_confirm_quit();

        let now = Instant::now();
        assert_eq!(check_confirm_quit_gate(now), QuitGateResult::WaitForSecondPress);

        // Third second — expired, acts as new first press
        let expired = now + Duration::from_secs(3);
        assert_eq!(check_confirm_quit_gate(expired), QuitGateResult::WaitForSecondPress);

        // But a quick follow-up proceeds
        let follow_up = expired + Duration::from_millis(200);
        assert_eq!(check_confirm_quit_gate(follow_up), QuitGateResult::Proceed);
    }

    #[test]
    fn gate_at_exact_boundary_blocks() {
        let _lock = TEST_LOCK.lock().unwrap();
        reset_confirm_quit();

        let now = Instant::now();
        assert_eq!(check_confirm_quit_gate(now), QuitGateResult::WaitForSecondPress);

        // Exactly at 2s boundary — Duration comparison is strict `<`, so 2s is expired
        let at_boundary = now + Duration::from_secs(2);
        assert_eq!(check_confirm_quit_gate(at_boundary), QuitGateResult::WaitForSecondPress);
    }

    #[test]
    fn set_confirm_quit_clears_first_press() {
        let _lock = TEST_LOCK.lock().unwrap();
        reset_confirm_quit();

        // Record a first press
        *FIRST_QUIT_PRESS.lock().unwrap() = Some(Instant::now());
        assert!(FIRST_QUIT_PRESS.lock().unwrap().is_some());

        // Toggling the setting clears the pending press
        set_confirm_quit(false);
        assert!(FIRST_QUIT_PRESS.lock().unwrap().is_none());
    }

    #[test]
    fn cancel_quit_clears_first_press() {
        let _lock = TEST_LOCK.lock().unwrap();
        reset_confirm_quit();

        // Record a first press then cancel quit
        *FIRST_QUIT_PRESS.lock().unwrap() = Some(Instant::now());
        cancel_quit();
        assert!(FIRST_QUIT_PRESS.lock().unwrap().is_none());
    }
}
