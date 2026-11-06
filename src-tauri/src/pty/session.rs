//! PTY session state — the session registry and the one way a session ends.
//!
//! Moved out of `pty.rs` (the command surface); see that module's header for
//! the design decisions. Contains the per-session `Session` record with its
//! blocking `create_session` constructor, the `terminate` every teardown path
//! shares, the managed `PtyState` map (with its `Drop` fallback), and the
//! quit-path `kill_all`. The shell itself lives in `child.rs`, the
//! interruptible reader source in `output.rs`, the pause condvar in
//! `pause.rs`, what may be spawned at all in `spawn_policy.rs`, and
//! window-destroy cleanup in `window_sessions.rs`.

use super::child::{terminate_children, ChildSlot, HANGUP_GRACE};
use super::output::{self, Interrupter, OutputSource};
use super::pause::PauseControl;
use super::spawn_policy::VettedCommand;
use portable_pty::{native_pty_system, MasterPty, PtySize};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::RwLock;

/// How long `terminate` waits for an interrupted reader thread to finish. It
/// normally ends within milliseconds; the bound covers a reader stuck sending
/// to a webview that is going away.
const READER_JOIN_TIMEOUT: Duration = Duration::from_millis(2000);
const READER_JOIN_POLL: Duration = Duration::from_millis(5);

fn lock<T>(mutex: &StdMutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

pub(super) struct Session {
    /// Label of the window whose terminal spawned this session. Sessions never
    /// migrate between windows (moving a workspace instance kills its
    /// sessions), so this is fixed for the session's life.
    pub(super) owner: String,
    /// The shell. It stays here whether or not a reader runs, so every
    /// teardown path can signal and reap it the same way.
    pub(super) child: ChildSlot,
    /// The reader's source until `start_reader` hands it to the thread.
    output: StdMutex<Option<OutputSource>>,
    interrupter: Interrupter,
    reader: StdMutex<Option<JoinHandle<()>>>,
    pub(super) writer: StdMutex<Box<dyn Write + Send>>,
    pub(super) master: StdMutex<Box<dyn MasterPty + Send>>,
    pub(super) pause_ctl: PauseControl,
    pub(super) shutdown: AtomicBool,
    code_block_script: StdMutex<Option<tempfile::TempPath>>,
}

/// Why a reader thread could not be started.
pub(super) enum StartError {
    AlreadyStarted,
    Spawn(std::io::Error),
}

impl Session {
    /// Start the reader thread, handing it the session and its output source.
    /// The reader slot stays locked across the spawn, so a concurrent
    /// `terminate` sees either no reader or one it can join — never a thread
    /// that exists but is not recorded yet.
    pub(super) fn start_reader(
        self: &Arc<Self>,
        name: String,
        run: impl FnOnce(Arc<Session>, OutputSource) + Send + 'static,
    ) -> Result<(), StartError> {
        let mut reader = lock(&self.reader);
        let source = lock(&self.output)
            .take()
            .ok_or(StartError::AlreadyStarted)?;
        let session = Arc::clone(self);
        let handle = std::thread::Builder::new()
            .name(name)
            .spawn(move || run(session, source))
            .map_err(StartError::Spawn)?;
        *reader = Some(handle);
        Ok(())
    }

    /// Tell the reader to stop: raise the flag, then wake it from a pause and
    /// from a blocked read.
    fn request_stop(&self) {
        self.shutdown.store(true, Ordering::Release);
        self.pause_ctl.resume();
        self.interrupter.interrupt();
    }

    /// Wait, within a bound, for the reader thread to finish.
    fn join_reader(&self) {
        let Some(handle) = lock(&self.reader).take() else {
            return;
        };
        if handle.thread().id() == std::thread::current().id() {
            return;
        }
        let deadline = Instant::now() + READER_JOIN_TIMEOUT;
        while !handle.is_finished() {
            if Instant::now() >= deadline {
                log::error!(
                    "[pty] reader of shell {:?} (window {:?}) did not stop in time",
                    self.child.pid(),
                    self.owner
                );
                return;
            }
            std::thread::sleep(READER_JOIN_POLL);
        }
        if handle.join().is_err() {
            log::error!(
                "[pty] reader of shell {:?} (window {:?}) panicked",
                self.child.pid(),
                self.owner
            );
        }
    }
}

/// Stop the reader and end the shell of every session: hang up, bounded grace,
/// kill, reap. Blocking, but bounded however many sessions there are.
fn stop_shells(sessions: &[Arc<Session>]) {
    for session in sessions {
        session.request_stop();
    }
    let children: Vec<&ChildSlot> = sessions.iter().map(|session| &session.child).collect();
    terminate_children(&children, HANGUP_GRACE);
    for session in sessions {
        lock(&session.code_block_script).take();
    }
}

/// End sessions for good, started or not: stop their shells, then wait for
/// their reader threads. Once the last reference to a session is dropped after
/// this, its master descriptors close — even while an orphan still holds the
/// slave side open.
///
/// Blocking — call from `spawn_blocking` or a plain thread, never directly on
/// a tokio worker.
pub(super) fn terminate(sessions: &[Arc<Session>]) {
    stop_shells(sessions);
    for session in sessions {
        session.join_reader();
    }
}

/// Create the PTY pair, spawn the shell, and assemble a `Session`. The command
/// has already been through the spawn policy — a `VettedCommand` cannot be
/// built any other way.
///
/// Blocking (`openpty` / `spawn_command` are synchronous syscalls) — call
/// from `spawn_blocking` or a plain thread, never directly on a tokio worker.
pub(super) fn create_session(
    owner: String,
    command: VettedCommand,
    cols: u16,
    rows: u16,
    cwd: Option<&str>,
) -> Result<Session, String> {
    create_session_with_script(owner, command, cols, rows, cwd, None)
}

pub(super) fn create_session_with_script(
    owner: String,
    command: VettedCommand,
    cols: u16,
    rows: u16,
    cwd: Option<&str>,
    script: Option<tempfile::TempPath>,
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
    // So a full input queue answers `WouldBlock` instead of holding a write
    // for as long as the foreground program does not read (`input.rs`).
    #[cfg(unix)]
    super::input::make_nonblocking(pair.master.as_ref()).map_err(|e| e.to_string())?;
    // Before the spawn: a failure here must not leave a shell nobody owns.
    let (output, interrupter) = output::channel(pair.master.as_ref()).map_err(|e| e.to_string())?;

    let mut command = command.into_builder(cwd);
    if let Some(path) = &script {
        command.env("VMARK_CODE_BLOCK_SCRIPT", path.as_os_str());
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    // Close the slave fd — the child has its own copy.
    // This ensures the reader gets EOF when the child exits.
    drop(pair.slave);

    Ok(Session {
        owner,
        child: ChildSlot::new(child),
        output: StdMutex::new(Some(output)),
        interrupter,
        reader: StdMutex::new(None),
        writer: StdMutex::new(writer),
        master: StdMutex::new(pair.master),
        pause_ctl: PauseControl::new(),
        shutdown: AtomicBool::new(false),
        code_block_script: StdMutex::new(script),
    })
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
        let sessions: Vec<Arc<Session>> = std::mem::take(self.sessions.get_mut())
            .into_values()
            .collect();
        stop_shells(&sessions);
    }
}

/// End all live PTY shells so they don't outlive the app.
///
/// Must be called explicitly on the quit path (`quit::finalize_quit` and the
/// `ExitRequested` → `AllowExit` branch): `app.exit` terminates the process
/// via `std::process::exit`, which never drops Tauri-managed state, so
/// `PtyState`'s `Drop` cannot be relied on at quit.
///
/// Returns as soon as every shell is gone. A shell that ignores the hangup
/// holds quit for the grace period, shared by all sessions, and is then
/// killed. Reader threads are not joined: the process is about to exit.
/// Call only from a non-async context (the main-thread quit path) —
/// `blocking_read` panics inside a tokio runtime.
pub fn kill_all<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<PtyState>() else {
        return;
    };
    // Cloned out so the map is not held locked across the grace period.
    let sessions: Vec<Arc<Session>> = state.sessions.blocking_read().values().cloned().collect();
    stop_shells(&sessions);
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

// Unix-only: the tests spawn `/bin/sh` and probe pids with `kill(pid, 0)`.
#[cfg(all(test, unix))]
#[path = "session.test.rs"]
mod tests;
