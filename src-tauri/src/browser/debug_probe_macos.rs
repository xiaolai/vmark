//! Debug-only introspection of the native browser layer (macOS).
//!
//! Split from `surface_macos.rs` to keep it under the 300-line gate, and because
//! it is a genuinely separate concern: everything else in that file exists to
//! DRIVE the native surface, while this only observes it.
//!
//! WHY IT EXISTS AT ALL. The `WKWebView` is a sibling native view, so it appears
//! in no DOM snapshot. An E2E teardown assertion can therefore only watch the
//! React surface element — which proves React unmounted and says nothing about
//! whether the native view is still alive, still loading, still holding a session.
//! That is a false oracle for the one invariant that matters on close (matrix
//! B11), and it is only observable from inside the app.
//!
//! Compiled out of release builds: it enumerates internal state and has no product
//! use, so it should not exist where it cannot be needed.
//!
//! @coordinates-with e2e/lib/browser.mjs — `nativeBrowserTabIds`, the only consumer

use tauri::AppHandle;

/// Tab ids that currently hold a LIVE native webview, sorted for stable diffing.
pub fn debug_native_tab_ids(app: &AppHandle) -> Result<Vec<String>, String> {
    super::on_main(app, move |_mtm| {
        Ok(super::WEBVIEWS.with(|m| {
            let mut ids: Vec<String> = m.borrow().keys().cloned().collect();
            ids.sort();
            ids
        }))
    })
}
