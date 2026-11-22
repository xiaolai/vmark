//! Toggle Full Screen for the Windows/Linux View menu (#1715).
//!
//! Purpose: handles the `toggle-fullscreen` menu id. macOS never reaches this
//! module — its View menu keeps muda's predefined fullscreen item, which
//! AppKit handles natively. muda builds no item for that predefined kind on
//! Windows or GTK, so those platforms get a real item whose click lands here.
//!
//! Key decisions:
//!   - Handled in Rust: fullscreen is a window operation, not a document one,
//!     so there is no frontend round-trip and no listener to keep in sync.
//!   - Target: the focused window, else the window that last held native
//!     focus, else the only document window. Never a guess among several: a
//!     Windows menu click can briefly clear focus, and preferring `main` there
//!     would toggle a window the user was not looking at. Focus is tracked
//!     here from the raw `Focused` event — the Finder hot-open history only
//!     records windows whose frontend listeners are ready, which a window
//!     opened a moment ago may not be.
//!   - Linux reads the realized GDK window state. tao's Linux `fullscreen()`
//!     (behind `is_fullscreen`) returns the last state VMark REQUESTED, so a
//!     window-manager-initiated change would leave the next toggle asking for
//!     the state the window already has.
//!   - Linux only: requests are serialized per window — one in flight, plus
//!     the latest state the user asked for — and advanced by GTK's
//!     `window-state-event` (`fullscreen_pending.rs`, `fullscreen_gtk.rs`),
//!     so a burst of F11 presses lands on what the user last asked for.
//!     Windows applies a request synchronously, so it reads the state and
//!     keeps no pending record.
//!   - Records are keyed by label and dropped when the window is destroyed,
//!     so a later window reusing the label (`main`) starts clean.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::quit::is_document_window_label;

/// The window that last gained native focus (any window, ready or not).
static LAST_FOCUSED: Mutex<Option<String>> = Mutex::new(None);

#[cfg(any(target_os = "linux", test))]
#[path = "fullscreen_pending.rs"]
mod pending_req;
#[cfg(any(target_os = "linux", test))]
use pending_req::{apply_observed, apply_press, pending};
#[cfg(test)]
use pending_req::{on_press, PENDING_WINDOW};

#[cfg(target_os = "linux")]
#[path = "fullscreen_gtk.rs"]
mod gtk_watch;

/// Record a native focus change. Losing focus keeps the record: a Windows
/// menu click is exactly the moment focus has just been lost.
pub(crate) fn note_window_focus(label: &str, focused: bool) {
    if focused {
        *LAST_FOCUSED.lock().unwrap_or_else(|p| p.into_inner()) = Some(label.to_string());
    }
}

/// Drop a destroyed window's focus and pending-request records.
pub(crate) fn forget_window(label: &str) {
    let mut last = LAST_FOCUSED.lock().unwrap_or_else(|p| p.into_inner());
    if last.as_deref() == Some(label) {
        *last = None;
    }
    drop(last);
    #[cfg(any(target_os = "linux", test))]
    if let Some(map) = pending().as_mut() {
        map.remove(label);
    }
    #[cfg(target_os = "linux")]
    gtk_watch::forget(label);
}

/// Pick the window a Toggle Full Screen click applies to.
///
/// `focused` is the focused window's label (any window — Settings included);
/// `last_focused` the window that last gained native focus; `live` every open
/// window; `documents` the open document windows.
pub(super) fn pick_fullscreen_target<'a>(
    focused: Option<&'a str>,
    last_focused: Option<&'a str>,
    live: &[&'a str],
    documents: &[&'a str],
) -> Option<&'a str> {
    if focused.is_some() {
        return focused;
    }
    if let Some(last) = last_focused {
        if live.contains(&last) {
            return Some(last);
        }
    }
    match documents {
        [only] => Some(only),
        _ => None,
    }
}

/// The two window operations a toggle needs, so the toggle itself is
/// testable without a native window.
pub(super) trait FullscreenWindow {
    fn is_fullscreen_now(&self) -> tauri::Result<bool>;
    fn set_fullscreen(&self, fullscreen: bool) -> tauri::Result<()>;
}

impl FullscreenWindow for tauri::WebviewWindow {
    #[cfg(target_os = "linux")]
    fn is_fullscreen_now(&self) -> tauri::Result<bool> {
        use gtk::prelude::WidgetExt;
        match self.gtk_window()?.window() {
            Some(realized) => Ok(realized.state().contains(gtk::gdk::WindowState::FULLSCREEN)),
            // Not realized yet: nothing has been applied, so the requested
            // state is the only state there is.
            None => self.is_fullscreen(),
        }
    }

    #[cfg(not(target_os = "linux"))]
    fn is_fullscreen_now(&self) -> tauri::Result<bool> {
        self.is_fullscreen()
    }

    fn set_fullscreen(&self, fullscreen: bool) -> tauri::Result<()> {
        tauri::WebviewWindow::set_fullscreen(self, fullscreen)
    }
}

/// Flip a window whose state is synchronous (Windows); returns the state
/// requested.
pub(super) fn toggle_fullscreen(window: &impl FullscreenWindow) -> tauri::Result<bool> {
    let next = !window.is_fullscreen_now()?;
    window.set_fullscreen(next)?;
    Ok(next)
}

/// Linux: a press goes through the window's pending slot; a request is sent
/// only when none is in flight.
#[cfg(target_os = "linux")]
fn press_fullscreen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    gtk_watch::ensure_watched(window);
    let label = window.label();
    let realized = window.is_fullscreen_now()?;
    let request = apply_press(
        pending().get_or_insert_with(std::collections::HashMap::new),
        label,
        realized,
        std::time::Instant::now(),
    );
    if let Some(next) = request {
        if let Err(e) = window.set_fullscreen(next) {
            if let Some(map) = pending().as_mut() {
                map.remove(label);
            }
            return Err(e);
        }
    }
    Ok(())
}

/// Menu handler for `toggle-fullscreen`.
pub(super) fn handle_toggle_fullscreen(app: &AppHandle) {
    let windows = app.webview_windows();
    let focused = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .map(|w| w.label().to_string());
    let last_focused = LAST_FOCUSED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    let live: Vec<&str> = windows.keys().map(String::as_str).collect();
    let mut documents: Vec<&str> = live
        .iter()
        .copied()
        .filter(|label| is_document_window_label(label))
        .collect();
    documents.sort_unstable();

    let Some(label) = pick_fullscreen_target(
        focused.as_deref(),
        last_focused.as_deref(),
        &live,
        &documents,
    ) else {
        log::debug!("[menu_events] toggle-fullscreen: no unambiguous target window");
        return;
    };
    let Some(window) = windows.get(label) else {
        return;
    };

    #[cfg(target_os = "linux")]
    let result = press_fullscreen(window);
    #[cfg(not(target_os = "linux"))]
    let result = toggle_fullscreen(window).map(|_| ());
    if let Err(e) = result {
        log::warn!("[menu_events] Failed to toggle fullscreen for {label:?}: {e}");
    }
}

#[cfg(test)]
#[path = "fullscreen.test.rs"]
mod tests;
