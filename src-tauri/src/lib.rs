mod menu;
mod menu_events;
mod quit;
mod watcher;
mod window_manager;
mod workspace;

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

/// Pending file open request with workspace root
#[derive(Clone, Serialize)]
pub struct PendingOpen {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "workspaceRoot")]
    pub workspace_root: String,
}

/// Stores file paths opened via Finder before the main window is ready
static PENDING_OPEN_FILES: Mutex<Vec<PendingOpen>> = Mutex::new(Vec::new());

/// Get and clear any pending files that were opened before frontend was ready
#[tauri::command]
fn get_pending_open_files() -> Vec<PendingOpen> {
    let mut pending = PENDING_OPEN_FILES.lock().unwrap();
    std::mem::take(&mut *pending)
}

/// Debug logging from frontend (logs to terminal)
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
        .invoke_handler(tauri::generate_handler![
            menu::update_recent_files,
            menu::rebuild_menu,
            window_manager::new_window,
            window_manager::open_file_in_new_window,
            window_manager::open_workspace_in_new_window,
            window_manager::close_window,
            window_manager::force_quit,
            window_manager::request_quit,
            quit::cancel_quit,
            watcher::start_watching,
            watcher::stop_watching,
            watcher::stop_all_watchers,
            watcher::list_watchers,
            workspace::open_folder_dialog,
            workspace::read_workspace_config,
            workspace::write_workspace_config,
            workspace::has_workspace_config,
            get_pending_open_files,
            #[cfg(debug_assertions)]
            debug_log,
        ])
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

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    // CRITICAL: Use .build().run() pattern for app-level event handling
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // CRITICAL: Prevent quit on last window close (macOS behavior)
                // App should only quit via Cmd+Q or menu Quit
                tauri::RunEvent::ExitRequested { api, code, .. } => {
                    #[cfg(debug_assertions)]
                    eprintln!("[Tauri] ExitRequested received, code={:?}", code);
                    api.prevent_exit();
                    #[cfg(debug_assertions)]
                    eprintln!("[Tauri] ExitRequested: prevent_exit() called");
                    quit::start_quit(&app);
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
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        // Convert file:// URL to path
                        if let Ok(path) = url.to_file_path() {
                            if let Some(path_str) = path.to_str() {
                                // Compute workspace root from file's parent directory
                                // Returns None if file is at root level (no valid parent)
                                let workspace_root = window_manager::get_workspace_root_for_file(path_str);

                                let windows = app.webview_windows();
                                if windows.is_empty() {
                                    // App just launched - store for first window to pick up
                                    if let Ok(mut pending) = PENDING_OPEN_FILES.lock() {
                                        pending.push(PendingOpen {
                                            file_path: path_str.to_string(),
                                            // Use empty string if no workspace root (edge case)
                                            workspace_root: workspace_root.clone().unwrap_or_default(),
                                        });
                                    }
                                } else {
                                    // App is running - open directly in new window (no broadcast)
                                    let _ = window_manager::create_document_window(
                                        app,
                                        Some(path_str),
                                        workspace_root.as_deref(),
                                    );
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
