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
//! view, its delegate, any parked JS dialog, its one-shot authorizations, its
//! attachment, its crash budget, and its registry entry.
//!
//! Authority is dropped too, and deliberately: a one-shot is bound to a tab, and a tab
//! whose window is gone can never be acted on again. Leaving the grant behind would be
//! authority with no way to observe what it authorized. The window's standing grants
//! go the same way (audit 20260903 A-03): they were mirrored from THAT window's store,
//! which no longer exists to revoke them.
//!
//! Every tab's state goes under ONE registry guard (audit 20260903 round 4, #35), the
//! same way `BrowserSurface::forget_tab` does it for one tab. Removing the entries and
//! then clearing each tab's one-shots, attachment and crash tracker with the guard
//! released left a gap in which a `create` + `attach_tab` for a reused id could land
//! and have its fresh attachment erased by this cleanup. Only the NATIVE teardown runs
//! unlocked — it hops to the main thread, where WebKit callbacks take the registry
//! themselves.
//!
//! @coordinates-with app_setup.rs — WindowEvent::Destroyed calls destroy_window
//! @coordinates-with browser/registry.rs — tabs_in_window
//! @coordinates-with browser/surface.rs — `forget_tab_in`, the per-tab cleanup
//! @module browser/teardown

use std::collections::HashMap;

use tauri::{AppHandle, Manager};

use crate::browser::origin_guard::StandingGrant;
use crate::browser::surface::{self, BrowserSurface};

/// Forget every tab belonging to `window_label` — registry entry, crash budget,
/// one-shots, attachment — under ONE registry guard, returning the tab ids that were
/// dropped so the caller can tear down their native views.
///
/// Split out from `destroy_window` because it is the whole decision — which tabs
/// die, and that nothing of theirs survives — and it is the part that can actually
/// be tested without a live AppKit window.
pub fn forget_window(state: &BrowserSurface, window_label: &str) -> Result<Vec<String>, String> {
    let mut reg = state.registry.lock().map_err(|e| e.to_string())?;
    let tabs = reg.tabs_in_window(window_label);
    for tab_id in &tabs {
        state.forget_tab_in(&mut reg, tab_id)?;
    }
    Ok(tabs)
}

/// Drop the standing grants `window_label` synced. Returns whether there were any.
/// Other windows' slices are untouched — they were granted in stores that still exist.
pub fn forget_window_grants(
    grants: &mut HashMap<String, Vec<StandingGrant>>,
    window_label: &str,
) -> bool {
    grants.remove(window_label).is_some()
}

/// Tear down every browser tab owned by `window_label`, and the window's grants. Safe
/// to call for a window that never had either (the overwhelmingly common case) — it
/// does nothing.
pub fn destroy_window(app: &AppHandle, window_label: &str) {
    let Some(state) = app.try_state::<BrowserSurface>() else {
        return; // the browser feature was never initialised in this process
    };

    // Grants first, and independently of whether the window had tabs: a window can
    // have synced grants and closed every browser tab before it went away.
    match state.grants.lock() {
        Ok(mut grants) => {
            forget_window_grants(&mut grants, window_label);
        }
        Err(e) => log::warn!("[browser] grants lock poisoned during window teardown: {e}"),
    }

    // Every tab's state, under one guard: a concurrent command sees the window
    // whole or gone, never half torn down.
    let tabs = match forget_window(&state, window_label) {
        Ok(tabs) => tabs,
        Err(e) => {
            log::warn!("[browser] state lock poisoned during window teardown: {e}");
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
        // Destroys the native view, detaches its delegate, and releases any page JS
        // blocked on a dialog. Runs with no guard held (see the module doc). Failures
        // are logged, not propagated: the window is going away regardless, and there
        // is no one left to report an error to.
        if let Err(e) = surface::destroy(app, tab_id.clone()) {
            log::warn!("[browser] destroying '{tab_id}' during window teardown failed: {e}");
        }
    }
}

#[cfg(test)]
#[path = "teardown.test.rs"]
mod tests;
