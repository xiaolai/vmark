//! Window-destroy teardown for the embedded browser (WI-S0.4).
//!
//! `BrowserSurface` sends `browser_destroy` from a React unmount cleanup. That works
//! for closing a tab — but not for closing a WINDOW: the webview running that cleanup
//! is itself being torn down, so the IPC is racing its own destruction and may never
//! arrive. The native `WKWebView`s would then outlive the window that owned them:
//! orphaned content processes still holding the page, with no handle left to reach.
//!
//! So the native side takes responsibility. On `WindowEvent::Destroyed` we ask the
//! registry which tabs belonged to that window and tear each one down — the native
//! view, its delegate, any parked JS dialog, its one-shot authorizations, and its
//! registry entry.
//!
//! Authority is dropped too, and deliberately: a one-shot is bound to a tab, and a tab
//! whose window is gone can never be acted on again. Leaving the grant behind would be
//! authority with no way to observe what it authorized.
//!
//! @coordinates-with app_setup.rs — WindowEvent::Destroyed calls destroy_window
//! @coordinates-with browser/registry.rs — tabs_in_window / remove
//! @module browser/teardown

use tauri::{AppHandle, Manager};

use crate::browser::registry::BrowserRegistry;
use crate::browser::surface::{self, BrowserSurface};

/// Drop every registry entry belonging to `window_label`, returning the tab ids that
/// were dropped so the caller can tear down their native views.
///
/// Split out from `destroy_window` because it is the whole decision — which tabs die —
/// and it is the part that can actually be tested without a live AppKit window.
pub fn forget_window_tabs(registry: &mut BrowserRegistry, window_label: &str) -> Vec<String> {
    let tabs = registry.tabs_in_window(window_label);
    for tab_id in &tabs {
        registry.remove(tab_id);
    }
    tabs
}

/// Tear down every browser tab owned by `window_label`. Safe to call for a window that
/// never had one (the overwhelmingly common case) — it does nothing.
pub fn destroy_window(app: &AppHandle, window_label: &str) {
    let Some(state) = app.try_state::<BrowserSurface>() else {
        return; // the browser feature was never initialised in this process
    };

    // Take the tab list and drop the registry entries under one lock, so a concurrent
    // command cannot see a window that is half gone.
    let tabs = match state.registry.lock() {
        Ok(mut registry) => forget_window_tabs(&mut registry, window_label),
        Err(e) => {
            log::warn!("[browser] registry lock poisoned during window teardown: {e}");
            return;
        }
    };
    if tabs.is_empty() {
        return;
    }

    log::info!(
        "[browser] window '{window_label}' closed — tearing down {} browser tab(s)",
        tabs.len()
    );
    for tab_id in tabs {
        // Authority dies with the tab: a one-shot is bound to a tab that can never be
        // acted on again.
        state.clear_tab_one_shots(&tab_id);
        state.clear_tab_attachment(&tab_id);
        if let Ok(mut trackers) = state.crash_trackers.lock() {
            trackers.remove(&tab_id);
        }
        // Destroys the native view, detaches its delegate, and releases any page JS
        // blocked on a dialog. Failures are logged, not propagated: the window is going
        // away regardless, and there is no one left to report an error to.
        if let Err(e) = surface::destroy(app, tab_id.clone()) {
            log::warn!("[browser] destroying '{tab_id}' during window teardown failed: {e}");
        }
    }
}

#[cfg(test)]
#[path = "teardown.test.rs"]
mod tests;
