//! One-time app setup and app-level event dispatch.
//!
//! Purpose: Coordinates one-time setup and app-level lifecycle dispatch,
//! including Finder-target focus and destruction tracking, so `lib.rs` stays
//! a declarative composition root.
//!
//! Key decisions:
//!   - Window close is intercepted for document windows (main, doc-*) to allow
//!     dirty-document prompts; non-document windows close immediately.
//!   - A destroyed window's backend state is reaped on `Destroyed`, not left to
//!     the frontend: its webview dies without running its own teardown. That
//!     covers its file watcher, its PTY sessions and its MCP bridge workspace
//!     registration, all released by `window_destroyed`.
//!   - Recorded workspace grants (`workspace::grants`) are re-issued during
//!     setup. Tauri has already BUILT the configured `main` window by then, but
//!     its page load and every IPC request are served on the main thread setup
//!     is running on, so nothing can read before the grants are in. The wait is
//!     bounded, and roots resolve concurrently: only a root still resolving at
//!     the deadline (a stale mount) is granted late, and it is reported.
//!   - `machine_id_hash()` generates a stable anonymous device identifier via
//!     SHA-256(hostname + OS + arch), sent as `X-Machine-Id` header on update checks.

use sha2::{Digest, Sha256};
use tauri::{Listener, Manager};

use crate::peer_text::peer_message;
use crate::{menu, pty, quit};

/// Compute a stable, anonymous machine identifier hash.
///
/// Input: `"vmark-machine-id-v1:" + hostname + ":" + OS + ":" + ARCH`
/// Output: 64-char lowercase hex SHA-256 digest.
///
/// The hash is stable across restarts, updates, and user accounts on the
/// same machine. It is not reversible without knowing the hostname.
/// The app-specific prefix prevents cross-app correlation.
pub(crate) fn machine_id_hash() -> String {
    let hostname = gethostname::gethostname().to_string_lossy().into_owned();
    let input = format!(
        "vmark-machine-id-v1:{}:{}:{}",
        hostname,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

/// One-time application setup: menus, macOS fixes, legacy cleanup, default
/// genies, CLI/Finder file-arg queueing, the content-server runtime probe, and
/// the frontend "ready" listener.
///
/// Extracted from `run`'s former inline `.setup` closure so the setup steps are
/// individually readable and the builder chain stays declarative.
pub(crate) fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(pty::PtyState::default());

    // WI-LX1.1: re-grant the workspace roots the user chose in earlier
    // sessions. FIRST, and on this thread: the main window exists already, but
    // it cannot load or invoke anything until setup returns (bounded wait).
    crate::workspace::grants::restore_at_launch(app.handle());

    // Coherence layer: per-installation writer identity (spec §2.2) +
    // per-workspace kernel registry. A writer-id load failure falls back
    // to an ephemeral id — coherence degrades, the app never blocks.
    let writer = tauri::Manager::path(app.handle())
        .app_data_dir()
        .ok()
        .and_then(|dir| crate::coherence::state::load_or_create_writer_id(&dir).ok())
        .unwrap_or_else(|| {
            log::warn!("coherence: falling back to ephemeral writer id");
            crate::coherence::types::WriterId(uuid::Uuid::now_v7())
        });
    app.manage(crate::coherence::commands::CoherenceState {
        registry: crate::coherence::state::KernelRegistry::default(),
        writer,
        sweep_in_flight: std::sync::atomic::AtomicBool::new(false),
    });
    // The agent edit journal opens (and migrates the legacy checkpoint log)
    // off this thread; the first window never waits for its recovery.
    crate::agent_journal::service::spawn_startup(app.handle());
    let menu = menu::localized::create_localized_menu(app.handle(), None)?;
    app.set_menu(menu)?;

    // Disable App Nap so the webview stays active when backgrounded
    // (prevents MCP bridge timeouts from suspended JS)
    #[cfg(target_os = "macos")]
    crate::app_nap::disable_app_nap();

    // Fix macOS Help/Window menus (workaround for muda bug)
    #[cfg(target_os = "macos")]
    crate::macos_menu::apply_menu_fixes(app.handle());

    // Remove the items whose feature is off BEFORE any window paints a menu bar
    // (#1425). Every conditional item is built disabled and hidden by default,
    // and only the frontend's first push can turn one on — so without this the
    // menu bar carries a greyed "Toggle Knowledge Base" / "New Browser Tab"
    // until that push lands, and forever if it never does. Runs after the icon
    // pass so a stashed item is already iconed; see `rebuild_menu`.
    if let Err(e) = menu::conditional_items::reapply(app.handle()) {
        log::warn!("[Tauri] Failed to apply conditional menu item visibility: {e}");
    }

    // Best-effort cleanup of legacy ~/.vmark/ directory
    crate::app_paths::cleanup_legacy_home_dir(app.handle());

    // Install default AI genies (no-op if already present)
    if let Err(e) = crate::genies::install_default_genies(app.handle()) {
        log::warn!("[Tauri] Failed to install default genies: {}", e);
    }

    // Windows/Linux: handle files and folders passed as CLI arguments
    // (macOS uses RunEvent::Opened from Finder instead). A folder opens as a
    // workspace window, as a Finder folder does.
    #[cfg(not(target_os = "macos"))]
    {
        for dir in crate::supported_files::launch_dirs(std::env::args().skip(1)) {
            crate::files::open::open_finder_directory(app.handle(), &dir);
        }
        let file_args = crate::supported_files::filter_supported_args(std::env::args().skip(1));
        // Grant before queueing, and outside the state lock: the frontend can
        // only drain the queue after setup returns, so every queued path is
        // readable by the time it is read.
        for path_str in &file_args {
            crate::allow_fs_read(app.handle(), path_str);
        }
        crate::window_manager::file_open_state(app.handle()).queue_launch_file_args(file_args);
    }

    // Record, once per launch, whether the Knowledge Base could start here:
    // one `content_server runtime: node=… cli=…` log line. A
    // packaged build's log file is the only place this truth is observable
    // without a user opening the panel; release-smoke reads it from the staged
    // DMG. Detached and blocking-off-thread — setup never waits on `which`.
    crate::content_server::runtime::log_runtime_state(app.handle().clone());

    // Linux without a session bus runs unguarded; say so where a
    // user reading the log will look, now that the log plugin exists.
    #[cfg(target_os = "linux")]
    crate::single_instance::warn_if_unguarded();

    // Listen for "ready" events from frontend windows
    // This is used by menu::events to know when it's safe to emit events
    // The payload contains the window label as a string
    let app_handle = app.handle().clone();
    app.listen("ready", move |event| {
        if let Some(label) = crate::window_manager::ready_window_label(event.payload()) {
            menu::events::mark_window_ready(&app_handle, &label);
            crate::files::open::record_ready_document_window(&app_handle, &label);
        }
    });

    Ok(())
}

/// Handle an app exit request, preserving macOS last-window-close behavior
/// while letting Linux/Windows CLI launches terminate when no document windows
/// remain.
fn handle_exit_requested(app: &tauri::AppHandle, api: &tauri::ExitRequestApi, code: Option<i32>) {
    log::debug!("[Tauri] ExitRequested received, code={:?}", code);

    let has_doc_windows = app
        .webview_windows()
        .keys()
        .any(|label| quit::is_document_window_label(label));

    match quit::decide_exit_request_action(
        quit::is_exit_allowed(),
        has_doc_windows,
        quit::keep_alive_without_document_windows(),
    ) {
        quit::ExitRequestAction::AllowExit => {
            log::debug!("[Tauri] ExitRequested: allowing exit");
            // When exit was NOT routed through finalize_quit (which already
            // ran this), clean up child-process subsystems here — allowing
            // the exit leads to `std::process::exit`, which skips all Drops.
            if !quit::is_exit_allowed() {
                quit::shutdown_child_process_subsystems(app);
            }
        }
        quit::ExitRequestAction::PreventAndStartQuit => {
            api.prevent_exit();
            log::debug!("[Tauri] ExitRequested: starting quit flow");
            quit::start_quit(app);
        }
        quit::ExitRequestAction::PreventAndKeepAlive => {
            api.prevent_exit();
            log::debug!("[Tauri] ExitRequested: keeping app alive without document windows");
        }
    }
}

/// Dispatch app-level `RunEvent`s to focused handlers.
pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            handle_exit_requested(app, &api, code);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            window_destroyed::release_destroyed_window(app, &label);
            quit::handle_window_destroyed(app, &label);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Focused(focused),
            ..
        } => crate::files::open::record_document_window_focus(
            app,
            &label,
            focused,
            menu::events::is_window_ready(&label),
        ),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => crate::files::open::handle_reopen(app, has_visible_windows),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => crate::files::open::handle_finder_opened(app, urls),
        _ => {}
    }
}

/// Debug logging from the frontend (logs to terminal, debug builds only).
///
/// Lives here rather than in `lib.rs` so that file stays a declarative
/// composition root — the same reason the setup/event handlers were extracted.
///
/// Like its two siblings below, the message is whatever a webview sent, so it
/// is logged escaped and bounded (`peer_text.rs`): one message, one line.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_log(message: String) {
    log::debug!("[Frontend] {}", peer_message(&message));
}

/// Window-close milestones from the frontend, at INFO (#1253).
///
/// Deliberately separate from `debug_log`: that one is `debug!` and so is
/// filtered out of release builds, which is exactly why the first report of a
/// window that would not close arrived with a log containing nothing about the
/// close at all. The close flow has no timeout and no fallback, so these few
/// lines are the only way to tell where a stall happened — which await never
/// returned — from a log a user can actually send.
///
/// Kept to state transitions, not per-keystroke noise: a handful of lines per
/// close attempt.
#[tauri::command]
pub fn window_close_log(message: String) {
    log::info!("[WindowClose] {}", peer_message(&message));
}

/// Update-flow milestones from the frontend, at INFO (#1270).
///
/// Same reasoning as `window_close_log` above, for the other flow that can
/// stall with no timeout: the update check and download are network calls, and
/// a connection that stalls never settles. The state machine had no milestone
/// logging at any tier, so a report of a frozen update arrived with nothing
/// describing which step hung.
///
/// Deliberately a sibling of `window_close_log` rather than a generalisation
/// of it: that command shipped for a still-open report, and reworking it to
/// save three lines here would put the diagnostic being used to investigate
/// this stall at risk. Generalise when a third flow needs it.
///
/// Kept to state transitions: download progress events are not logged.
#[tauri::command]
pub fn update_log(message: String) {
    log::info!("[Update] {}", peer_message(&message));
}

mod window_destroyed;

#[cfg(test)]
#[path = "app_setup.test.rs"]
mod tests;
