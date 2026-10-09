//! # Coordinated Quit
//!
//! Purpose: Manages graceful application shutdown with unsaved-changes prompts
//! and an optional double-press confirmation gate (Cmd+Q twice to quit).
//!
//! Pipeline: Cmd+Q → `request_quit` → confirm gate → `start_quit` → ask each
//! document window to quit (`quit_broadcast.rs`: now if it is listening, when
//! it is ready otherwise) → windows close one by one →
//! `handle_window_destroyed` → when all targets gone → `finalize_quit` → `app.exit(0)`.
//! Save All and Quit (menu, or `save_all_and_quit` from the palette) →
//! `start_save_all_quit` → the same pipeline, with every window told to save
//! everything instead of asking.
//!
//! Key decisions:
//!   - Save All and Quit is a MODE of this quit, not a frontend save followed
//!     by an exit: each window's stores are its own, so only each window can
//!     save its documents. A window that cannot save answers `cancel_quit` and
//!     stays open, so the app never quits over a failed save.
//!   - EXIT_ALLOWED is only set to true immediately before `app.exit(0)` to prevent
//!     premature exit during the coordinated quit flow.
//!   - The confirm-quit gate uses wall-clock timing (Instant) so it works even when
//!     the event loop is busy.
//!   - `cancel_quit` clears all state including the first-press timestamp to prevent
//!     stale timestamps from acting as a second press after cancellation.
//!   - A quit in progress swallows a repeated request only for a bounded time,
//!     so a quit that stalls can be asked again (`quit_broadcast.rs`).
//!
//! Known limitations:
//!   - Tests mutate shared statics and must run serially (guarded by TEST_LOCK).

use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::mcp_bridge;

#[path = "quit_broadcast.rs"]
mod broadcast;
use broadcast::{abort_quit_on_emit_failure, claim_quit_attempt, QuitAttempt, QuitMode};

#[path = "quit_feedback.rs"]
mod feedback;

#[path = "quit_exit_request.rs"]
mod exit_request;
pub use exit_request::{
    decide_exit_request_action, keep_alive_without_document_windows, ExitRequestAction,
};

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

/// Whether a coordinated quit is under way.
///
/// Read by the close-to-tray decision (#1419), which must never turn one of
/// quit's window closes into a hide — that would leave the quit waiting forever
/// for a window that never goes away.
pub(crate) fn is_quit_in_progress() -> bool {
    QUIT_IN_PROGRESS.load(Ordering::SeqCst)
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
            feedback::emit_first_press_feedback(app);
        }
    }
}

/// Kill child-process subsystems (MCP sidecar, content servers, PTYs) that
/// would otherwise outlive the app: exit goes through `std::process::exit`,
/// which never runs `Drop` for Tauri-managed state. Single source of truth
/// for the sequence — called from `finalize_quit` and from app_setup.rs's
/// `ExitRequested` → `AllowExit` branch so the two paths cannot drift.
pub(crate) fn shutdown_child_process_subsystems(app: &AppHandle) {
    mcp_bridge::control::cleanup(app);
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

/// Start coordinated quit: request close of all document windows, each of
/// which asks about its unsaved documents.
pub fn start_quit(app: &AppHandle) {
    start_quit_in(app, QuitMode::Prompt);
}

/// Save All and Quit: the coordinated quit in which every document window
/// saves its unsaved documents without asking, then closes. A window that
/// cannot save cancels the quit and stays open. No confirm gate: the command
/// is its own confirmation.
pub fn start_save_all_quit(app: &AppHandle) {
    start_quit_in(app, QuitMode::SaveAll);
}

/// Save All and Quit from the frontend (the command palette); the menu item
/// starts it in Rust.
#[tauri::command]
pub fn save_all_and_quit(app: AppHandle) {
    start_save_all_quit(&app);
}

/// Request close of all document windows in `mode`. A request arriving while
/// a quit is under way is a duplicate, until that quit has gone unfinished
/// long enough to be asked again (`quit_broadcast.rs`).
fn start_quit_in(app: &AppHandle, mode: QuitMode) {
    let mode = match claim_quit_attempt(Instant::now(), mode) {
        QuitAttempt::AlreadyRunning => return,
        QuitAttempt::Retry(mode) => {
            log::warn!("[quit] a quit is under way — asking every window again ({mode:?})");
            mode
        }
        QuitAttempt::Fresh(mode) => mode,
    };
    set_exit_allowed(false);

    // A window parked in the tray (#1419) is about to be asked to run its save
    // flow. An unsaved-changes prompt from a HIDDEN window is one nobody can
    // answer, and the quit would wait on it forever — so every quit path (tray
    // menu, OS shutdown, anything) brings them back first. Windows-only because
    // only Windows can park a window; macOS quit is untouched.
    #[cfg(target_os = "windows")]
    crate::close_to_tray::restore_hidden_windows(app);

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
    // (safe today only by accident of the single-threaded event loop).
    set_quit_targets(targets);

    if let Err((label, e)) = broadcast::request_quit_of(&document_windows, mode) {
        abort_quit_on_emit_failure(&label, e);
    }
}

/// Cancel an in-progress quit (e.g., user cancelled save prompt).
#[tauri::command]
pub fn cancel_quit() {
    QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
    broadcast::forget_quit_attempt();
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
