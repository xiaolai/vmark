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
//! @module window_manager/window_events

/// Intercept close requests for document windows so the frontend can run its
/// save/confirm flow. Non-document windows (settings) close normally.
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
        if label == "main" || label.starts_with("doc-") {
            api.prevent_close();
            // Include target label in payload so frontend can filter
            let _ = window.emit("window:close-requested", label);
            log::info!("[Tauri] Emitted window:close-requested to '{}'", label);
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
