//! # File System Watcher
//!
//! Purpose: Watches workspace directories for external changes and notifies
//! the frontend via `fs:changed` events so the file explorer stays in sync.
//!
//! Pipeline: `start_watching` invoke → `notify` crate recursive watcher →
//! debounce + filter → `app.emit("fs:changed", ...)` → frontend `useFileTree`.
//!
//! Key decisions:
//!   - Per-path debouncing (200ms) suppresses duplicate events from macOS FSEvents
//!     which fires multiple events for a single write.
//!   - Specific noise directories (.git, node_modules, .obsidian) are filtered,
//!     but user-visible dot-dirs (.github, .vscode) are allowed through.
//!   - Each watcher is keyed by `watch_id` (typically window label) so multi-window
//!     setups can watch different directories independently.
//!
//! Known limitations:
//!   - No recursive ignore patterns — filtering is component-based, not glob-based.

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Minimum interval between emitting events for the same path (debounce).
const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(200);

/// Watchers keyed by watch_id (typically window label or unique identifier)
static WATCHERS: Mutex<Option<HashMap<String, WatcherEntry>>> = Mutex::new(None);

struct WatcherEntry {
    /// Stored to keep the watcher alive; dropping stops watching
    _watcher: RecommendedWatcher,
}

/// File system change event with watch context.
/// Includes watchId to scope events to their originating watcher.
#[derive(Clone, Serialize)]
pub struct FsChangeEvent {
    /// Unique identifier for this watcher (window label)
    #[serde(rename = "watchId")]
    pub watch_id: String,
    /// Root path being watched
    #[serde(rename = "rootPath")]
    pub root_path: String,
    /// Changed paths (may be multiple for batch operations)
    pub paths: Vec<String>,
    /// Event kind: "create", "modify", "remove", "rename"
    pub kind: String,
}

/// Map notify event kinds to simple string identifiers.
/// Returns None for events we don't care about (Access, Other, Any).
fn event_kind_to_string(kind: &notify::EventKind) -> Option<&'static str> {
    use notify::EventKind::*;
    match kind {
        Create(_) => Some("create"),
        Remove(_) => Some("remove"),
        Modify(modify_kind) => {
            match modify_kind {
                notify::event::ModifyKind::Name(_) => Some("rename"),
                _ => Some("modify"),
            }
        }
        _ => None,
    }
}

/// Directory/file names that should always be ignored by the file watcher.
/// Only list specific high-frequency noise sources — do NOT blanket-ignore
/// all dot-directories, since user-visible ones like `.github/`, `.vscode/`,
/// `.husky/` need external change detection.
const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".obsidian",
    ".svn",
    ".hg",
    "node_modules",
    ".DS_Store",
    ".Trash",
    "__pycache__",
];

/// Check whether a filesystem path should be ignored by the watcher.
///
/// Returns true if any path component matches the explicit ignore list.
/// User-visible dot-directories (`.github`, `.vscode`, etc.) are allowed
/// through so that external changes to those files are detected.
fn should_ignore_path(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            let name_str = name.to_string_lossy();
            if IGNORED_DIRS.contains(&name_str.as_ref()) {
                return true;
            }
        }
    }
    false
}

/// Per-path debounce state to suppress duplicate events from macOS FSEvents.
/// Key: (watch_id, path), Value: last emitted time.
static LAST_EMITTED: Mutex<Option<HashMap<(String, String), Instant>>> = Mutex::new(None);

/// Handle a notify event and emit it to the frontend.
/// Deduplicates events for the same path within DEBOUNCE_INTERVAL.
fn handle_event(app: &AppHandle, watch_id: &str, root_path: &str, event: Event) {
    let Some(kind_str) = event_kind_to_string(&event.kind) else {
        return;
    };

    let now = Instant::now();

    // Collect paths, filtering ignored dirs and those within the debounce window
    let mut guard = LAST_EMITTED.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);

    let paths: Vec<String> = event
        .paths
        .iter()
        .filter(|p| !should_ignore_path(p))
        .filter_map(|p| {
            let path_str = p.to_string_lossy().to_string();
            let key = (watch_id.to_string(), path_str.clone());

            if let Some(last) = map.get(&key) {
                if now.duration_since(*last) < DEBOUNCE_INTERVAL {
                    return None; // Skip: within debounce window
                }
            }
            map.insert(key, now);
            Some(path_str)
        })
        .collect();

    drop(guard); // Release lock before emitting

    if paths.is_empty() {
        return;
    }

    let payload = FsChangeEvent {
        watch_id: watch_id.to_string(),
        root_path: root_path.to_string(),
        paths,
        kind: kind_str.to_string(),
    };

    let _ = app.emit("fs:changed", payload);
}

/// Start watching a directory.
///
/// # Arguments
/// * `app` - Tauri app handle for emitting events
/// * `watch_id` - Unique identifier for this watcher (typically window label)
/// * `path` - Directory path to watch recursively
#[tauri::command]
pub fn start_watching(app: AppHandle, watch_id: String, path: String) -> Result<(), String> {
    let watch_path = Path::new(&path);
    if !watch_path.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    // Stop any existing watcher for this watch_id first
    stop_watching(watch_id.clone())?;

    let app_handle = app.clone();
    let watch_id_clone = watch_id.clone();
    let root_path_clone = path.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                handle_event(&app_handle, &watch_id_clone, &root_path_clone, event);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    let mut guard = WATCHERS.lock().map_err(|e| format!("Lock error: {e}"))?;
    let watchers = guard.get_or_insert_with(HashMap::new);
    watchers.insert(watch_id, WatcherEntry { _watcher: watcher });

    Ok(())
}

/// Stop watching for a specific watch_id.
#[tauri::command]
pub fn stop_watching(watch_id: String) -> Result<(), String> {
    let mut guard = WATCHERS.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(watchers) = guard.as_mut() {
        watchers.remove(&watch_id);
    }
    // Clean up debounce entries for this watch_id
    if let Ok(mut debounce_guard) = LAST_EMITTED.lock() {
        if let Some(map) = debounce_guard.as_mut() {
            map.retain(|(wid, _), _| wid != &watch_id);
        }
    }
    Ok(())
}

/// Stop all watchers.
#[tauri::command]
pub fn stop_all_watchers() -> Result<(), String> {
    let mut guard = WATCHERS.lock().map_err(|e| format!("Lock error: {e}"))?;
    *guard = None;
    Ok(())
}

/// Get list of active watcher IDs.
#[tauri::command]
pub fn list_watchers() -> Result<Vec<String>, String> {
    let guard = WATCHERS.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(guard
        .as_ref()
        .map(|w| w.keys().cloned().collect())
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::EventKind;

    #[test]
    fn test_event_kind_create() {
        let kind = EventKind::Create(notify::event::CreateKind::File);
        assert_eq!(event_kind_to_string(&kind), Some("create"));
    }

    #[test]
    fn test_event_kind_modify() {
        let kind = EventKind::Modify(notify::event::ModifyKind::Data(
            notify::event::DataChange::Content,
        ));
        assert_eq!(event_kind_to_string(&kind), Some("modify"));
    }

    #[test]
    fn test_event_kind_remove() {
        let kind = EventKind::Remove(notify::event::RemoveKind::File);
        assert_eq!(event_kind_to_string(&kind), Some("remove"));
    }

    #[test]
    fn test_event_kind_access_ignored() {
        let kind = EventKind::Access(notify::event::AccessKind::Read);
        assert_eq!(event_kind_to_string(&kind), None);
    }

    #[test]
    fn test_event_kind_other_ignored() {
        let kind = EventKind::Other;
        assert_eq!(event_kind_to_string(&kind), None);
    }

    #[test]
    fn test_ignore_git_dir() {
        assert!(should_ignore_path(Path::new("/project/.git/objects/abc")));
        assert!(should_ignore_path(Path::new("/project/.git/HEAD")));
    }

    #[test]
    fn test_ignore_obsidian_dir() {
        assert!(should_ignore_path(Path::new("/vault/.obsidian/workspace.json")));
        assert!(should_ignore_path(Path::new("/vault/.obsidian/plugins/foo")));
    }

    #[test]
    fn test_ignore_node_modules() {
        assert!(should_ignore_path(Path::new("/project/node_modules/pkg/index.js")));
    }

    #[test]
    fn test_allow_dot_directories_not_in_ignore_list() {
        // User-visible dot-directories must NOT be filtered — external change
        // detection depends on events reaching the frontend.
        assert!(!should_ignore_path(Path::new("/project/.github/workflows/ci.yml")));
        assert!(!should_ignore_path(Path::new("/project/.vscode/settings.json")));
        assert!(!should_ignore_path(Path::new("/home/.config/app.toml")));
        assert!(!should_ignore_path(Path::new("/project/.husky/pre-commit")));
        assert!(!should_ignore_path(Path::new("/project/.devcontainer/devcontainer.json")));
    }

    #[test]
    fn test_allow_normal_paths() {
        assert!(!should_ignore_path(Path::new("/project/src/foo.md")));
        assert!(!should_ignore_path(Path::new("/project/notes/chapter1.md")));
        assert!(!should_ignore_path(Path::new("/project/README.md")));
    }

    #[test]
    fn test_ignore_ds_store() {
        assert!(should_ignore_path(Path::new("/project/.DS_Store")));
    }

    #[test]
    fn test_ignore_pycache() {
        assert!(should_ignore_path(Path::new("/project/__pycache__/mod.pyc")));
    }

    #[test]
    fn test_fs_change_event_serialization() {
        let event = FsChangeEvent {
            watch_id: "main".to_string(),
            root_path: "/Users/test".to_string(),
            paths: vec!["/Users/test/file.md".to_string()],
            kind: "modify".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"watchId\":\"main\""));
        assert!(json.contains("\"rootPath\":\"/Users/test\""));
        assert!(json.contains("\"kind\":\"modify\""));
    }
}
