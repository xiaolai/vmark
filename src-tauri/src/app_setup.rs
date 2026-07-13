//! One-time app setup and app-level event dispatch.
//!
//! Purpose: Hosts `run()`'s setup closure and the `RunEvent` / window-event
//! handlers so `lib.rs` stays a declarative composition root. Extracted
//! verbatim from `lib.rs` to keep that file under the size gate.
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
        }
    });

    Ok(())
}

/// Intercept close requests for document windows so the frontend can run its
/// save/confirm flow. Non-document windows (settings) close normally.
pub(crate) fn handle_document_window_close_event(
    window: &tauri::Window,
    event: &tauri::WindowEvent,
) {
    use tauri::Emitter;
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let label = window.label();
        log::debug!("[Tauri] WindowEvent::CloseRequested for window '{}'", label);
        // Only intercept close for document windows
        if label == "main" || label.starts_with("doc-") {
            api.prevent_close();
            // Include target label in payload so frontend can filter
            let _ = window.emit("window:close-requested", label);
            log::debug!("[Tauri] Emitted window:close-requested to '{}'", label);
        }
        // Settings and other non-document windows close normally
    }
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
            if !quit::is_exit_allowed() {
                crate::mcp_server::cleanup(app);
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
            quit::handle_window_destroyed(app, &label);
            menu_events::clear_window_ready(&label);
            tab_transfer::clear_unclaimed_transfer(&label);
            workspace_transfer::clear_unclaimed_transfer(&label);
            window_status::prune(app, &label);
        }
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
