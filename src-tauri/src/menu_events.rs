use tauri::{AppHandle, Emitter};

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    // Handle recent file clicks specially - extract index and emit with payload
    if let Some(index_str) = id.strip_prefix("recent-file-") {
        if let Ok(index) = index_str.parse::<usize>() {
            let _ = app.emit("menu:open-recent-file", index);
            return;
        }
    }

    // "new-window" creates a new window directly in Rust
    // "new" emits to frontend to create a new tab in the current window
    if id == "new-window" {
        let _ = crate::window_manager::create_document_window(app, None, None);
        return;
    }

    // All other menu events are emitted to the frontend
    let event_name = format!("menu:{id}");
    let _ = app.emit(&event_name, ());
}
