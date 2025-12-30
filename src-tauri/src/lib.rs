mod menu;
mod menu_events;
mod watcher;
mod window_manager;

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
            window_manager::new_window,
            window_manager::open_file_in_new_window,
            window_manager::close_window,
            window_manager::force_quit,
            window_manager::request_quit,
            watcher::start_watching,
            watcher::stop_watching,
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
                // Only intercept close for document windows
                if label == "main" || label.starts_with("doc-") {
                    api.prevent_close();
                    let _ = window.emit("window:close-requested", ());
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
                tauri::RunEvent::ExitRequested { api, .. } => {
                    api.prevent_exit();
                }
                // macOS: Clicking dock icon when no windows visible -> create new window
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } => {
                    if !has_visible_windows {
                        let _ = window_manager::create_document_window(app, None);
                    }
                }
                _ => {}
            }
        });
}
