mod mcp_bridge;
mod mcp_config;
mod mcp_server;
mod menu;
mod menu_events;
mod quit;
mod watcher;
mod window_manager;
mod workspace;
mod file_tree;

#[cfg(target_os = "macos")]
mod macos_menu;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Listener, Manager};

/// Pending files queued during cold start before frontend is ready
/// This solves the race condition where Finder opens a file but React hasn't mounted yet
#[derive(Clone, serde::Serialize)]
pub struct PendingFileOpen {
    pub path: String,
    pub workspace_root: Option<String>,
}

static PENDING_FILE_OPENS: Mutex<Vec<PendingFileOpen>> = Mutex::new(Vec::new());

/// Tracks whether frontend has initialized (called get_pending_file_opens)
/// After this, file opens should emit events instead of queueing
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

/// Get and clear pending file opens - called by frontend when ready
/// Also marks frontend as ready so future file opens emit events
#[tauri::command]
fn get_pending_file_opens() -> Vec<PendingFileOpen> {
    FRONTEND_READY.store(true, Ordering::SeqCst);
    let mut pending = PENDING_FILE_OPENS.lock().unwrap();
    pending.drain(..).collect()
}

/// Debug logging from frontend (logs to terminal, debug builds only)
#[cfg(debug_assertions)]
#[tauri::command]
fn debug_log(message: String) {
    eprintln!("[Frontend] {}", message);
}

/// Print the current webview content using native print dialog
#[tauri::command]
fn print_webview(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["settings"])
                // Exclude VISIBLE from state restoration to prevent flash.
                // Windows start hidden (visible: false) and are shown only
                // after frontend emits "ready" event in mark_window_ready().
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_pending_file_opens,
            menu::update_recent_files,
            menu::update_recent_workspaces,
            menu::rebuild_menu,
            window_manager::new_window,
            window_manager::open_file_in_new_window,
            window_manager::open_workspace_in_new_window,
            window_manager::open_workspace_with_files_in_new_window,
            window_manager::close_window,
            window_manager::force_quit,
            window_manager::request_quit,
            quit::cancel_quit,
            watcher::start_watching,
            watcher::stop_watching,
            watcher::stop_all_watchers,
            watcher::list_watchers,
            file_tree::list_directory_entries,
            workspace::open_folder_dialog,
            workspace::read_workspace_config,
            workspace::write_workspace_config,
            workspace::has_workspace_config,
            mcp_server::mcp_bridge_start,
            mcp_server::mcp_bridge_stop,
            mcp_server::mcp_server_start,
            mcp_server::mcp_server_stop,
            mcp_server::mcp_server_status,
            mcp_bridge::mcp_bridge_respond,
            mcp_config::mcp_config_get_status,
            mcp_config::mcp_config_diagnose,
            mcp_config::mcp_config_preview,
            mcp_config::mcp_config_install,
            mcp_config::mcp_config_uninstall,
            #[cfg(debug_assertions)]
            debug_log,
            print_webview,
        ])
        .setup(|app| {
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            // Fix macOS Help/Window menus (workaround for muda bug)
            #[cfg(target_os = "macos")]
            macos_menu::apply_menu_fixes();

            // Listen for "ready" events from frontend windows
            // This is used by menu_events to know when it's safe to emit events
            // The payload contains the window label as a string
            let app_handle = app.handle().clone();
            app.listen("ready", move |event| {
                // The payload is the window label
                if let Ok(label) = serde_json::from_str::<String>(event.payload()) {
                    #[cfg(debug_assertions)]
                    eprintln!("[Tauri] Window '{}' is ready", label);
                    menu_events::mark_window_ready(&app_handle, &label);
                }
            });

            Ok(())
        })
        .on_menu_event(menu_events::handle_menu_event)
        // CRITICAL: Only intercept close for document windows (main, doc-*)
        // Non-document windows (settings) should close normally
        .on_window_event(|window, event| {
            use tauri::Emitter;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                #[cfg(debug_assertions)]
                eprintln!("[Tauri] WindowEvent::CloseRequested for window '{}'", label);
                // Only intercept close for document windows
                if label == "main" || label.starts_with("doc-") {
                    api.prevent_close();
                    // Include target label in payload so frontend can filter
                    let _ = window.emit("window:close-requested", label);
                    #[cfg(debug_assertions)]
                    eprintln!("[Tauri] Emitted window:close-requested to '{}'", label);
                }
                // Settings and other non-document windows close normally
            }
        });

    // Tauri MCP bridge plugin for automation/screenshots (dev only)
    // Use port 9324 to avoid conflict with VMark MCP bridge on 9223
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .base_port(9324)
                .build(),
        );
    }

    // CRITICAL: Use .build().run() pattern for app-level event handling
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // CRITICAL: Prevent quit on last window close (macOS behavior)
                // App should only quit via Cmd+Q or menu Quit
                tauri::RunEvent::ExitRequested { api, code: _code, .. } => {
                    #[cfg(debug_assertions)]
                    eprintln!("[Tauri] ExitRequested received, code={:?}", _code);

                    // If we explicitly allowed exit (we're done with coordinated quit), allow it through.
                    // IMPORTANT: Quit can be "in progress" while we still need to block OS quit requests.
                    if quit::is_exit_allowed() {
                        #[cfg(debug_assertions)]
                        eprintln!("[Tauri] ExitRequested: exit allowed, allowing exit");
                        return;
                    }

                    // Prevent exit for last-window-close scenario (macOS behavior)
                    api.prevent_exit();
                    #[cfg(debug_assertions)]
                    eprintln!("[Tauri] ExitRequested: prevent_exit() called");

                    // Only start coordinated quit if there are document windows
                    let has_doc_windows = app
                        .webview_windows()
                        .keys()
                        .any(|label| quit::is_document_window_label(label));

                    if has_doc_windows {
                        #[cfg(debug_assertions)]
                        eprintln!("[Tauri] ExitRequested: starting quit flow");
                        quit::start_quit(&app);
                    }
                    // If no document windows, just stay alive (macOS dock behavior)
                }
                tauri::RunEvent::WindowEvent { label, event, .. } => {
                    if let tauri::WindowEvent::Destroyed = event {
                        quit::handle_window_destroyed(&app, &label);
                        menu_events::clear_window_ready(&label);
                    }
                }
                // macOS: Clicking dock icon when no windows visible -> create new window
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } => {
                    if !has_visible_windows {
                        let _ = window_manager::create_document_window(app, None, None);
                    }
                }
                // Handle files opened from Finder (double-click, "Open With", etc.)
                // Queue files for frontend to process when ready (solves cold start race)
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        // Convert file:// URL to path
                        if let Ok(path) = url.to_file_path() {
                            if let Some(path_str) = path.to_str() {
                                // Handle directories: open as workspace
                                if path.is_dir() {
                                    let _ = window_manager::create_document_window(
                                        app,
                                        None,
                                        Some(path_str),
                                    );
                                    continue;
                                }

                                // Compute workspace root from file's parent directory
                                let workspace_root =
                                    window_manager::get_workspace_root_for_file(path_str);

                                // Check if frontend is ready (has called get_pending_file_opens)
                                if FRONTEND_READY.load(Ordering::SeqCst) {
                                    // Frontend is ready - check if we have a window to emit to
                                    if let Some(main_window) = app.get_webview_window("main") {
                                        // Emit event to main window
                                        use tauri::Emitter;
                                        let payload = PendingFileOpen {
                                            path: path_str.to_string(),
                                            workspace_root,
                                        };
                                        let _ = main_window.emit("app:open-file", payload);
                                    } else {
                                        // No main window but frontend was ready (reopen scenario)
                                        // Create a new window with the file
                                        let _ = window_manager::create_document_window(
                                            app,
                                            Some(path_str),
                                            workspace_root.as_deref(),
                                        );
                                    }
                                } else {
                                    // Cold start - queue for the main window
                                    // The main window from tauri.conf.json will handle pending files
                                    if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                                        pending.push(PendingFileOpen {
                                            path: path_str.to_string(),
                                            workspace_root,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
