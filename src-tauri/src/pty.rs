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
//! Module layout: this file holds the eight short commands (`pty_spawn`,
//! `pty_write`, `pty_resize`, `pty_kill`, `pty_close`, `pty_pause`,
//! `pty_resume`) and their shared error helpers. `pty_start` and its reader
//! thread live in `reader.rs` — it was longer than the other eight together
//! and pushed this file past the file-size gate (WI-DP2.5). `session.rs` owns
//! the session map and `PtyExitEvent`.
//!
//! @coordinates-with lib.rs — commands registered in generate_handler![]
//! @coordinates-with pty/reader.rs — `pty_start`; registered as
//!   `pty::reader::pty_start` because `#[tauri::command]` generates a sibling
//!   macro that a function-only re-export does not carry
//! @coordinates-with src/lib/pty.ts — frontend wrapper (output Channel + exit event)
//! @module pty

pub mod reader;
mod session;

pub use session::{kill_all, PtyState};

use crate::command_error::CommandError;
use portable_pty::PtySize;
use session::get_session;
use std::collections::BTreeMap;
use std::io::Write;
use std::sync::atomic::Ordering;
use std::sync::Arc;

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
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
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
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
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
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
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
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
    session.pause_ctl.pause();
    Ok(())
}

/// Resume the PTY reader (flow control).
#[tauri::command]
pub async fn pty_resume(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), CommandError> {
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
    session.pause_ctl.resume();
    Ok(())
}
