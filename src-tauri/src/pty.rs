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
//!   - Two-phase startup: `pty_spawn` creates the session (on the blocking
//!     pool — `openpty`/`spawn_command` are synchronous syscalls), `pty_start`
//!     begins the reader thread. The frontend wires the output Channel's
//!     `onmessage` and the `pty:exit:{pid}` listener before calling
//!     `pty_start`, so no output or exit signal is lost (no data-loss race).
//!   - Child exit is detected in the reader thread (after the read loop ends)
//!     via `child.wait()`, then emitted as a `pty:exit:{pid}` event.
//!   - Sessions are removed from the map via `pty_close` (called by the
//!     frontend after receiving the exit event) to prevent FD/memory leaks.
//!     A close BETWEEN spawn and start kills + reaps the still-owned child
//!     (no reader thread exists yet to `wait()` on it).
//!   - Writer and master use `std::sync::Mutex` (not tokio) because the
//!     underlying operations are plain syscalls, not async I/O. Writes still
//!     run inside `spawn_blocking`: `write_all` blocks when the PTY buffer is
//!     full (e.g. a large paste into a non-reading foreground process), and a
//!     blocked tokio worker would starve the runtime.
//!
//! @coordinates-with lib.rs — commands registered in generate_handler![]
//! @coordinates-with src/lib/pty.ts — frontend wrapper (output Channel + exit event)
//! @module pty

mod session;

pub use session::{kill_all, PtyState};

use crate::command_error::CommandError;
use portable_pty::PtySize;
use session::{get_session, PtyExitEvent};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

// WI-DP2.2 — the PTY command surface, typed. Three classes, and the reason each
// is what it is:
//
//   not-found  an unknown pid. The frontend polls these after a `pty:exit`
//              event, so "the session is gone" is an ordinary race, not a fault
//              — it must be distinguishable from a real failure.
//   io         the pty write/resize/kill itself failed. A real device error.
//   internal   a poisoned mutex or a tokio join failure: this process is in a
//              state it should not be able to reach, and no caller can act on
//              it. NOT the catch-all — ADR-2 forbids `internal` as a shortcut
//              for "unclassified", which is why the three above are separate.
fn session_gone(pid: u32) -> CommandError {
    CommandError::not_found(format!("unknown PTY session {pid}"))
}

fn pty_io(error: impl std::fmt::Display) -> CommandError {
    CommandError::io(error.to_string())
}

fn pty_internal(what: &str, error: impl std::fmt::Display) -> CommandError {
    CommandError::internal(format!("{what}: {error}"))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Create a PTY session and spawn the child process.
/// Returns the session PID. Call `pty_start` after registering event listeners.
///
/// The blocking pieces (`openpty`, `spawn_command`) run on the blocking pool
/// — see the module header's async-safety rules; only the session-map insert
/// touches the async runtime.
#[tauri::command]
pub async fn pty_spawn(
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    state: tauri::State<'_, PtyState>,
) -> Result<u32, CommandError> {
    let session = tokio::task::spawn_blocking(move || {
        session::create_session(file, args, cols, rows, cwd, env)
    })
    .await
    .map_err(|e| pty_internal("PTY spawn task failed", e))?
    .map_err(pty_io)?;

    let pid = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().await.insert(pid, Arc::new(session));
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
) -> Result<(), CommandError> {
    let session = get_session(&state, pid).await.map_err(|_| session_gone(pid))?;
    let mut reader = session
        .reader
        .lock()
        .await
        .take()
        .ok_or_else(|| CommandError::conflict("pty_start already called for this session"))?;
    let mut child = session
        .child
        .lock()
        .await
        .take()
        .ok_or_else(|| CommandError::conflict("pty_start already called for this session"))?;
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
                        // Kill the child too: on a fatal read error the shell may
                        // still be running, and the child.wait() below would then
                        // block this thread forever instead of reaping.
                        Err(e) => {
                            log::warn!(
                                "[pty] reader {pid_for_log} read error ({:?}): {e}",
                                e.kind(),
                            );
                            if let Ok(mut killer) = session_for_panic.child_killer.lock() {
                                let _ = killer.kill();
                            }
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
        .map_err(|e| pty_internal("failed to spawn PTY reader thread", e))?;

    Ok(())
}

/// Write data to the PTY.
///
/// The write runs on the blocking pool: a full PTY buffer makes `write_all`
/// block until the foreground process reads, which would otherwise pin a
/// tokio worker thread (and the writer mutex) for the duration.
#[tauri::command]
pub async fn pty_write(
    pid: u32,
    data: String,
    state: tauri::State<'_, PtyState>,
) -> Result<(), CommandError> {
    let session = get_session(&state, pid).await.map_err(|_| session_gone(pid))?;
    tokio::task::spawn_blocking(move || {
        let mut writer = session
            .writer
            .lock()
            .map_err(|e| pty_internal("PTY writer lock poisoned", e))?;
        writer.write_all(data.as_bytes()).map_err(pty_io)?;
        writer.flush().map_err(pty_io)
    })
    .await
    .map_err(|e| pty_internal("PTY write task failed", e))?
}

/// Resize the PTY.
#[tauri::command]
pub async fn pty_resize(
    pid: u32,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyState>,
) -> Result<(), CommandError> {
    let session = get_session(&state, pid).await.map_err(|_| session_gone(pid))?;
    let master = session
        .master
        .lock()
        .map_err(|e| pty_internal("PTY master lock poisoned", e))?;
    master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(pty_io)
}

/// Kill the PTY child process.
#[tauri::command]
pub async fn pty_kill(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), CommandError> {
    let session = get_session(&state, pid).await.map_err(|_| session_gone(pid))?;
    session.shutdown.store(true, Ordering::Release);
    session.pause_ctl.resume(); // Wake reader if paused
    let mut killer = session
        .child_killer
        .lock()
        .map_err(|e| pty_internal("PTY child-killer lock poisoned", e))?;
    killer.kill().map_err(pty_io)
}

/// Remove session from the map, freeing FDs and memory.
/// Called by the frontend after receiving the `pty:exit:{pid}` event — and
/// also legal between `pty_spawn` and `pty_start`, where the session still
/// owns the child: no reader thread exists to reap it, so close kills and
/// reaps it here (a bare map-remove would drop the child unreaped).
#[tauri::command]
pub async fn pty_close(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), CommandError> {
    let Some(session) = state.sessions.write().await.remove(&pid) else {
        return Ok(());
    };
    tokio::task::spawn_blocking(move || session::kill_and_reap_unstarted(&session))
        .await
        .map_err(|e| pty_internal("PTY close task failed", e))
}

/// Pause the PTY reader (flow control).
#[tauri::command]
pub async fn pty_pause(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), CommandError> {
    let session = get_session(&state, pid).await.map_err(|_| session_gone(pid))?;
    session.pause_ctl.pause();
    Ok(())
}

/// Resume the PTY reader (flow control).
#[tauri::command]
pub async fn pty_resume(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), CommandError> {
    let session = get_session(&state, pid).await.map_err(|_| session_gone(pid))?;
    session.pause_ctl.resume();
    Ok(())
}
