use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);

#[derive(Clone, Serialize)]
pub struct FsChangeEvent {
    pub path: String,
    pub kind: String, // "create", "modify", "remove", "rename"
}

fn event_kind_to_string(kind: &notify::EventKind) -> Option<&'static str> {
    use notify::EventKind::*;
    match kind {
        Create(_) => Some("create"),
        Modify(_) => Some("modify"),
        Remove(_) => Some("remove"),
        _ => None,
    }
}

fn handle_event(app: &AppHandle, event: Event) {
    let Some(kind_str) = event_kind_to_string(&event.kind) else {
        return;
    };

    for path in event.paths {
        let path_str = path.to_string_lossy().to_string();
        let payload = FsChangeEvent {
            path: path_str,
            kind: kind_str.to_string(),
        };
        let _ = app.emit("fs:changed", payload);
    }
}

#[tauri::command]
pub fn start_watching(app: AppHandle, path: String) -> Result<(), String> {
    let watch_path = Path::new(&path);
    if !watch_path.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    // Stop any existing watcher first
    stop_watching()?;

    let app_handle = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                handle_event(&app_handle, event);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    let mut guard = WATCHER.lock().map_err(|e| format!("Lock error: {e}"))?;
    *guard = Some(watcher);

    Ok(())
}

#[tauri::command]
pub fn stop_watching() -> Result<(), String> {
    let mut guard = WATCHER.lock().map_err(|e| format!("Lock error: {e}"))?;
    *guard = None;
    Ok(())
}
