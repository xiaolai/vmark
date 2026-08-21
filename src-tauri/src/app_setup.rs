//! One-time app setup and app-level event dispatch.
//!
//! Purpose: Coordinates one-time setup and app-level lifecycle dispatch,
//! including Finder-target focus and destruction tracking, so `lib.rs` stays
//! a declarative composition root.
//!
//! Key decisions:
//!   - Window close is intercepted for document windows (main, doc-*) to allow
//!     dirty-document prompts; non-document windows close immediately.
//!   - `machine_id_hash()` generates a stable anonymous device identifier via
//!     SHA-256(hostname + OS + arch), sent as `X-Machine-Id` header on update checks.

use sha2::{Digest, Sha256};
use tauri::{Listener, Manager};

use crate::{menu, menu_events, pty, quit, tab_transfer, window_status, workspace_transfer};

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
/// genies, CLI/Finder file-arg queueing, and the frontend "ready" listener.
///
/// Extracted from `run`'s former inline `.setup` closure so the setup steps are
/// individually readable and the builder chain stays declarative.
pub(crate) fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(pty::PtyState::default());

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
    let menu = menu::localized::create_localized_menu(app.handle(), None)?;
    app.set_menu(menu)?;

    // Disable App Nap so the webview stays active when backgrounded
    // (prevents MCP bridge timeouts from suspended JS)
    #[cfg(target_os = "macos")]
    crate::app_nap::disable_app_nap();

    // Fix macOS Help/Window menus (workaround for muda bug)
    #[cfg(target_os = "macos")]
    crate::macos_menu::apply_menu_fixes(app.handle());

    // Best-effort cleanup of legacy ~/.vmark/ directory
    crate::app_paths::cleanup_legacy_home_dir(app.handle());

    // Install default AI genies (no-op if already present)
    if let Err(e) = crate::genies::install_default_genies(app.handle()) {
        log::warn!("[Tauri] Failed to install default genies: {}", e);
    }

    // Windows/Linux: handle files passed as CLI arguments
    // (macOS uses RunEvent::Opened from Finder instead)
    #[cfg(not(target_os = "macos"))]
    {
        let file_args = crate::supported_files::filter_supported_args(std::env::args().skip(1));

        if !file_args.is_empty() {
            if let Ok(mut state) = crate::file_open::FILE_OPEN_STATE.lock() {
                for path_str in file_args {
                    crate::allow_fs_read(app.handle(), &path_str);
                    let workspace_root =
                        crate::window_manager::get_workspace_root_for_file(&path_str);
                    state.pending.push(crate::PendingFileOpen {
                        path: path_str,
                        workspace_root,
                    });
                }
            }
        }
    }

    // Listen for "ready" events from frontend windows
    // This is used by menu_events to know when it's safe to emit events
    // The payload contains the window label as a string
    let app_handle = app.handle().clone();
    app.listen("ready", move |event| {
        // The payload is the window label
        if let Ok(label) = serde_json::from_str::<String>(event.payload()) {
            log::debug!("[Tauri] Window '{}' is ready", label);
            menu_events::mark_window_ready(&app_handle, &label);
            crate::file_open::record_ready_document_window(&app_handle, &label);
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
            crate::file_open::remove_document_window(&label);
            quit::handle_window_destroyed(app, &label);
            menu_events::clear_window_ready(&label);
            tab_transfer::clear_unclaimed_transfer(&label);
            workspace_transfer::clear_unclaimed_transfer(&label);
            window_status::prune(app, &label);
            // Drop the window's filesystem watcher. The frontend's own
            // `stop_watching` invoke runs in the dying webview and can race
            // its teardown; window labels are never reused, so without this
            // each closed window would leak a recursive watcher (idempotent).
            if let Err(e) = crate::watcher::stop_watching(label.clone()) {
                log::warn!("[Tauri] Failed to stop watcher for '{}': {}", label, e);
            }
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Focused(focused),
            ..
        } => crate::file_open::record_document_window_focus(
            &label,
            focused,
            menu_events::is_window_ready(&label),
        ),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => crate::file_open::handle_reopen(app, has_visible_windows),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => crate::file_open::handle_finder_opened(app, urls),
        _ => {}
    }
}

/// Debug logging from the frontend (logs to terminal, debug builds only).
///
/// Lives here rather than in `lib.rs` so that file stays a declarative
/// composition root — the same reason the setup/event handlers were extracted.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_log(message: String) {
    log::debug!("[Frontend] {}", message);
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
    log::info!("[WindowClose] {}", message);
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
    log::info!("[Update] {}", message);
}
