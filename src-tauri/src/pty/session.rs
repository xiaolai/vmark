//! PTY session state — flow control, session registry, and quit-time cleanup.
//!
//! Moved out of `pty.rs` (the command surface); see that module's header for
//! the design decisions. Contains the `PauseControl` condvar, the per-session
//! `Session` record and its blocking `create_session` /
//! `kill_and_reap_unstarted` lifecycle helpers, the managed `PtyState` map
//! (with its `Drop` fallback), and the explicit quit-path `kill_all`.

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex as StdMutex};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::{Mutex, RwLock};

// ---------------------------------------------------------------------------
// Flow control
// ---------------------------------------------------------------------------

pub(super) struct PauseControl {
    paused: StdMutex<bool>,
    cond: Condvar,
}

impl PauseControl {
    pub(super) fn new() -> Self {
        Self {
            paused: StdMutex::new(false),
            cond: Condvar::new(),
        }
    }

    pub(super) fn pause(&self) {
        *self.paused.lock().unwrap_or_else(|p| p.into_inner()) = true;
    }

    pub(super) fn resume(&self) {
        *self.paused.lock().unwrap_or_else(|p| p.into_inner()) = false;
        self.cond.notify_one();
    }

    /// Block the calling thread until unpaused. No-op when not paused.
    pub(super) fn wait_if_paused(&self) {
        let mut guard = self.paused.lock().unwrap_or_else(|p| p.into_inner());
        while *guard {
            guard = self.cond.wait(guard).unwrap_or_else(|p| p.into_inner());
        }
    }
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

pub(super) struct Session {
    pub(super) reader: Mutex<Option<Box<dyn Read + Send>>>,
    pub(super) child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    pub(super) child_killer: StdMutex<Box<dyn ChildKiller + Send + Sync>>,
    pub(super) writer: StdMutex<Box<dyn Write + Send>>,
    pub(super) master: StdMutex<Box<dyn MasterPty + Send>>,
    pub(super) pause_ctl: Arc<PauseControl>,
    pub(super) shutdown: Arc<AtomicBool>,
}

/// Create the PTY pair, validate + spawn the shell, and assemble a `Session`.
///
/// Blocking (`openpty` / `spawn_command` are synchronous syscalls) — call
/// from `spawn_blocking` or a plain thread, never directly on a tokio worker.
pub(super) fn create_session(
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
) -> Result<Session, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            // Clamp to ≥1: a 0 dimension yields an invalid/degenerate PTY.
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Defense-in-depth: validate that the shell is an absolute path to an
    // existing executable.  The frontend is trusted, but if the webview were
    // compromised this prevents spawning arbitrary binaries.
    let shell_path = std::path::Path::new(&file);
    if !shell_path.is_absolute() {
        return Err("Shell must be an absolute path".into());
    }
    if !shell_path.exists() {
        return Err(format!("Shell not found: {}", file));
    }

    let mut cmd = CommandBuilder::new(&file);
    cmd.args(args);
    if let Some(ref d) = cwd {
        cmd.cwd(d);
    }
    for (k, v) in &env {
        cmd.env(k, v);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let child_killer = child.clone_killer();
    // Close the slave fd — the child has its own copy.
    // This ensures the reader gets EOF when the child exits.
    drop(pair.slave);

    Ok(Session {
        reader: Mutex::new(Some(reader)),
        child: Mutex::new(Some(child)),
        child_killer: StdMutex::new(child_killer),
        writer: StdMutex::new(writer),
        master: StdMutex::new(pair.master),
        pause_ctl: Arc::new(PauseControl::new()),
        shutdown: Arc::new(AtomicBool::new(false)),
    })
}

/// Kill and reap a child the session still owns — i.e. `pty_start` never ran,
/// so no reader thread will ever `wait()` on it. No-op once child ownership
/// moved to the reader thread (which reaps on both its normal and panic
/// paths).
///
/// Blocking (`wait()` + `blocking_lock`) — call from `spawn_blocking` or a
/// plain thread, never directly on a tokio worker.
pub(super) fn kill_and_reap_unstarted(session: &Session) {
    session.shutdown.store(true, Ordering::Release);
    session.pause_ctl.resume();
    if let Some(mut child) = session.child.blocking_lock().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub struct PtyState {
    pub(super) next_id: AtomicU32,
    pub(super) sessions: RwLock<BTreeMap<u32, Arc<Session>>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: RwLock::new(BTreeMap::new()),
        }
    }
}

impl Drop for PtyState {
    fn drop(&mut self) {
        // Belt-and-braces fallback for the rare paths where the state value is
        // actually dropped (tests, a future non-`process::exit` teardown). The
        // normal quit path never runs this — `app.exit` ends the process
        // without dropping managed state — so quit-time orphan prevention is
        // the explicit `kill_all` call on the quit path.
        // get_mut() is safe here because Drop receives &mut self.
        let sessions = std::mem::take(self.sessions.get_mut());
        for (pid, session) in sessions {
            session.shutdown.store(true, Ordering::Release);
            session.pause_ctl.resume();
            // We only hold the `ChildKiller` here; the `Child` itself was moved
            // into the reader thread in `pty_start` (and `ChildKiller` does not
            // expose `wait()`). Reaping is therefore intentionally NOT done here:
            // the kill makes the reader's `read()` return, its loop breaks, and
            // the reader thread's `child.wait()` reaps the child — no zombie, no
            // redundant wait at this site (WI-4.4 / G9).
            if let Ok(mut killer) = session.child_killer.lock() {
                if let Err(e) = killer.kill() {
                    log::warn!("[pty] Failed to kill PTY {pid} during cleanup: {e}");
                }
            }
        }
    }
}

/// Kill all live PTY child processes so they don't outlive the app.
///
/// Must be called explicitly on the quit path (`quit::finalize_quit` and the
/// `ExitRequested` → `AllowExit` branch): `app.exit` terminates the process
/// via `std::process::exit`, which never drops Tauri-managed state, so
/// `PtyState`'s `Drop` cannot be relied on at quit. Reaping is left to each
/// session's reader thread (`child.wait()` after the kill), matching `Drop`.
/// Call only from a non-async context (the main-thread quit path) —
/// `blocking_read` panics inside a tokio runtime.
pub fn kill_all<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<PtyState>() else {
        return;
    };
    let sessions = state.sessions.blocking_read();
    for (pid, session) in sessions.iter() {
        session.shutdown.store(true, Ordering::Release);
        session.pause_ctl.resume();
        if let Ok(mut killer) = session.child_killer.lock() {
            if let Err(e) = killer.kill() {
                log::warn!("[pty] Failed to kill PTY {pid} during quit cleanup: {e}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
pub(super) struct PtyExitEvent {
    pub(super) exit_code: u32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(super) async fn get_session(state: &PtyState, pid: u32) -> Result<Arc<Session>, String> {
    state
        .sessions
        .read()
        .await
        .get(&pid)
        .cloned()
        .ok_or_else(|| format!("Unknown PTY session {pid}"))
}

#[cfg(test)]
#[path = "session.test.rs"]
mod tests;
