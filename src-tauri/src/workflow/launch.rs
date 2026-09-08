//! The spawn half of `run_workflow` (#262, #263): hand an admitted run to
//! a background task that owns the `running` flag until it ends.
//!
//! Split from `commands.rs` at the file-size gate, and made generic over
//! the Tauri runtime so the lifecycle it owns can be driven on a mock app:
//! `launch.test.rs` pins that a run that completes, returns `Err`, or
//! panics releases the flag and the published id; that a second start is
//! refused while a run is live and admitted once it ends; and that a cancel
//! for the live id matches for the run's whole life.
//!
//! Key decisions:
//!   - The `RunningGuard` is built BEFORE the task is spawned and moved into
//!     it, so a task the runtime drops without ever polling (shutdown) still
//!     releases the flag when the future is dropped.
//!   - `spawn_logged` absorbs a panic in the run and logs it; the guard's
//!     `Drop` runs during that unwind, which is what keeps a panicking
//!     workflow from blocking every later start.
//!   - **Exactly one terminal event, on every exit** (audit #548). The flag
//!     was released on all four exits; the frontend was told about only two of
//!     them. `run_workflow` returns an execution id the panel subscribes to
//!     and then waits for `workflow:complete`, which the RUNNER emits — so a
//!     run that never reached the runner's emit, or never returned at all,
//!     left the panel spinning with no way back. `TerminalEvent` is armed
//!     around the run and DISARMED the moment it returns (the runner has
//!     emitted its own by then, with the true `completed`/`failed`/`cancelled`
//!     status), so it fires only on the paths that produce no event of their
//!     own: a panic, and the runtime dropping the task.
//!
//! @coordinates-with commands.rs — `run_workflow`, the only caller
//! @coordinates-with state.rs — `AdmissionGuard`, `RunningGuard`
//! @module workflow::launch

use super::state::{AdmissionGuard, RunningGuard};
use super::types::ExecutionCompleteEvent;
use std::future::Future;
use tauri::{AppHandle, Emitter, Runtime};

/// Commit the admission and run `run` in the background. From here the flag
/// belongs to the task's `RunningGuard`, which clears `running` and the id
/// on every exit path — and the frontend is told the run ended on every exit
/// path too, by `TerminalEvent`.
pub(super) fn spawn_run<R: Runtime>(
    app: AppHandle<R>,
    execution_id: String,
    admission: AdmissionGuard<'_>,
    run: impl Future<Output = Result<String, String>> + Send + 'static,
) -> tokio::task::JoinHandle<()> {
    admission.commit();
    let guard = RunningGuard { app: app.clone() };
    let terminal = TerminalEvent {
        app,
        execution_id: Some(execution_id),
    };
    crate::task::spawn_logged("workflow-runner", async move {
        // Declared first so it drops LAST: the flag has to be clear before the
        // frontend is told the run ended, or a panel that starts the next run
        // on that event is refused by its own predecessor.
        let mut terminal = terminal;
        let _guard = guard;
        let result = run.await;
        // Returned at all ⇒ the runner emitted its own terminal event, with
        // the true status. Anything this one sent now would be a duplicate
        // that could overwrite `cancelled` with `failed`.
        terminal.disarm();
        if let Err(e) = result {
            log::error!("Workflow execution failed: {}", e);
        }
    })
}

/// Emits `workflow:complete` for a run that ended without the runner saying
/// so — a panic, or the runtime dropping the task.
struct TerminalEvent<R: Runtime> {
    app: AppHandle<R>,
    execution_id: Option<String>,
}

impl<R: Runtime> TerminalEvent<R> {
    /// The runner has emitted its own terminal event; this one must not.
    fn disarm(&mut self) {
        self.execution_id = None;
    }
}

impl<R: Runtime> Drop for TerminalEvent<R> {
    fn drop(&mut self) {
        let Some(execution_id) = self.execution_id.take() else {
            return;
        };
        log::error!(
            "Workflow {execution_id} ended without a completion event — reporting it as failed"
        );
        let _ = self.app.emit(
            "workflow:complete",
            ExecutionCompleteEvent {
                execution_id,
                status: "failed".to_string(),
            },
        );
    }
}

#[cfg(test)]
#[path = "launch.test.rs"]
mod tests;
