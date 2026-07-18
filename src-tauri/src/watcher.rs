//! # File System Watcher
//!
//! Purpose: Watches workspace directories for external changes and notifies
//! the frontend via `fs:changed` events so the file explorer stays in sync.
//!
//! Pipeline: `start_watching` invoke → `notify` crate recursive watcher →
//! debounce + filter → `app.emit("fs:changed", ...)` → frontend `useFileTree`.
//!
//! Key decisions:
//!   - Debouncing (200ms) keyed by (watch_id, path, kind) suppresses duplicate
//!     events from macOS FSEvents, which fires multiple events for a single
//!     write. Kind is part of the key so a `create` followed by a `remove`
//!     within the window is never swallowed.
//!   - Specific noise directories (.git, node_modules, .obsidian) are filtered,
//!     but user-visible dot-dirs (.github, .vscode) are allowed through.
//!   - Each watcher is keyed by `watch_id` (typically window label) so multi-window
//!     setups can watch different directories independently.
//!
//! Known limitations:
//!   - No recursive ignore patterns — filtering is component-based, not glob-based.
//!   - Debounce is leading-edge only (suppress, not defer): when a burst of
//!     same-kind events lands within the window, the trailing events are
//!     dropped rather than re-emitted after the window, so the frontend may
//!     briefly show content one write behind until the next event arrives.

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Minimum interval between emitting events for the same path (debounce).
const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(200);

/// Maximum age of debounce entries before pruning (10 minutes).
/// Prevents unbounded growth of LAST_EMITTED in long sessions.
const DEBOUNCE_MAX_AGE: Duration = Duration::from_secs(600);

/// Watchers keyed by watch_id (typically window label or unique identifier)
static WATCHERS: Mutex<Option<HashMap<String, WatcherEntry>>> = Mutex::new(None);

struct WatcherEntry {
    /// Stored to keep the watcher alive; dropping stops watching
    _watcher: RecommendedWatcher,
}

/// File system change event emitted via `fs:changed` to the frontend.
///
/// Scoped by `watch_id` so multi-window setups can filter events.
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
        Modify(modify_kind) => match modify_kind {
            notify::event::ModifyKind::Name(_) => Some("rename"),
            _ => Some("modify"),
        },
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
/// Returns true if any path component matches the explicit ignore list,
/// or if the filename matches temp file patterns from atomic writes.
/// User-visible dot-directories (`.github`, `.vscode`, etc.) are allowed
/// through so that external changes to those files are detected.
fn should_ignore_path(path: &Path) -> bool {
    // Filter temp files created by atomic writes to reduce event noise.
    // NamedTempFile (lib.rs): dot-prefixed names like ".tmpXXXXXX" (6+ random chars)
    // app_paths.rs: names like ".{name}.tmp.{pid}" (contains ".tmp." infix)
    // We require the name to start with a dot to avoid filtering user files.
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name.starts_with('.') && (name.starts_with(".tmp") || name.contains(".tmp.")) {
            return true;
        }
    }

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

/// Debounce key: (watch_id, path, kind). Kind is part of the key so distinct
/// kinds for the same path (e.g. `create` then `remove`) never suppress each
/// other.
type DebounceKey = (String, String, String);

/// Per-path debounce state to suppress duplicate events from macOS FSEvents.
/// Value: last emitted time for the key.
static LAST_EMITTED: Mutex<Option<HashMap<DebounceKey, Instant>>> = Mutex::new(None);

/// Decide whether an event for `(watch_id, path, kind)` should be emitted,
/// recording `now` as its emission time when it should. Only a repeat of the
/// SAME kind within `DEBOUNCE_INTERVAL` is suppressed.
fn should_emit_and_record(
    map: &mut HashMap<DebounceKey, Instant>,
    watch_id: &str,
    path: &str,
    kind: &str,
    now: Instant,
) -> bool {
    let key = (watch_id.to_string(), path.to_string(), kind.to_string());
    if let Some(last) = map.get(&key) {
        if now.duration_since(*last) < DEBOUNCE_INTERVAL {
            return false; // Skip: same kind within debounce window
        }
    }
    map.insert(key, now);
    true
}

/// Handle a notify event and emit it to the frontend.
/// Deduplicates same-kind events for the same path within DEBOUNCE_INTERVAL.
fn handle_event(app: &AppHandle, watch_id: &str, root_path: &str, event: Event) {
    let Some(kind_str) = event_kind_to_string(&event.kind) else {
        return;
    };

    let now = Instant::now();

    // Collect paths, filtering ignored dirs and those within the debounce window
    let mut guard = LAST_EMITTED.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);

    // Periodically prune stale entries to prevent unbounded growth
    if map.len() > 100 {
        map.retain(|_, last| now.duration_since(*last) < DEBOUNCE_MAX_AGE);
    }

    let paths: Vec<String> = event
        .paths
        .iter()
        .filter(|p| !should_ignore_path(p))
        .filter_map(|p| {
            let path_str = p.to_string_lossy().to_string();
            should_emit_and_record(map, watch_id, &path_str, kind_str, now).then_some(path_str)
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
            map.retain(|(wid, _, _), _| wid != &watch_id);
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "watcher.test.rs"]
mod tests;
