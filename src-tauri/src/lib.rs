mod mcp_bridge;
mod mcp_config;
mod mcp_server;
mod menu;
mod menu_events;
mod pty;
mod quit;
mod watcher;
mod window_manager;
mod workspace;
mod file_tree;

use tauri::Manager;

/// Debug logging from frontend (logs to terminal, debug builds only)
#[cfg(debug_assertions)]
#[tauri::command]
fn debug_log(message: String) {
    eprintln!("[Frontend] {}", message);
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
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            menu::update_recent_files,
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
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_list,
            #[cfg(debug_assertions)]
            debug_log,
        ])
        .manage(pty::PtyState::new())
        .setup(|app| {
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(menu_events::handle_menu_event)
        // CRITICAL: Only intercept close for document windows (main, doc-*)
        // Non-document windows (settings, print-preview) should close normally
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
                // Settings, print-preview, etc. close normally without interception
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

                    // If quit is in progress, we called app.exit() - allow it through
                    if quit::is_quit_in_progress() {
                        #[cfg(debug_assertions)]
                        eprintln!("[Tauri] ExitRequested: quit in progress, allowing exit");
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
                // Each file opens in a new window with its folder as workspace root
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        // Convert file:// URL to path
                        if let Ok(path) = url.to_file_path() {
                            if let Some(path_str) = path.to_str() {
                                // Compute workspace root from file's parent directory
                                // Returns None if file is at root level (no valid parent)
                                let workspace_root =
                                    window_manager::get_workspace_root_for_file(path_str);

                                // Always create a new window for the file
                                // This handles both:
                                // 1. App just launched (no windows yet)
                                // 2. App running but all windows closed (dock icon still visible)
                                let _ = window_manager::create_document_window(
                                    app,
                                    Some(path_str),
                                    workspace_root.as_deref(),
                                );
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
