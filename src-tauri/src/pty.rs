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
//!   - Output transport is a `tauri::ipc::Channel<InvokeResponseBody>`
//!     (ADR-T1): the reader sends `InvokeResponseBody::Raw(bytes)`, delivered to
//!     the webview as a binary `ArrayBuffer` (not a JSON number array) and
//!     point-to-point (no `app.emit` broadcast to every window).
//!   - Pause/resume uses `Condvar` so a paused reader truly sleeps (zero CPU)
//!     instead of busy-waiting.
//!   - The reader is interruptible (`output.rs`): it waits on the master and a
//!     wake socket, so a session can always be stopped — a blocking read would
//!     hold the thread for as long as ANY process keeps the terminal open.
//!   - Two-phase startup: `pty_spawn` creates the session (on the blocking
//!     pool — `openpty`/`spawn_command` are synchronous syscalls), `pty_start`
//!     begins the reader thread. The frontend wires the output Channel's
//!     `onmessage` and the `pty:exit:{pid}` listener before calling
//!     `pty_start`, so no output or exit signal is lost (no data-loss race).
//!   - Child exit is detected in the reader thread once the output ends, or
//!     while the terminal is idle (something else can hold it open after the
//!     shell is gone); the shell is reaped there and its code emitted as a
//!     `pty:exit:{pid}` event.
//!   - Sessions are removed from the map via `pty_close` (called by the
//!     frontend after receiving the exit event) to prevent FD/memory leaks.
//!     Each session records the window that spawned it, and that window's
//!     `Destroyed` event terminates whatever is left (`close_window_sessions`):
//!     a dying webview never gets to call `pty_close`.
//!   - Every teardown path — `pty_kill`, `pty_close`, window destroy, quit —
//!     runs the same escalation: hang the shell's process group up, wait a
//!     bounded grace, kill it, reap it. It is the same whether or not
//!     `pty_start` ever ran, because the session owns the shell for its whole
//!     life (`child.rs`).
//!   - Writer and master use `std::sync::Mutex` (not tokio) because the
//!     underlying operations are plain syscalls, not async I/O. Writes still
//!     run inside `spawn_blocking`: a full PTY buffer (a large paste into a
//!     non-reading foreground process) makes a write wait, and a waiting tokio
//!     worker would starve the runtime. The wait is bounded and a stop ends it
//!     (`input.rs`).
//!
//! Module layout: this file holds the seven short commands (`pty_spawn`,
//! `pty_write`, `pty_resize`, `pty_kill`, `pty_close`, `pty_pause`,
//! `pty_resume`) and their shared error helpers. `pty_start` and its reader
//! thread live in `reader.rs` — it was longer than the other seven together
//! and pushed this file past the file-size gate (WI-DP2.5). `session.rs` owns
//! the session map, `terminate` and `PtyExitEvent`; `child.rs` the shell and
//! its escalating stop; `output.rs` the interruptible read side; `pause.rs`
//! the pause condvar; `spawn_policy.rs` what `pty_spawn` will run at all;
//! `window_sessions.rs` reaps a destroyed window's sessions.
//!
//! @coordinates-with lib.rs — commands registered in generate_handler![]
//! @coordinates-with pty/reader.rs — `pty_start`; registered as
//!   `pty::reader::pty_start` because `#[tauri::command]` generates a sibling
//!   macro that a function-only re-export does not carry
//! @coordinates-with src/lib/pty.ts — frontend wrapper (output Channel + exit event)
//! @module pty

mod child;
pub mod code_block;
mod input;
mod output;
mod pause;
pub mod reader;
mod session;
mod spawn_policy;
mod window_sessions;

pub use session::{kill_all, PtyState};
pub use window_sessions::close_window_sessions;

use crate::command_error::CommandError;
use portable_pty::PtySize;
use session::get_session;
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Manager;

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
/// The request is the webview's, so it goes through the spawn policy first: a
/// shell VMark offers, the arguments its integration uses, environment keys
/// from a closed list — anything else is refused (`spawn_policy.rs`).
///
/// The blocking pieces (shell discovery, `openpty`, `spawn_command`) run on
/// the blocking pool — see the module header's async-safety rules; only the
/// session-map insert touches the async runtime.
#[tauri::command]
pub async fn pty_spawn(
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    // The spawning window owns the session (reaped when it is destroyed —
    // `window_sessions.rs`); the map is reached through it rather than a
    // `State` parameter, which would push this command past clippy's
    // argument limit.
    window: tauri::Window,
) -> Result<u32, CommandError> {
    let owner = window.label().to_string();
    let app = window.app_handle().clone();
    let session = tokio::task::spawn_blocking(move || {
        let command = spawn_policy::vet(
            spawn_policy::ShellSource::system(),
            file,
            args,
            env,
            |shell| integration_args(shell, &app),
        )?;
        session::create_session(owner, command, cols, rows, cwd.as_deref()).map_err(pty_io)
    })
    .await
    .map_err(|e| pty_internal("PTY spawn task failed", e))??;

    let state = window.state::<PtyState>();
    let pid = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().await.insert(pid, Arc::new(session));
    Ok(pid)
}

/// The arguments shell integration gives `shell` — the only ones a spawn of it
/// may carry. Asked of the integration itself, so the two cannot drift; called
/// by the policy only for a shell it has already accepted, because preparing
/// integration may run that shell.
///
/// Blocking: call from the blocking pool, never on a tokio worker.
fn integration_args<R: tauri::Runtime>(
    shell: &str,
    app: &tauri::AppHandle<R>,
) -> Result<Vec<String>, CommandError> {
    let prepared =
        crate::shell_integration::prepare_shell_integration(shell.to_string(), app.clone());
    let integration = tauri::async_runtime::block_on(prepared).map_err(pty_io)?;
    Ok(integration
        .map(|integration| integration.args)
        .unwrap_or_default())
}

/// Write data to the PTY.
///
/// On the blocking pool, and bounded (`pty/input.rs`): a full terminal input
/// queue waits for the foreground program to read, but a stop ends the wait
/// and a program that takes nothing for `STALL_LIMIT` fails the write with
/// `io`, saying how much went through.
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
        input::write_input(&session, data.as_bytes(), input::STALL_LIMIT).map_err(pty_io)
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

/// End the PTY's shell and stop its reader. The session stays in the map until
/// `pty_close`. Returns once the shell is gone, which takes the grace period
/// when it ignores the hangup.
#[tauri::command]
pub async fn pty_kill(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), CommandError> {
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
    tokio::task::spawn_blocking(move || session::terminate(&[session]))
        .await
        .map_err(|e| pty_internal("PTY kill task failed", e))
}

/// Remove the session from the map and end it, freeing FDs and memory.
/// Called by the frontend after receiving the `pty:exit:{pid}` event, where
/// there is nothing left to end — but legal at any point: a session that is
/// still running, started or not, has its shell terminated and reaped here,
/// so a close can never leave a shell behind.
#[tauri::command]
pub async fn pty_close(pid: u32, state: tauri::State<'_, PtyState>) -> Result<(), CommandError> {
    let Some(session) = state.sessions.write().await.remove(&pid) else {
        return Ok(());
    };
    tokio::task::spawn_blocking(move || session::terminate(&[session]))
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

// Unix-only: the tests spawn `/bin/sh` and probe pids and descriptors.
#[cfg(all(test, unix))]
#[path = "pty/commands.test.rs"]
mod command_tests;
#[cfg(all(test, unix))]
#[path = "pty/lifecycle.test.rs"]
mod lifecycle_tests;
#[cfg(all(test, unix))]
#[path = "pty/support.test.rs"]
mod test_support;
