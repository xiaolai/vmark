//! PTY process management — async-safe replacement for tauri-plugin-pty.
//!
//! Purpose: Spawns and manages pseudo-terminal sessions for VMark's built-in
//! terminal. Each PTY reader runs on a dedicated OS thread so blocking I/O
//! never starves the tokio async runtime. Output bytes are pushed to the
//! frontend over a per-session binary `Channel`; the exit signal is a Tauri
//! event. Neither path polls.
//!
//! Key decisions:
//!   - Reader threads are plain `std::thread`, NOT `tokio::spawn_blocking`.
//!     PTY reads are long-lived (lifetime of the shell), so they should not
//!     consume the tokio blocking thread pool.
//!   - Output transport is a `tauri::ipc::Channel<InvokeResponseBody>` (WI-1.1,
//!     ADR-T1): the reader sends `InvokeResponseBody::Raw(bytes)`, delivered to
//!     the webview as a binary `ArrayBuffer` (not a JSON number array) and
//!     point-to-point (no `app.emit` broadcast to every window).
//!   - Pause/resume uses `Condvar` so a paused reader truly sleeps (zero CPU)
//!     instead of busy-waiting.
//!   - Two-phase startup: `pty_spawn` creates the session, `pty_start` begins
//!     the reader thread. The frontend wires the output Channel's `onmessage`
//!     and the `pty:exit:{pid}` listener before calling `pty_start`, so no
//!     output or exit signal is lost (no data-loss race).
//!   - Child exit is detected in the reader thread (after the read loop ends)
//!     via `child.wait()`, then emitted as a `pty:exit:{pid}` event.
//!   - Sessions are removed from the map via `pty_close` (called by the
//!     frontend after receiving the exit event) to prevent FD/memory leaks.
//!   - Writer and master use `std::sync::Mutex` (not tokio) because the
//!     underlying operations are fast syscalls, not async I/O.
//!
//! @coordinates-with lib.rs — commands registered in generate_handler![]
//! @coordinates-with src/lib/pty.ts — frontend wrapper (output Channel + exit event)
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
        *self.paused.lock().unwrap_or_else(|p| p.into_inner()) = true;
    }

    fn resume(&self) {
        *self.paused.lock().unwrap_or_else(|p| p.into_inner()) = false;
        self.cond.notify_one();
    }

    /// Block the calling thread until unpaused. No-op when not paused.
    fn wait_if_paused(&self) {
        let mut guard = self.paused.lock().unwrap_or_else(|p| p.into_inner());
        while *guard {
            guard = self.cond.wait(guard).unwrap_or_else(|p| p.into_inner());
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

impl Drop for PtyState {
    fn drop(&mut self) {
        // Kill all active PTY child processes on app exit so they don't become
        // orphans. get_mut() is safe here because Drop receives &mut self.
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
/// Must be called exactly once per session, after the caller has wired the
/// `on_bytes` Channel and the `pty:exit:{pid}` listener.
/// Sends output bytes over `on_bytes` (Raw → ArrayBuffer); emits
/// `pty:exit:{pid}` on child exit.
#[tauri::command]
pub async fn pty_start<R: Runtime>(
    pid: u32,
    on_bytes: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
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

    let exit_event = format!("pty:exit:{pid}");

    // Reader thread body wrapped in catch_unwind so a panic doesn't crash
    // the whole process. We must keep the explicit thread name (`pty-reader-{pid}`)
    // for log filtering, so we use Builder directly rather than spawn_thread_logged.
    //
    // `child.wait()` and the exit emit live OUTSIDE the catch_unwind below so
    // they run on BOTH the normal and the (defensive) panic path — the child is
    // always reaped, never a zombie, and the frontend always gets its exit.
    let session_for_panic = session.clone();
    std::thread::Builder::new()
        .name(format!("pty-reader-{pid}"))
        .spawn(move || {
            let pid_for_log = pid;
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // 64 KB buffer (WI-1.2): far fewer reads/sends per burst than the
                // old 4 KB, which compounds with the binary Channel (WI-1.1).
                let mut buf = vec![0u8; 65536];
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
                            // Send raw bytes over the per-session Channel. Raw →
                            // ArrayBuffer in the webview (WI-1.1), point-to-point
                            // (no app.emit broadcast → closes T2). A send error
                            // means the webview/channel is gone; kill the child so
                            // the child.wait() below returns instead of hanging on
                            // a still-running shell, then stop reading.
                            if on_bytes
                                .send(tauri::ipc::InvokeResponseBody::Raw(buf[..n].to_vec()))
                                .is_err()
                            {
                                if let Ok(mut killer) = session_for_panic.child_killer.lock() {
                                    let _ = killer.kill();
                                }
                                break;
                            }
                        }
                        // EINTR is transient (signal during read) — retry rather
                        // than treat it as EOF and prematurely end the session.
                        Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                        // Any other read error ends the session. Log it before
                        // breaking so a terminal that dies on a read error leaves
                        // a diagnostic (WI-4.3 / G8) instead of vanishing silently.
                        Err(e) => {
                            log::warn!(
                                "[pty] reader {pid_for_log} read error ({:?}): {e}",
                                e.kind(),
                            );
                            break;
                        }
                    }
                }
            }));
            // On panic the read loop bailed early and the shell may still be
            // running — kill it so the wait() below returns instead of blocking.
            // (The loop has no panic-able operation; this is defense in depth.)
            if let Err(payload) = result {
                log::error!(
                    "[task:pty-reader-{}] reader thread panicked: {}",
                    pid_for_log,
                    crate::task::panic_payload_message(&payload),
                );
                if let Ok(mut killer) = session_for_panic.child_killer.lock() {
                    let _ = killer.kill();
                }
            }
            // Reap the child and emit exit on BOTH the normal and panic paths —
            // guarantees no zombie even if the reader panicked (audit follow-up).
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
    writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
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
            rows: rows.max(1),
            cols: cols.max(1),
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
