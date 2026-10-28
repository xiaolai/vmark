//! # File System Watcher
//!
//! Purpose: Watches workspace directories for external changes and notifies
//! the owning window via `fs:changed` batches so the file explorer and open
//! documents stay in sync.
//!
//! Pipeline: `start_watching` invoke → `notify` crate recursive watcher →
//! `signal_for` (classify + filter) → bounded queue → `batch::run_batch_loop`
//! on the watcher's batch thread → `emit_to(<window label>, "fs:changed", …)`
//! → frontend `services/workspaceEvents`.
//!
//! Key decisions:
//!   - Paths are reported under the root the caller asked to watch, not the
//!     realpath the OS returns (see `paths::rebase_onto_root`).
//!   - A watcher that lost track of the tree says so. A watcher error and the
//!     OS's own overflow report (`EventKind::Other` / the rescan flag) both
//!     become `Signal::Rescan`, which the frontend answers by re-listing.
//!   - Changes are batched per watcher (see `watcher/batch.rs`) and delivered
//!     only to the window that owns the watcher: every window runs its own
//!     watcher, so an app-global event woke every window for every change.
//!   - Specific noise directories (.git, node_modules, .obsidian) are filtered,
//!     but user-visible dot-dirs (.github, .vscode) are allowed through.
//!   - Each watcher is keyed by `watch_id`, which IS the owning window's label:
//!     it names both the registry entry and the event target.
//!   - `start_watching` is async — creating a recursive watcher walks the tree
//!     on some platforms and must not hold the IPC thread. That removes the
//!     serialization against the window-destroyed cleanup the IPC thread used
//!     to provide, so a watcher registered for a window that is already gone
//!     is removed again before the command returns.
//!
//! @coordinates-with watcher/batch.rs — the batching and the `fs:changed` payload
//! @coordinates-with watcher/paths.rs — the ignore list and root rebasing
//! @coordinates-with app_setup.rs — stops a window's watcher when it is destroyed
//! @module watcher

mod batch;
mod paths;
mod renames;

use crate::command_error::CommandError;
use batch::{BatchConfig, FsChange, FsChangeBatch, FsChangeKind, Signal};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use paths::{rebase_onto_root, should_ignore_path};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The event a watcher's batches are delivered under.
const FS_CHANGED_EVENT: &str = "fs:changed";

/// Watchers keyed by watch_id (the owning window's label). A static because
/// the window-destroyed cleanup stops a watcher by label alone.
static WATCHERS: Mutex<Option<HashMap<String, WatcherEntry>>> = Mutex::new(None);

struct WatcherEntry {
    /// Stored to keep the watcher alive; dropping stops watching
    _watcher: RecommendedWatcher,
}

/// What a notify event kind means for the owning window.
#[derive(Debug, PartialEq, Eq)]
enum KindClass {
    Change(FsChangeKind),
    /// The watcher lost track of the tree; the frontend must re-list.
    Rescan,
    /// Nothing the window needs (a file was merely read).
    Ignore,
}

/// `Other` is how notify reports a condition of the watch itself — FSEvents'
/// "must scan subdirs" and an inotify queue overflow both arrive as it — and
/// `Any` is an event notify could not classify. Neither names what changed,
/// so both mean "re-list", never "nothing happened".
fn classify_kind(kind: &notify::EventKind) -> KindClass {
    use notify::EventKind::*;
    match kind {
        Create(_) => KindClass::Change(FsChangeKind::Create),
        Remove(_) => KindClass::Change(FsChangeKind::Remove),
        Modify(notify::event::ModifyKind::Name(_)) => KindClass::Change(FsChangeKind::Rename),
        Modify(_) => KindClass::Change(FsChangeKind::Modify),
        Access(_) => KindClass::Ignore,
        Other | Any => KindClass::Rescan,
    }
}

/// The root one watcher covers: as the caller spelled it, and as the OS
/// reports paths under it.
struct WatchScope {
    watch_id: String,
    root_path: String,
    canonical_root: String,
}

/// Reduce one notify callback result to what the owning window needs, or
/// `None` when it carries nothing for it (a read, or only ignored paths).
fn signal_for(result: Result<Event, notify::Error>, scope: &WatchScope) -> Option<Signal> {
    let event = match result {
        Ok(event) => event,
        Err(error) => {
            log::warn!(
                "[watcher] {:?} reported an error, asking for a rescan: {error}",
                scope.watch_id
            );
            return Some(Signal::Rescan);
        }
    };
    // The rescan flag wins over the kind: whatever the event names, the OS is
    // saying it is not the whole story.
    let class = if event.need_rescan() {
        KindClass::Rescan
    } else {
        classify_kind(&event.kind)
    };
    let kind = match class {
        KindClass::Change(kind) => kind,
        KindClass::Rescan => {
            log::info!(
                "[watcher] {:?} lost track of changes, asking for a rescan",
                scope.watch_id
            );
            return Some(Signal::Rescan);
        }
        KindClass::Ignore => return None,
    };
    let paths: Vec<String> = event
        .paths
        .iter()
        .filter(|path| !should_ignore_path(path))
        .map(|path| {
            rebase_onto_root(
                &path.to_string_lossy(),
                &scope.root_path,
                &scope.canonical_root,
            )
        })
        .collect();
    if paths.is_empty() {
        return None;
    }
    Some(Signal::Change(FsChange { kind, paths }))
}

/// Deliver one batch to the window that owns the watcher, and to no other —
/// after the agent journal has followed its renames (files and the trees of
/// renamed directories), so a document the window opens already has its
/// identity at the new path (see `watcher/renames.rs`).
fn emit_batch<R: Runtime>(app: &AppHandle<R>, batch: &FsChangeBatch) {
    renames::deliver(app, batch, || {
        if let Err(error) = app.emit_to(batch.watch_id.as_str(), FS_CHANGED_EVENT, batch) {
            log::warn!(
                "[watcher] failed to deliver {FS_CHANGED_EVENT} to {:?}: {error}",
                batch.watch_id
            );
        }
    });
}

fn lock_watchers() -> std::sync::MutexGuard<'static, Option<HashMap<String, WatcherEntry>>> {
    WATCHERS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Take a watcher out of the registry. The entry is returned so the caller
/// drops it AFTER the lock is released — dropping joins the watcher's thread.
fn take_watcher(watch_id: &str) -> Option<WatcherEntry> {
    lock_watchers().as_mut()?.remove(watch_id)
}

/// Start watching a directory.
///
/// # Arguments
/// * `app` - Tauri app handle for emitting events
/// * `watch_id` - The owning window's label
/// * `path` - Directory path to watch recursively
///
/// # Errors
/// `not-found` when `path` does not exist, `io` when the OS refuses the
/// watch, `conflict` when the window was closed while the watcher started,
/// `internal` when the blocking task itself failed.
#[tauri::command]
pub async fn start_watching<R: Runtime>(
    app: AppHandle<R>,
    watch_id: String,
    path: String,
) -> Result<(), CommandError> {
    tokio::task::spawn_blocking(move || start_watching_blocking(&app, watch_id, path))
        .await
        .map_err(|e| CommandError::internal(format!("watcher start task failed: {e}")))?
}

/// The synchronous body of `start_watching` (runs inside `spawn_blocking`).
fn start_watching_blocking<R: Runtime>(
    app: &AppHandle<R>,
    watch_id: String,
    path: String,
) -> Result<(), CommandError> {
    let watch_path = Path::new(&path);
    if !watch_path.exists() {
        return Err(CommandError::not_found(format!(
            "Path does not exist: {path}"
        )));
    }

    // Stop any existing watcher for this watch_id first
    drop(take_watcher(&watch_id));

    let scope = WatchScope {
        watch_id: watch_id.clone(),
        root_path: path.clone(),
        // Resolved once: the spelling the OS will report events under.
        canonical_root: std::fs::canonicalize(watch_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.clone()),
    };
    let config = BatchConfig {
        watch_id: watch_id.clone(),
        root_path: path.clone(),
        window: batch::BATCH_WINDOW,
        max_changes: batch::MAX_BATCH_CHANGES,
    };

    let (signals, queue) = batch::signal_queue();
    let batch_app = app.clone();
    // Ends on its own when the watcher (and with it the queue's sender) drops.
    std::thread::Builder::new()
        .name("fs-watch-batch".to_string())
        .spawn(move || {
            batch::run_batch_loop(&queue, &config, |batch| emit_batch(&batch_app, &batch));
        })
        .map_err(|e| {
            CommandError::internal(format!("Failed to start watcher batch thread: {e}"))
        })?;

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if let Some(signal) = signal_for(result, &scope) {
                // Blocks while the queue is full; fails only once the batch
                // thread is gone, which means this watcher is being dropped.
                let _ = signals.send(signal);
            }
        },
        Config::default(),
    )
    .map_err(|e| CommandError::io(format!("Failed to create watcher: {e}")))?;

    watcher
        .watch(watch_path, RecursiveMode::Recursive)
        .map_err(|e| CommandError::io(format!("Failed to watch path: {e}")))?;

    let replaced = lock_watchers()
        .get_or_insert_with(HashMap::new)
        .insert(watch_id.clone(), WatcherEntry { _watcher: watcher });
    drop(replaced);

    // The window-destroyed cleanup may have run while this watcher was being
    // created. Tauri forgets a window before it reports the destruction, so a
    // label that no longer resolves here will never be stopped by anyone else.
    if app.get_webview_window(&watch_id).is_none() {
        drop(take_watcher(&watch_id));
        return Err(CommandError::conflict(format!(
            "Window '{watch_id}' closed before its watcher started"
        )));
    }

    Ok(())
}

/// Stop watching for a specific watch_id. Idempotent: an unknown id is fine.
#[tauri::command]
pub fn stop_watching(watch_id: String) -> Result<(), CommandError> {
    drop(take_watcher(&watch_id));
    Ok(())
}

#[cfg(test)]
#[path = "watcher.test.rs"]
mod tests;
