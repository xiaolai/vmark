//! PTY process management — async-safe replacement for tauri-plugin-pty.
//!
//! Purpose: Spawns and manages pseudo-terminal sessions for VMark's built-in
//! terminal. Each PTY reader runs on a dedicated OS thread so blocking I/O
//! never starves the tokio async runtime. Data is pushed to the frontend via
//! Tauri events instead of polling.
//!
//! Key decisions:
//!   - Reader threads are plain `std::thread`, NOT `tokio::spawn_blocking`.
//!     PTY reads are long-lived (lifetime of the shell), so they should not
//!     consume the tokio blocking thread pool.
//!   - Pause/resume uses `Condvar` so a paused reader truly sleeps (zero CPU)
//!     instead of busy-waiting.
//!   - Two-phase startup: `pty_spawn` creates the session, `pty_start` begins
//!     the reader thread. The frontend registers event listeners between the
//!     two calls, eliminating data-loss races.
//!   - Child exit is detected in the reader thread (after the read loop ends)
//!     via `child.wait()`, then emitted as a `pty:exit:{pid}` event.
//!   - Sessions are removed from the map via `pty_close` (called by the
//!     frontend after receiving the exit event) to prevent FD/memory leaks.
//!   - Writer and master use `std::sync::Mutex` (not tokio) because the
//!     underlying operations are fast syscalls, not async I/O.
//!
//! @coordinates-with lib.rs — commands registered in generate_handler![]
//! @coordinates-with src/lib/pty.ts — frontend wrapper that consumes these events
//! @module pty

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{Mutex, RwLock};

// ---------------------------------------------------------------------------
// Flow control
// ---------------------------------------------------------------------------

struct PauseControl {
    paused: StdMutex<bool>,
    cond: Condvar,
}

impl PauseControl {
    fn new() -> Self {
        Self {
            paused: StdMutex::new(false),
            cond: Condvar::new(),
        }
    }

    fn pause(&self) {
        *self.paused.lock().unwrap() = true;
    }

    fn resume(&self) {
        *self.paused.lock().unwrap() = false;
        self.cond.notify_one();
    }

    /// Block the calling thread until unpaused. No-op when not paused.
    fn wait_if_paused(&self) {
        let mut guard = self.paused.lock().unwrap();
        while *guard {
            guard = self.cond.wait(guard).unwrap();
        }
    }
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

struct Session {
    reader: Mutex<Option<Box<dyn Read + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    child_killer: StdMutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: StdMutex<Box<dyn Write + Send>>,
    master: StdMutex<Box<dyn MasterPty + Send>>,
    pause_ctl: Arc<PauseControl>,
    shutdown: Arc<AtomicBool>,
}

pub struct PtyState {
    next_id: AtomicU32,
    sessions: RwLock<BTreeMap<u32, Arc<Session>>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: RwLock::new(BTreeMap::new()),
        }
    }
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct PtyExitEvent {
    exit_code: u32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn get_session(state: &PtyState, pid: u32) -> Result<Arc<Session>, String> {
    state
        .sessions
        .read()
        .await
        .get(&pid)
        .cloned()
        .ok_or_else(|| format!("Unknown PTY session {pid}"))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Create a PTY session and spawn the child process.
/// Returns the session PID. Call `pty_start` after registering event listeners.
#[tauri::command]
pub async fn pty_spawn(
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    state: tauri::State<'_, PtyState>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

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

    let pid = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = Arc::new(Session {
        reader: Mutex::new(Some(reader)),
        child: Mutex::new(Some(child)),
        child_killer: StdMutex::new(child_killer),
        writer: StdMutex::new(writer),
        master: StdMutex::new(pair.master),
        pause_ctl: Arc::new(PauseControl::new()),
        shutdown: Arc::new(AtomicBool::new(false)),
    });
    state.sessions.write().await.insert(pid, session);
    Ok(pid)
}

/// Start the reader thread for a PTY session.
/// Must be called exactly once per session, after event listeners are ready.
/// Emits `pty:data:{pid}` for output and `pty:exit:{pid}` on child exit.
#[tauri::command]
pub async fn pty_start<R: Runtime>(
    pid: u32,
    state: tauri::State<'_, PtyState>,
    app: AppHandle<R>,
) -> Result<(), String> {
    let session = get_session(&state, pid).await?;
    let mut reader = session
        .reader
        .lock()
        .await
        .take()
        .ok_or("pty_start already called for this session")?;
    let mut child = session
        .child
        .lock()
        .await
        .take()
        .ok_or("pty_start already called for this session")?;
    let pause_ctl = session.pause_ctl.clone();
    let shutdown = session.shutdown.clone();

    let data_event = format!("pty:data:{pid}");
    let exit_event = format!("pty:exit:{pid}");

    std::thread::Builder::new()
        .name(format!("pty-reader-{pid}"))
        .spawn(move || {
            let mut buf = vec![0u8; 4096];
            loop {
                if shutdown.load(Ordering::Acquire) {
                    break;
                }
                pause_ctl.wait_if_paused();
                if shutdown.load(Ordering::Acquire) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = app.emit(&data_event, buf[..n].to_vec());
                    }
                    Err(_) => break,
                }
            }
            let exit_code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            let _ = app.emit(&exit_event, PtyExitEvent { exit_code });
        })
        .map_err(|e| format!("Failed to spawn reader thread: {e}"))?;

    Ok(())
}

/// Write data to the PTY.
#[tauri::command]
pub async fn pty_write(
    pid: u32,
    data: String,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let session = get_session(&state, pid).await?;
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

/// Resize the PTY.
#[tauri::command]
pub async fn pty_resize(
    pid: u32,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let session = get_session(&state, pid).await?;
    let master = session.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Kill the PTY child process.
#[tauri::command]
pub async fn pty_kill(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let session = get_session(&state, pid).await?;
    session.shutdown.store(true, Ordering::Release);
    session.pause_ctl.resume(); // Wake reader if paused
    let mut killer = session.child_killer.lock().map_err(|e| e.to_string())?;
    killer.kill().map_err(|e| e.to_string())
}

/// Remove session from the map, freeing FDs and memory.
/// Called by the frontend after receiving the `pty:exit:{pid}` event.
#[tauri::command]
pub async fn pty_close(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    state.sessions.write().await.remove(&pid);
    Ok(())
}

/// Pause the PTY reader (flow control).
#[tauri::command]
pub async fn pty_pause(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let session = get_session(&state, pid).await?;
    session.pause_ctl.pause();
    Ok(())
}

/// Resume the PTY reader (flow control).
#[tauri::command]
pub async fn pty_resume(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let session = get_session(&state, pid).await?;
    session.pause_ctl.resume();
    Ok(())
}
