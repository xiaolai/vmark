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
//!   - The routing and the surfacing are generic over the Tauri runtime and
//!     take the forwarder as a parameter (`second_launch_with`), so
//!     `single_instance.test.rs` drives them on a mock app (#246): a launch
//!     with a file must forward exactly that file and open nothing, a bare
//!     launch must reveal an existing window or build one.
//!
//! Linux runs the guard only when `DBUS_SESSION_BUS_ADDRESS` names an address
//! the plugin's bus library can PARSE (WI-FL6.1). The plugin's Linux backend
//! opens with `zbus::blocking::connection::Builder::session().unwrap()`, and
//! that call is `Address::from_str` over the raw environment value — so a
//! malformed address panics VMark at startup, before the log plugin exists to
//! say why, which is the worst kind of "won't start at all". A failed
//! CONNECTION is not that: it reaches the plugin's `_ => {}` arm and is
//! discarded, leaving the app running and unguarded. `session_bus.rs` holds
//! the rules and the evidence; because the question is a parse, answering it
//! costs no I/O on the startup path. `lib.rs` consults `session_bus_present()`
//! before registering, and `app_setup` logs a warning when the guard was
//! skipped, so a second launch opening a second VMark is at least explained.
//! The Windows backend has no such dependency (a named mutex plus
//! `WM_COPYDATA`), which is where #1330 was actually reported.
//!
//! @coordinates-with file_open.rs — `route_file_opens`, the shared destination
//! @coordinates-with session_bus.rs — the Linux gate's rules and probes
//! @coordinates-with app_setup.rs — handles the FIRST launch's argv, logs the skipped guard
//! @coordinates-with lib.rs — registers the plugin only when `session_bus_present()`

// Compiled on macOS too, deliberately: the plugin is registered only off
// macOS, but gating the module out would take its unit tests with it — and
// macOS is the platform this project develops and runs `cargo test` on.
#![cfg_attr(target_os = "macos", allow(dead_code))]

use tauri::{Manager, Runtime};

use crate::{file_open, quit, supported_files, window_manager};

/// Linux: is there a session bus for the plugin to connect to? The rules
/// live in `session_bus.rs`.
#[cfg(target_os = "linux")]
pub(crate) fn session_bus_present() -> bool {
    // One line on purpose: `scripts/check-feature-ledger-phase.sh 6` looks for
    // this read here (WI-FL6.1), and rustfmt wraps the argument form.
    let address = std::env::var_os("DBUS_SESSION_BUS_ADDRESS");
    crate::session_bus::should_register_single_instance(address)
}

/// Say so in the log when the guard was skipped. Called from `app_setup`
/// rather than from `lib.rs`, because the plugin decision is made before the
/// log plugin is registered and a warning emitted there goes nowhere.
///
/// It reports the decision this gate made, which is not quite the same as "the
/// guard is running": an address that parses but names a dead socket is
/// registered here and then fails to connect inside the plugin, silently. That
/// is the plugin's own `_ => {}`, and nothing this side can observe.
#[cfg(target_os = "linux")]
pub(crate) fn warn_if_unguarded() {
    if !session_bus_present() {
        log::warn!(
            "[SingleInstance] DBUS_SESSION_BUS_ADDRESS is not set, or does not name a local \
             session-bus socket this build's bus library can parse: running without the \
             single-instance guard, so a second launch starts a second VMark sharing this \
             one's session (#1330)"
        );
    }
}

/// Handle a second launch: route any openable files in `argv` to this
/// instance, and surface a window either way.
///
/// Dispatched OFF the callback thread (audit #476). The plugin documents this
/// callback as running on the main event loop, and the decision it makes needs
/// the filesystem: `openable_files_from_argv` STATS every argument
/// (`is_openable_supported` → `is_file()`). A UNC path to an unreachable host,
/// a disconnected network mount or a spun-down disk blocks that stat for
/// seconds, and the running app — the one the user is actually looking at — is
/// frozen for all of it, on account of a second launch it did not ask for.
///
/// Nothing here has to finish before the callback returns: the second process
/// exits regardless of what this instance does with its argv. Window creation
/// is safe from a worker — Tauri's builder posts to the event loop, which is
/// the same reason a window-creating command must be `async` (`window_manager/
/// mod.rs`).
pub(crate) fn handle_second_launch(app: &tauri::AppHandle, argv: Vec<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        second_launch_with(&app, argv, file_open::route_file_opens);
    });
}

/// The second-launch decision, with the forwarder injected (#246): a launch
/// that carries openable files hands EXACTLY those files to `forward` and
/// touches no window itself — `route_file_opens` focuses the window it
/// delivers to — while a bare launch surfaces a window and forwards nothing.
///
/// `argv[0]` is the program path, exactly as `std::env::args()` yields it, so
/// it is skipped for the same reason `app_setup` skips it.
pub(crate) fn second_launch_with<R: Runtime>(
    app: &tauri::AppHandle<R>,
    argv: Vec<String>,
    forward: impl FnOnce(&tauri::AppHandle<R>, Vec<String>),
) {
    let files = openable_files_from_argv(argv);
    log::info!(
        "[SingleInstance] second launch with {} file(s)",
        files.len()
    );

    if files.is_empty() {
        surface_a_window(app);
        return;
    }
    forward(app, files);
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
/// Split into a SELECTION and an idempotent reveal (#477): the two answer
/// different questions, and the second one has to be total. A second launch
/// that surfaces nothing looks to the user exactly like a launch that was
/// ignored, which is the bug this whole module exists to prevent.
pub(crate) fn surface_a_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    match choose_target(app) {
        Some(label) => reveal_or_retry(app, &label),
        None => create_and_reveal_main(app),
    }
}

/// The window a second launch should surface, or `None` when none is left.
///
/// Chosen by `finder_window_target` rather than by taking whatever
/// `webview_windows()` yields first: that is a `HashMap`, so "first" differs
/// between runs, and the last-focused window is what the user means. The
/// fallback is any live document window — `finder_window_target` only returns
/// listener-READY ones, and a window still booting is a better answer than
/// building a second one beside it.
fn choose_target<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let live_labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    let ready = {
        let state = file_open::FILE_OPEN_STATE
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        state.finder_window_target(&live_labels)
    };
    ready.or_else(|| {
        live_labels
            .iter()
            .filter(|label| quit::is_document_window_label(label))
            .min()
            .cloned()
    })
}

/// Reveal `label`; if it closed between the snapshot and this lookup, choose
/// again and, failing that, build a window (#479).
///
/// The old code returned silently here. The window list is a snapshot taken
/// under no lock, so the user closing the chosen window in that instant made
/// the second launch do nothing at all — indistinguishable, from the outside,
/// from a launch that was swallowed. One retry, then a create: the selection
/// can only lose a window, so this cannot loop.
pub(crate) fn reveal_or_retry<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        window_manager::reveal_window(&window, label);
        return;
    }
    log::info!("[SingleInstance] {label:?} closed while it was being chosen — choosing again");
    match choose_target(app).and_then(|next| app.get_webview_window(&next).map(|w| (next, w))) {
        Some((next, window)) => window_manager::reveal_window(&window, &next),
        None => create_and_reveal_main(app),
    }
}

/// Build the main window — and, when another path built it first, surface
/// THAT one (#478).
///
/// Creation is check-then-create against every other window-creating path in
/// the process, so losing the race is a real outcome and not an error: the
/// user asked for a window and there is one. Reporting
/// `WindowLabelAlreadyExists` to the log and stopping left the second launch
/// with nothing on screen, which is the same failure #479 describes one step
/// further on. The same idempotent-creation rule the Settings window follows
/// (`AGENTS.md`, the window-thread gate).
pub(crate) fn create_and_reveal_main<R: Runtime>(app: &tauri::AppHandle<R>) {
    log::info!("[SingleInstance] no document window left — creating one");
    let Err(error) = window_manager::create_main_window(app, None) else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        log::info!("[SingleInstance] another path created the main window first — surfacing it");
        window_manager::reveal_window(&window, "main");
        return;
    }
    log::error!("[SingleInstance] failed to create main window: {error}");
}

#[cfg(test)]
#[path = "single_instance.test.rs"]
mod tests;
