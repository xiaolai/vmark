//! Supervise a registered content-server child (Phase 1 WI-1.2, ADR-10).
//!
//! Purpose: one thread per registered (workspace, generation) polls the
//! manager every `MONITOR_INTERVAL`. An unexpected exit is logged and emitted
//! ONCE as `content-server:exited`, so the frontend can surface the crash and
//! apply its bounded restart policy (`src/hooks/useContentServer.ts`); an
//! intentional stop — the record removed, or the generation replaced — ends
//! the thread quietly. Split from `spawn.rs` at the file-size gate, and so
//! that the loop is `supervise`: generic over the poll and the exit hook,
//! pinned by `supervisor.test.rs` without a thread, a live child or the
//! 2-second interval (#136); the thread and the emit are pinned there too,
//! against the mock runtime.
//!
//! @coordinates-with manager_poll.rs — `poll_current_child`, the one decision
//! @coordinates-with start.rs — starts a supervisor for a registered child
//! @coordinates-with src/hooks/useContentServer.ts — consumes the event
//! @module content_server/supervisor

use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::{ChildState, ContentServerManager};

/// How often the supervisor polls the child for liveness.
const MONITOR_INTERVAL: Duration = Duration::from_secs(2);

/// The event the frontend listens for (`useContentServer.ts`).
pub(super) const EXITED_EVENT: &str = "content-server:exited";

/// Wire shape: `{ workspaceRoot: string; code: number | null }`.
#[derive(Clone, Debug, Serialize)]
pub(super) struct ExitedEvent {
    #[serde(rename = "workspaceRoot")]
    workspace_root: String,
    code: Option<i32>,
}

/// Supervise the child for (root, generation). Polls every `MONITOR_INTERVAL`;
/// on an unexpected exit it logs a warning and emits `content-server:exited`
/// once. An intentional stop (entry removed / generation bumped) ends the loop
/// silently. The frontend owns the bounded restart policy (WI-1.2).
pub fn monitor_child(app: AppHandle, root: String, generation: u64) {
    if let Err(e) = monitor_child_every(app, root.clone(), generation, MONITOR_INTERVAL) {
        // The server is registered and running; only the watch is missing, so
        // an unexpected exit will not reach the frontend. Say so loudly
        // rather than unwind the start that just succeeded (#331).
        log::error!(
            "[content-server {root}] could not start the supervisor thread for generation {generation}: {e}"
        );
    }
}

/// `monitor_child` with the interval injected, returning the thread so a test
/// can prove it ends. Production never joins it.
///
/// `thread::Builder`, not `thread::spawn` (#331): the latter PANICS when the
/// OS refuses a thread, and the panic would unwind the caller — `start_once`,
/// which has just registered a live server — turning a missing supervisor
/// into a failed start over a server that is running fine. A refusal is
/// reported instead; the caller logs it and leaves the server registered,
/// unwatched, which is what it already is at that point.
pub(super) fn monitor_child_every<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    generation: u64,
    interval: Duration,
) -> std::io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name("content-server-supervisor".to_string())
        .spawn(move || {
            let mgr = app.state::<ContentServerManager>();
            supervise(
                interval,
                || mgr.poll_current_child(&root, generation),
                |code| report_exit(&root, code, |name, event| app.emit(name, event)),
            )
        })
}

/// What an unexpected exit does, once: log it, then tell the frontend
/// through `emit`. An emit that fails is logged as an error and swallowed —
/// the supervisor thread has nobody to tell and must not unwind (nobody
/// joins it, so a panic here would be silent); the frontend then never
/// hears of this crash, and the log line is its only record.
pub(super) fn report_exit<E: std::fmt::Display>(
    root: &str,
    code: Option<i32>,
    emit: impl FnOnce(&str, ExitedEvent) -> Result<(), E>,
) {
    log::warn!("[content-server {root}] exited unexpectedly (code {code:?})");
    let event = ExitedEvent {
        workspace_root: root.to_string(),
        code,
    };
    if let Err(e) = emit(EXITED_EVENT, event) {
        log::error!("[content-server {root}] could not emit {EXITED_EVENT}: {e}");
    }
}

/// The loop, pure over its two hooks: `poll` FIRST, then `interval` between
/// polls; `Running` polls again, `NotCurrent` ends the loop silently, and
/// `Exited` calls `on_exit` exactly once and ends it.
///
/// The first poll is immediate (#333). Sleeping first made the failure this
/// supervisor is most likely to meet — a child that dies in the moment after
/// it reported its port, on a missing dependency or a port it cannot rebind —
/// invisible for a whole interval, during which the registry still named it
/// and `start_once` still handed it out as a `Ready` server. The cost is one
/// extra `try_wait` per supervised child.
pub(super) fn supervise(
    interval: Duration,
    mut poll: impl FnMut() -> ChildState,
    mut on_exit: impl FnMut(Option<i32>),
) {
    loop {
        match poll() {
            ChildState::Running => {}
            ChildState::NotCurrent => return,
            ChildState::Exited(code) => {
                on_exit(code);
                return;
            }
        }
        thread::sleep(interval);
    }
}

#[cfg(test)]
#[path = "supervisor.test.rs"]
mod tests;
