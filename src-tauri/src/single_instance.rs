//! Second-launch forwarding for Windows and Linux (#1330).
//!
//! Purpose: make an Explorer/desktop-launcher double-click reach the VMark that
//! is ALREADY running, instead of starting a second one.
//!
//! macOS never needs this — the OS keeps one process per bundle identifier and
//! delivers later opens to it as `RunEvent::Opened`. Windows and Linux have no
//! such rule: every double-click on an associated file starts a fresh `vmark`
//! process with the path in argv, which is why `app_setup::setup_app` reads
//! `std::env::args()` at all.
//!
//! Key decisions:
//!   - A SECOND PROCESS IS NOT MERELY REDUNDANT, IT IS DESTRUCTIVE. Its windows
//!     carry the same labels (`main`, `doc-N`) under the same bundle
//!     identifier, so its webview rehydrates the same `vmark-workspace:<label>`
//!     localStorage and its backend shares one app-data directory and hot-exit
//!     session with the process already running. Two processes then
//!     read-modify-write one session and the last writer wins — the reporter's
//!     symptom in #1330 was a window that showed their workspace tree and then
//!     lost it. `AGENTS.md` records the same hazard from the other direction:
//!     splitting the dev build's identifier was needed for exactly this reason.
//!   - Forwarding argv routes the open through `file_open::route_file_opens`,
//!     the SAME path macOS takes, rather than a second copy of the policy.
//!   - A launch carrying no openable file still surfaces a window. Swallowing
//!     it would make double-clicking the app icon look broken once a VMark is
//!     already running.
//!   - Window creation here is safe on the blocking path: the plugin delivers
//!     this callback on the main thread's event loop (Windows: a hidden
//!     message-only window's WndProc, created during `setup`), not inside a
//!     WebView2 `WebMessageReceived` callback — which is the reentrancy case
//!     `scripts/check-window-creation-thread.mjs` exists to catch.
//!   - The instance is keyed on `app.config().identifier` (the plugin's Windows
//!     mutex name and Linux DBus name), so `tauri dev` — which overrides the
//!     identifier to `app.vmark.dev` — is a SEPARATE instance from an installed
//!     release build. That falls out of the dev-profile split AGENTS.md already
//!     describes; it is not a second mechanism to keep in sync.
//!
//! Known Linux exposure, stated rather than discovered later: the plugin's
//! Linux backend builds its guard on the DBus SESSION bus and `.unwrap()`s that
//! connection, so a session with no `DBUS_SESSION_BUS_ADDRESS` panics VMark at
//! startup where it previously launched. In practice a Tauri app already needs
//! GTK + WebKitGTK and therefore a desktop session, which always carries a
//! session bus — but if a Linux "won't start at all" report ever arrives after
//! this, look here FIRST. The Windows backend has no such dependency (a named
//! mutex plus `WM_COPYDATA`), which is where #1330 was actually reported.
//!
//! @coordinates-with file_open.rs — `route_file_opens`, the shared destination
//! @coordinates-with app_setup.rs — handles the FIRST launch's argv

// Compiled on macOS too, deliberately: the plugin is registered only off
// macOS, but gating the module out would take its unit tests with it — and
// macOS is the platform this project develops and runs `cargo test` on.
#![cfg_attr(target_os = "macos", allow(dead_code))]

use tauri::Manager;

use crate::{file_open, quit, supported_files, window_manager};

/// Handle a second launch: route any openable files in `argv` to this
/// instance, and surface a window either way.
///
/// `argv[0]` is the program path, exactly as `std::env::args()` yields it, so
/// it is skipped for the same reason `app_setup` skips it.
pub(crate) fn handle_second_launch(app: &tauri::AppHandle, argv: Vec<String>) {
    let files = openable_files_from_argv(argv);
    log::info!(
        "[SingleInstance] second launch with {} file(s)",
        files.len()
    );

    if files.is_empty() {
        surface_a_window(app);
        return;
    }
    // route_file_opens focuses the window it delivers to, so no extra surfacing.
    file_open::route_file_opens(app, files);
}

/// The openable files a second launch is asking for.
///
/// `argv[0]` is dropped before the gate, not after: it is the program path,
/// and a build whose own name ends in a registered extension would otherwise
/// open the executable as a document.
pub(crate) fn openable_files_from_argv(argv: Vec<String>) -> Vec<String> {
    supported_files::filter_supported_args(argv.into_iter().skip(1))
}

/// Bring an existing document window forward, or create one when none is left.
///
/// The target is chosen by `finder_window_target` rather than by taking
/// whatever `webview_windows()` yields first: that is a `HashMap`, so "first"
/// differs between runs, and the last-focused window is what the user means.
fn surface_a_window(app: &tauri::AppHandle) {
    let live_labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    let target = {
        let state = file_open::FILE_OPEN_STATE
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        state.finder_window_target(&live_labels)
    };

    // Fall back to any live document window: `finder_window_target` only
    // returns listener-READY ones, and a window still booting is a better
    // answer than building a second one beside it.
    let label = target.or_else(|| {
        live_labels
            .iter()
            .filter(|label| quit::is_document_window_label(label))
            .min()
            .cloned()
    });

    let Some(label) = label else {
        log::info!("[SingleInstance] no document window left — creating one");
        if let Err(error) = window_manager::create_main_window(app, None) {
            log::error!("[SingleInstance] failed to create main window: {}", error);
        }
        return;
    };

    let Some(window) = app.get_webview_window(&label) else {
        return;
    };
    // show + unminimize before focus, so a hidden or minimized window is
    // actually revealed rather than silently focused off-screen.
    if let Err(error) = window.show() {
        log::warn!("[SingleInstance] show('{}') failed: {}", label, error);
    }
    if let Err(error) = window.unminimize() {
        log::warn!("[SingleInstance] unminimize('{}') failed: {}", label, error);
    }
    if let Err(error) = window.set_focus() {
        log::warn!("[SingleInstance] set_focus('{}') failed: {}", label, error);
    }
}

#[cfg(test)]
#[path = "single_instance.test.rs"]
mod tests;
