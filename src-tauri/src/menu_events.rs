use tauri::{AppHandle, Emitter, Listener, Manager};

/// Check if there are any document windows open (ignores settings window)
fn has_document_windows(app: &AppHandle) -> bool {
    app.webview_windows()
        .values()
        .any(|w| w.label() != "settings")
}

/// Get the focused window, if any
fn get_focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .cloned()
}

/// Create a new document window and emit an event to it once ready.
/// The event is emitted with the new window's label as payload.
fn create_window_and_emit(app: &AppHandle, event_name: &str) {
    let event_owned = event_name.to_string();
    let app_clone = app.clone();

    if let Ok(label) = crate::window_manager::create_document_window(app, None, None) {
        let label_clone = label.clone();
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.once("ready", move |_| {
                if let Some(w) = app_clone.get_webview_window(&label_clone) {
                    let _ = w.emit(&event_owned, &label_clone);
                }
            });
        }
    }
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    // Handle recent file clicks specially - look up path from snapshot and emit
    // Emit to focused window with (path, windowLabel) tuple
    // If no windows exist, create one first
    if let Some(index_str) = id.strip_prefix("recent-file-") {
        if let Ok(index) = index_str.parse::<usize>() {
            // Look up path from the snapshot stored when menu was built
            // This prevents race conditions if store changed since menu creation
            if let Some(path) = crate::menu::get_recent_file_path(index) {
                if let Some(focused) = get_focused_window(app) {
                    let _ = focused.emit("menu:open-recent-file", (&path, focused.label()));
                } else if !has_document_windows(app) {
                    // No windows - create one and emit the event
                    let app_clone = app.clone();
                    if let Ok(label) = crate::window_manager::create_document_window(app, None, None) {
                        let label_clone = label.clone();
                        if let Some(window) = app.get_webview_window(&label) {
                            let _ = window.once("ready", move |_| {
                                if let Some(w) = app_clone.get_webview_window(&label_clone) {
                                    let _ = w.emit("menu:open-recent-file", (&path, &label_clone));
                                }
                            });
                        }
                    }
                }
            }
            return;
        }
    }

    // "new-window" creates a new window directly in Rust
    if id == "new-window" {
        let _ = crate::window_manager::create_document_window(app, None, None);
        return;
    }

    // "new" creates a tab in current window, but if no windows exist, create a new window
    // (Cmd+N when last window closed should open a new window)
    if id == "new" {
        if !has_document_windows(app) {
            let _ = crate::window_manager::create_document_window(app, None, None);
            return;
        }
    }

    // "close" (Cmd+W) should only affect the focused window
    // Note: window.emit() broadcasts to all windows, so include target label in payload
    if id == "close" {
        if let Some(focused) = get_focused_window(app) {
            let _ = focused.emit("menu:close", focused.label());
        }
        return;
    }

    // File operations that should work without windows
    // Create a window first, then emit the event
    if matches!(id, "open" | "open-folder") {
        if let Some(focused) = get_focused_window(app) {
            let event_name = format!("menu:{id}");
            let _ = focused.emit(&event_name, focused.label());
        } else if !has_document_windows(app) {
            create_window_and_emit(app, &format!("menu:{id}"));
        }
        return;
    }

    // "clear-recent" can be handled without a window if needed
    // But for consistency, we still emit to a window (frontend handles storage)

    // All other menu events are emitted only to the focused window
    // Note: window.emit() broadcasts to all windows, so include target label in payload
    // Frontend filters by checking event.payload === windowLabel
    if let Some(focused) = get_focused_window(app) {
        let event_name = format!("menu:{id}");
        let _ = focused.emit(&event_name, focused.label());
    }
}
