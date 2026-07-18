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
use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock, Mutex,
};
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

/// Return `true` if the label identifies a document window (`main` or `doc-*`).
pub fn is_document_window_label(label: &str) -> bool {
    label == "main" || label.starts_with("doc-")
}

#[derive(Debug, PartialEq)]
pub enum ExitRequestAction {
    AllowExit,
    PreventAndStartQuit,
    PreventAndKeepAlive,
}

/// Decide how to handle Tauri's process-level exit request.
///
/// macOS keeps the app alive when the last window closes so the Dock icon can
/// reopen a document window. Linux/Windows should exit when no document windows
/// remain, matching normal desktop and CLI-launched app behavior.
pub fn decide_exit_request_action(
    exit_allowed: bool,
    has_document_windows: bool,
    keep_alive_without_documents: bool,
) -> ExitRequestAction {
    if exit_allowed {
        return ExitRequestAction::AllowExit;
    }
    if has_document_windows {
        return ExitRequestAction::PreventAndStartQuit;
    }
    if keep_alive_without_documents {
        ExitRequestAction::PreventAndKeepAlive
    } else {
        ExitRequestAction::AllowExit
    }
}

pub fn keep_alive_without_document_windows() -> bool {
    cfg!(target_os = "macos")
}

/// Return `true` when the app is ready to terminate (set just before `app.exit(0)`).
pub fn is_exit_allowed() -> bool {
    EXIT_ALLOWED.load(Ordering::SeqCst)
}

fn set_exit_allowed(allowed: bool) {
    EXIT_ALLOWED.store(allowed, Ordering::SeqCst);
}

fn set_quit_targets(targets: HashSet<String>) {
    let mut guard = QUIT_TARGETS.lock().unwrap_or_else(|p| p.into_inner());
    *guard = targets;
}

fn remove_quit_target(label: &str) -> bool {
    let mut guard = QUIT_TARGETS.lock().unwrap_or_else(|p| p.into_inner());
    guard.remove(label);
    guard.is_empty()
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
    let mut guard = FIRST_QUIT_PRESS.lock().unwrap_or_else(|p| p.into_inner());
    *guard = None;
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
            if let Some(window) = app
                .webview_windows()
                .values()
                .find(|w| w.is_focused().unwrap_or(false))
            {
                if let Err(e) = window.emit("app:quit-first-press", ()) {
                    log::error!("[quit] Failed to emit quit-first-press: {}", e);
                }
            }
        }
    }
}

/// Kill child-process subsystems (MCP sidecar, content servers, PTYs) that
/// would otherwise outlive the app: exit goes through `std::process::exit`,
/// which never runs `Drop` for Tauri-managed state. Single source of truth
/// for the sequence — called from `finalize_quit` and from app_setup.rs's
/// `ExitRequested` → `AllowExit` branch so the two paths cannot drift.
pub(crate) fn shutdown_child_process_subsystems(app: &AppHandle) {
    mcp_server::cleanup(app);
    crate::content_server::cleanup(app);
    crate::pty::kill_all(app);
}

/// Final quit: allow exit, clean up child-process subsystems, and terminate
/// the process.
fn finalize_quit(app: &AppHandle) {
    set_exit_allowed(true);
    shutdown_child_process_subsystems(app);
    app.exit(0);
}

/// Start coordinated quit: request close of all document windows.
pub fn start_quit(app: &AppHandle) {
    if QUIT_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }
    set_exit_allowed(false);

    let mut targets = HashSet::new();
    let mut document_windows = Vec::new();
    for (label, window) in app.webview_windows() {
        if is_document_window_label(&label) {
            targets.insert(label.clone());
            document_windows.push((label, window));
        } else {
            // Close non-document windows immediately
            let _ = window.close();
        }
    }

    if targets.is_empty() {
        finalize_quit(app);
        return;
    }

    // Register the full target set BEFORE emitting close requests — a window
    // replying before registration completed would race the quit bookkeeping
    // (safe today only by accident of the single-threaded event loop;
    // audit 20260612).
    set_quit_targets(targets);

    for (label, window) in document_windows {
        if let Err(e) = window.emit("app:quit-requested", &label) {
            abort_quit_on_emit_failure(&label, e);
            return;
        }
    }
}

/// Abort a coordinated quit because a window never received
/// `app:quit-requested`: that window would stay in `QUIT_TARGETS` forever and
/// `QUIT_IN_PROGRESS` would swallow every retry — the quit would be
/// permanently stuck. Cancelling resets all quit state so the user can retry
/// (safest for unsaved data: no window is force-closed).
fn abort_quit_on_emit_failure(label: &str, err: impl std::fmt::Display) {
    log::error!(
        "[quit] Failed to emit app:quit-requested to '{label}': {err} — cancelling coordinated quit"
    );
    cancel_quit();
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
    log::debug!(
        "[Tauri] handle_window_destroyed: label={}, quit_in_progress={}",
        label,
        quit_in_progress
    );

    if !quit_in_progress {
        return;
    }

    if !is_document_window_label(label) {
        return;
    }

    if remove_quit_target(label) {
        log::debug!("[Tauri] handle_window_destroyed: all targets done, calling app.exit(0)");
        finalize_quit(app);
    }
}

#[cfg(test)]
#[path = "quit.test.rs"]
mod tests;
