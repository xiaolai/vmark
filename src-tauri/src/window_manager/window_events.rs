//! # Window lifecycle events
//!
//! Purpose: what happens to a window when the OS acts on it — a close the
//! frontend must confirm, and the native resources that have to die with the
//! window rather than with the webview inside it.
//!
//! Split out of `app_setup.rs`, which is for setting the app UP; a handler that
//! runs for the whole life of every window was only ever there because that is
//! where it was first written.
//!
//! @coordinates-with lib.rs — registers this as the `on_window_event` handler
//! @coordinates-with close_to_tray/mod.rs — may park the last window instead of closing it
//! @module window_manager/window_events

#[cfg(test)]
#[path = "window_events.test.rs"]
mod tests;

/// Whether a window's close is routed through the frontend (and, on Windows,
/// the close-to-tray decision).
///
/// Delegates to the ONE definition of a document window. This handler used to
/// carry its own copy of that rule; quit waits on exactly the windows
/// `is_document_window_label` names, so the two must never be able to differ.
fn intercepts_close(label: &str) -> bool {
    crate::quit::is_document_window_label(label)
}

/// Intercept close requests for document windows so the frontend can run its
/// save/confirm flow — or, on Windows with close-to-tray on, park the last one
/// in the tray. Non-document windows (settings) close normally.
pub(crate) fn handle_document_window_close_event(
    window: &tauri::Window,
    event: &tauri::WindowEvent,
) {
    use tauri::{Emitter, Manager};

    // Put the macOS window controls back if AppKit re-laid the title bar out.
    #[cfg(target_os = "macos")]
    crate::window_manager::repair_traffic_lights_on_event(window, event);

    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let label = window.label();
        // INFO, not debug (#1253). `prevent_close` below hands the outcome to
        // the frontend with no timeout and no fallback, so when a close stalls
        // the only way to tell "Rust never saw the click" from "the frontend
        // never finished" is a line here — and release builds filter `debug!`,
        // which is why the first report of a stuck window arrived with a log
        // that said nothing at all.
        log::info!("[Tauri] WindowEvent::CloseRequested for window '{}'", label);
        // Only intercept close for document windows
        if intercepts_close(label) {
            api.prevent_close();
            if crate::close_to_tray::hides_to_tray(window) {
                // #1419: the last window parks in the tray instead of quitting.
                // Nothing is torn down, so there is no save flow to run. Never
                // true off Windows, and never true during a quit.
                let _ = window.hide();
                log::info!("[Tauri] close-to-tray: hid '{}' instead of closing", label);
            } else {
                // Include target label in payload so frontend can filter
                let _ = window.emit("window:close-requested", label);
                log::info!("[Tauri] Emitted window:close-requested to '{}'", label);
            }
        }
        // Settings and other non-document windows close normally
    }

    // The window is actually gone: tear down any embedded browser it owned (WI-S0.4).
    //
    // BrowserSurface normally sends `browser_destroy` from a React unmount cleanup, but
    // that cleanup runs in the very webview being destroyed — the IPC races its own
    // teardown and may never arrive. The native WKWebViews would then outlive the window
    // that owned them: orphaned content processes still holding the page, with nothing
    // left that could reach them. The native side does not have that problem, so it does
    // the job here.
    if let tauri::WindowEvent::Destroyed = event {
        let app = window.app_handle().clone();
        crate::browser::teardown::destroy_window(&app, window.label());

        // Trusted-HTML grants owned by this window die with it (#1273). Same
        // reasoning as the browser teardown above: the frontend's own cleanup
        // races the webview it runs in, so the native side does it. Scoped to
        // this label — a process-global sweep here would revoke every other
        // window's trusted previews.
        if let Some(trusted) = app.try_state::<crate::trusted_html::TrustedHtmlState>() {
            let revoked = trusted.revoke_window(window.label());
            if revoked > 0 {
                log::info!(
                    "[Tauri] revoked {} trusted-HTML grant(s) for window '{}'",
                    revoked,
                    window.label()
                );
            }
        }
    }
}
