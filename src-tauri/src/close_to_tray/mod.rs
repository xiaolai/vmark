//! # Close to tray (Windows, #1419)
//!
//! Purpose: on Windows, an opt-in setting makes the close button on the LAST
//! document window park VMark in the system tray instead of quitting it.
//!
//! ## The decision
//!
//! Only the **last** document window hides. Closing any other window still
//! closes it, so a multi-window user sees no change until the final one — the
//! only close that used to quit the app. "The close button never quits" is the
//! whole feature, and hiding every window would instead pile up invisible ones.
//!
//! Hiding is safe for unsaved work because nothing is torn down: the window,
//! its webview and its documents all stay alive, so there is no save prompt to
//! run and nothing to lose.
//!
//! ## What must never happen
//!
//! **A quit turned into a hide.** Quit closes every document window and waits
//! for the last one to go; if that close became a hide, the quit would wait
//! forever. Today the quit path cannot reach this decision at all — the
//! frontend's final close uses `destroy()`, which bypasses `CloseRequested` —
//! but that safety rests on a choice made in another language that nothing
//! enforces. So the decision checks `quit::is_quit_in_progress` explicitly, and
//! a test pins it.
//!
//! ## Platform gating
//!
//! The tray itself needs tauri's `tray-icon` feature, enabled for Windows only
//! in `Cargo.toml`, so `tray.rs` is `cfg(windows)`. Everything else compiles on
//! every platform on purpose: the decision is plain logic, and the macOS/Linux
//! test binaries are the ones that run on every local change. Off Windows the
//! feature is never *effective* (`effective_enabled`), so macOS behaviour is
//! unchanged by construction rather than by care.
//!
//! The setting lives in the webview (localStorage), so the webview PUSHES it —
//! the same shape as `set_confirm_quit`. The state starts disabled: a push
//! that has not landed yet, or failed, leaves the app on the old behaviour.
//!
//! @coordinates-with window_manager/window_events.rs — consults `hides_to_tray` on close
//! @coordinates-with quit.rs — `is_quit_in_progress`, and restores hidden windows before quitting
//! @coordinates-with src/hooks/useCloseToTraySync.ts — pushes the setting
//! @module close_to_tray

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, State};

use crate::command_error::CommandError;

#[cfg(target_os = "windows")]
mod tray;
#[cfg(target_os = "windows")]
pub(crate) use tray::restore_hidden_windows;

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;

/// The user's close-to-tray preference, as last pushed by the webview.
#[derive(Default)]
pub struct CloseToTrayState {
    enabled: AtomicBool,
}

impl CloseToTrayState {
    /// Whether the webview has turned the preference on.
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Record the preference. Idempotent — the webview pushes on mount AND on
    /// every change, so a repeat is normal.
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }
}

/// What a document window's close button should do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloseAction {
    /// Hand the close to the frontend's save/confirm flow, as always.
    Close,
    /// Keep the window alive and hide it; the tray brings it back.
    HideToTray,
}

/// Pure decision, separated from the window so it can be tested exhaustively.
///
/// `document_windows` counts EVERY document window including the one being
/// closed, visible or not — so a window already parked in the tray keeps the
/// count above one, and closing the other window closes it normally. At most
/// one window is ever parked, and it is the thing keeping the app alive.
pub(crate) fn decide_close_action(
    enabled: bool,
    document_windows: usize,
    quit_in_progress: bool,
) -> CloseAction {
    if quit_in_progress || !enabled {
        return CloseAction::Close;
    }
    // Zero means the closing window was not counted: a caller bug. Closing is
    // the conservative answer — hiding a window we cannot account for would
    // strand it.
    if document_windows == 1 {
        CloseAction::HideToTray
    } else {
        CloseAction::Close
    }
}

/// The preference as it actually applies here: never effective off Windows,
/// whatever the webview pushed.
pub(crate) fn effective_enabled(state: &CloseToTrayState) -> bool {
    cfg!(target_os = "windows") && state.is_enabled()
}

/// Whether closing `window` should hide it rather than close it.
///
/// A missing state (it is always managed, but `try_state` is honest about the
/// possibility) reads as disabled — the conservative answer again.
pub(crate) fn hides_to_tray(window: &tauri::Window) -> bool {
    let enabled = window
        .try_state::<CloseToTrayState>()
        .map(|state| effective_enabled(&state))
        .unwrap_or(false);
    let document_windows = window
        .webview_windows()
        .keys()
        .filter(|label| crate::quit::is_document_window_label(label))
        .count();
    decide_close_action(
        enabled,
        document_windows,
        crate::quit::is_quit_in_progress(),
    ) == CloseAction::HideToTray
}

/// Push the close-to-tray preference from the webview.
///
/// `async` because on Windows it may build a tray icon, which creates a hidden
/// native window; the window-creation rule (`lint:window-thread`) requires
/// those off the WebView2 message callback. Off Windows it only records the
/// value, which is never read there.
#[tauri::command]
pub async fn set_close_to_tray(
    app: AppHandle,
    state: State<'_, CloseToTrayState>,
    enabled: bool,
) -> Result<(), CommandError> {
    state.set_enabled(enabled);
    #[cfg(target_os = "windows")]
    tray::apply(&app, enabled)?;
    #[cfg(not(target_os = "windows"))]
    let _ = &app;
    Ok(())
}
