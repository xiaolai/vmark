//! Linux: follow GTK's `window-state-event` for each window Toggle Full
//! Screen acts on, so a pending request is retired when the window manager
//! actually applies it (#1715). A child of `menu/events/fullscreen.rs`; the
//! decision itself is the pure `fullscreen_pending.rs`.
//!
//! A resize is not a confirmation: unrelated resizes happen mid-transition,
//! and a fullscreen change need not resize at all. The state event reports
//! the FULLSCREEN bit itself.

use std::collections::HashSet;
use std::sync::Mutex;

use gtk::prelude::WidgetExt;

/// Labels whose current native window already carries the handler.
static WATCHED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn watched() -> std::sync::MutexGuard<'static, Option<HashSet<String>>> {
    WATCHED.lock().unwrap_or_else(|p| p.into_inner())
}

/// Connect the state handler to `window` once per native window.
pub(super) fn ensure_watched(window: &tauri::WebviewWindow) {
    let label = window.label().to_string();
    if !watched()
        .get_or_insert_with(HashSet::new)
        .insert(label.clone())
    {
        return;
    }
    let Ok(gtk_window) = window.gtk_window() else {
        if let Some(set) = watched().as_mut() {
            set.remove(&label);
        }
        return;
    };
    let tauri_window = window.clone();
    gtk_window.connect_window_state_event(move |_, event| {
        if event
            .changed_mask()
            .contains(gtk::gdk::WindowState::FULLSCREEN)
        {
            let realized = event
                .new_window_state()
                .contains(gtk::gdk::WindowState::FULLSCREEN);
            // Decide under the lock, request outside it.
            let request = super::pending().as_mut().and_then(|map| {
                super::apply_observed(map, &label, realized, std::time::Instant::now())
            });
            if let Some(next) = request {
                if let Err(e) = tauri_window.set_fullscreen(next) {
                    log::warn!("[menu_events] Failed to continue fullscreen for {label:?}: {e}");
                    if let Some(map) = super::pending().as_mut() {
                        map.remove(&label);
                    }
                }
            }
        }
        gtk::glib::Propagation::Proceed
    });
}

/// The window behind `label` was destroyed; its handler went with it.
pub(super) fn forget(label: &str) {
    if let Some(set) = watched().as_mut() {
        set.remove(label);
    }
}
