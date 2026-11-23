//! Linux: give a window that was closed, quit or crashed in full screen back
//! its normal size on the next launch (#1723). A child of
//! `menu/events/fullscreen.rs`; the rules are the pure
//! `fullscreen_geometry.rs`, the GTK signals are `fullscreen_gtk.rs`.
//!
//! The plugin gap: tauri-plugin-window-state 2.5.0 stops caching a window's
//! size and position while it is maximized or minimized, but not while it is
//! full screen — neither in its `Resized`/`Moved` handlers nor in
//! `update_state` (run on CloseRequested and by the exit save). On Linux
//! entering full screen resizes the window to the monitor, so the plugin
//! saves that as the normal size and the next launch opens a monitor-sized
//! window that is not full screen (FULLSCREEN itself is not restored on
//! Linux — `app_plugins.rs`). Delete this module, its plugin registration
//! and `fullscreen_geometry.rs` once the plugin treats full screen like
//! maximized upstream.
//!
//! Workaround:
//!   - Each window's latest normal geometry is kept in memory from GTK
//!     `configure-event`s seen while GTK reports it neither full screen,
//!     maximized nor minimized (`NormalHistory` says which samples count).
//!   - When GTK reports the window entering full screen — F11 or the
//!     compositor alike — its normal geometry is written to [`RECORDS_FILE`]
//!     in the app config dir, next to the plugin's own file.
//!   - A record is retired only at a clean exit, and only once the plugin's
//!     file holds the window's latest normal size: the plugin writes its file
//!     only at exit, so until then a crash leaves its old, possibly
//!     monitor-sized, state on disk. This plugin is registered after the
//!     window-state plugin and Tauri runs plugin hooks in registration
//!     order, so its exit hook reads the plugin's file after the save.
//!   - On `on_window_ready` for a label with a record, after the plugin's
//!     restore for the same reason, the record is applied. The resize then
//!     reaches the plugin's cache like any other.
//!   - Records are re-read before every change, so a second Linux instance
//!     (possible without a session bus) loses at most a race, not its file;
//!     a file that exists but cannot be read is left alone. A missing or
//!     damaged file means no records; nothing here can stop a window from
//!     opening.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

use tauri::{Manager, PhysicalPosition, PhysicalSize, RunEvent};

use super::geometry::{
    on_any_monitor, parse_records, parse_saved_sizes, record_entry, retire_at_exit,
    serialize_records, Geometry, MonitorRect, NormalHistory, Records, RECORDS_FILE,
};
use crate::app_plugins::WINDOW_STATE_DENYLIST;
use crate::bounded_read::{read_regular_bounded, BoundedReadError};

/// The most a records file may hold. Each record is a few hundred bytes, so
/// this is far past any real file while still bounding what an untrusted
/// file can make us read into memory.
const RECORDS_MAX_BYTES: u64 = 1_048_576;

static RECORDS_PATH: OnceLock<PathBuf> = OnceLock::new();
/// The normal geometry of every window seen this run, by label. Kept after
/// a window closes, for the exit check; reset when a window reuses a label.
static HISTORY: Mutex<Option<HashMap<String, NormalHistory>>> = Mutex::new(None);

fn lock<T>(m: &'static Mutex<T>) -> MutexGuard<'static, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Take an exclusive `flock` on a `.lock` file beside the records file, so two
/// instances sharing the config dir cannot interleave a read-modify-write. The
/// lock is released when the returned `File` drops. `None` when the lock file
/// cannot be opened or locked: the in-process mutex still serialises this
/// process, and a second instance is a rare, best-effort case.
fn flock_records(records: &std::path::Path) -> Option<std::fs::File> {
    use std::os::unix::io::AsRawFd;
    let path = records.with_extension("lock");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&path)
        .ok()?;
    // SAFETY: `file` owns the fd; the lock is released when it drops.
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if rc != 0 {
        log::warn!(
            "[fullscreen] could not lock {path:?}: {}",
            std::io::Error::last_os_error()
        );
        return None;
    }
    Some(file)
}

/// Windows the window-state plugin restores; no others get a record.
fn tracked(label: &str) -> bool {
    !WINDOW_STATE_DENYLIST.contains(&label)
}

/// Run `f` on the records as they are on disk now, then write them back if
/// it reports a change. `None` when the file exists but cannot be read: it
/// is then left alone. The mutex serializes this process's windows and the
/// flock serializes across instances.
fn update_records<T>(f: impl FnOnce(&mut Records) -> (T, bool)) -> Option<T> {
    static FILE: Mutex<()> = Mutex::new(());
    let _file = lock(&FILE);
    let path = RECORDS_PATH.get()?;
    let _iplock = flock_records(path);
    let mut records = match read_regular_bounded(path, RECORDS_MAX_BYTES) {
        Ok(raw) => parse_records(&raw),
        Err(BoundedReadError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Records::new(),
        Err(e) => {
            log::warn!("[fullscreen] could not read {RECORDS_FILE}: {e:?}");
            return None;
        }
    };
    let (out, changed) = f(&mut records);
    if changed {
        if let Err(e) = persist(path, &records) {
            log::warn!("[fullscreen] could not write {RECORDS_FILE}: {e}");
        }
    }
    Some(out)
}

fn persist(path: &std::path::Path, records: &Records) -> Result<(), String> {
    if records.is_empty() {
        return match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    crate::app_paths::atomic_write_file(path, &serialize_records(records))
}

fn geometry_of(window: &tauri::Window) -> Option<Geometry> {
    let size = window.inner_size().ok()?;
    let position = window.outer_position().ok()?;
    Some(Geometry {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
    })
}

fn monitors_of(window: &tauri::Window) -> Vec<MonitorRect> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect()
}

/// GTK configured `window` while reporting it neither full screen,
/// maximized nor minimized.
pub(super) fn note_normal_configure(window: &tauri::Window) {
    if let Some(g) = geometry_of(window) {
        push_normal(window.label(), g, &monitors_of(window));
    }
}

fn push_normal(label: &str, g: Geometry, monitors: &[MonitorRect]) {
    lock(&HISTORY)
        .get_or_insert_with(HashMap::new)
        .entry(label.to_string())
        .or_default()
        .push(g, monitors);
}

/// GTK reported `window` entering (`true`) or leaving full screen.
pub(super) fn note_fullscreen_state(window: &tauri::Window, fullscreen: bool) {
    let label = window.label();
    if !tracked(label) {
        return;
    }
    if !fullscreen {
        return;
    }
    let before = lock(&HISTORY)
        .as_ref()
        .and_then(|map| map.get(label))
        .and_then(|h| h.normal);
    update_records(|records| ((), record_entry(records, label, before)));
}

/// A window was created: apply its record, if it has one.
fn on_ready(window: &tauri::Window) {
    let label = window.label();
    if !tracked(label) {
        return;
    }
    // A new window under this label: its history starts from what it has.
    let monitors = monitors_of(window);
    lock(&HISTORY)
        .get_or_insert_with(HashMap::new)
        .insert(label.to_string(), NormalHistory::default());
    let record = update_records(|records| (records.get(label).copied(), false)).flatten();
    let Some(g) = record else {
        if let Some(current) = geometry_of(window) {
            push_normal(label, current, &monitors);
        }
        return;
    };
    // Position first, as the plugin does; a monitor that is gone leaves the
    // placement to the window manager.
    if on_any_monitor(g, &monitors) {
        if let Err(e) = window.set_position(PhysicalPosition::new(g.x, g.y)) {
            log::warn!("[fullscreen] could not restore {label:?} position: {e}");
        }
    }
    if let Err(e) = window.set_size(PhysicalSize::new(g.width, g.height)) {
        log::warn!("[fullscreen] could not restore {label:?} size: {e}");
    }
    // The geometry just requested is this window's normal one, even if no
    // configure confirms it before the window goes full screen again.
    push_normal(label, g, &monitors);
    log::debug!("[fullscreen] restored {label:?} to its pre-full-screen geometry {g:?}");
}

/// The plugin's exit save has run: retire the records it saved over.
fn retire_superseded(app: &tauri::AppHandle) {
    use tauri_plugin_window_state::AppHandleExt;
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let saved = std::fs::read(dir.join(app.filename()))
        .map(|raw| parse_saved_sizes(&raw))
        .unwrap_or_default();
    let normal: HashMap<String, Geometry> = lock(&HISTORY)
        .iter()
        .flatten()
        .filter_map(|(label, h)| Some((label.clone(), h.normal?)))
        .collect();
    update_records(|records| ((), retire_at_exit(records, &normal, &saved)));
}

/// Watches every window's full-screen state, applies records on window
/// creation and retires them at a clean exit. Register directly after the
/// window-state plugin.
pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("fullscreen-geometry")
        .setup(|app, _api| {
            match app.path().app_config_dir() {
                Ok(dir) => {
                    let _ = RECORDS_PATH.set(dir.join(RECORDS_FILE));
                }
                Err(e) => log::warn!("[fullscreen] no app config dir for {RECORDS_FILE}: {e}"),
            }
            Ok(())
        })
        .on_window_ready(|window| {
            // Every window, so a compositor-initiated full screen is seen too.
            super::gtk_watch::ensure_watched(&window);
            on_ready(&window);
        })
        .on_event(|app, event| {
            if let RunEvent::Exit = event {
                retire_superseded(app);
            }
        })
        .build()
}
