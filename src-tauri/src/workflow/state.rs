//! The workflow runner's managed state.
//!
//! Split out of `commands.rs` by WI-19: adding the feature flag pushed that
//! file past its frozen size, and the state was never a command anyway — it is
//! what `.manage()` holds and what `workflow::guards` reads.
//!
//! @coordinates-with workflow/commands.rs — the commands that mutate it
//! @coordinates-with workflow/guards.rs — reads `engine_enabled`
//! @coordinates-with lib.rs — `.manage(WorkflowRunnerState::default())`
//! @module workflow::state

use super::approval::ApprovalRegistry;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Shared state for workflow execution. Held by the Tauri app via `.manage()`
/// at startup; outlives any individual execution.
pub struct WorkflowRunnerState {
    /// Concurrency guard — only one workflow runs at a time per window.
    /// `run_workflow` flips this from `false` → `true` via `compare_exchange`
    /// and the spawned runner task flips it back when done. The CAS makes
    /// double-start attempts return `errors.workflow.alreadyRunning`.
    pub running: AtomicBool,
    /// Soft cancel flag observed by the runner before each step. The bridge
    /// task in `runner::spawn_cancel_bridge` polls this and forwards the
    /// signal to a tokio `CancellationToken` so the AI provider stack
    /// (CLI children, REST requests) reacts without polling.
    pub cancel_requested: Arc<AtomicBool>,
    /// Outstanding approval senders keyed by `(execution_id, step_id)`.
    /// `respond_workflow_approval` looks the entry up and delivers the user's
    /// verdict; the runner awaits the matching receiver.
    pub approvals: Arc<ApprovalRegistry>,
    /// Whether `advanced.workflowEngine` is on, as last pushed by the webview
    /// (`workflow_engine_policy`). Settings live in the webview's localStorage,
    /// which Rust cannot read, so the flag has to be told to us — the same
    /// mechanism `browser_ai_policy` uses for the embedded browser. Starts
    /// `false`: the window between app start and the first push must refuse,
    /// not run.
    pub engine_enabled: AtomicBool,
    /// Id of the execution currently running, or `None` when idle.
    /// `run_workflow` sets it under the concurrency guard; `RunningGuard::drop`
    /// clears it. `cancel_workflow` matches against it so a stale cancel for an
    /// already-finished execution can't cancel whatever started next (C6).
    pub current_execution: Arc<Mutex<Option<String>>>,
}

impl Default for WorkflowRunnerState {
    /// Fail-closed, idle, nothing running.
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            cancel_requested: Arc::new(AtomicBool::new(false)),
            approvals: Arc::new(ApprovalRegistry::new()),
            engine_enabled: AtomicBool::new(false),
            current_execution: Arc::new(Mutex::new(None)),
        }
    }
}

impl WorkflowRunnerState {
    /// Is the bespoke workflow engine switched on in Settings?
    pub fn engine_enabled(&self) -> bool {
        self.engine_enabled.load(Ordering::SeqCst)
    }

    /// Record the flag the webview pushed. Idempotent in both directions — the
    /// settings subscription pushes on every change, including back to off.
    pub fn set_engine_enabled(&self, enabled: bool) {
        self.engine_enabled.store(enabled, Ordering::SeqCst);
    }

    /// Release the concurrency flag and clear the published execution id.
    /// Called by `RunningGuard::drop`; factored out (no `AppHandle`) so the
    /// cancel-lifecycle clearing is unit-testable without a Tauri runtime.
    ///
    /// **The order is load-bearing** (audit 20260803 §1). `running` is the
    /// only thing standing between a finishing workflow and the next one: the
    /// instant it reads `false`, another `run_workflow` can win the CAS and
    /// publish ITS execution id. Releasing the flag first therefore left this
    /// method's *second* statement to erase a stranger's id, and a
    /// `cancel_workflow` for that live run then matched nothing — a workflow
    /// the user could not stop. Clearing the id first closes the window: a CAS
    /// winner's write is unconditionally the last one.
    pub(super) fn clear_running(&self) {
        // Clear the running execution id so a late cancel targeting the
        // finished execution can no longer fire against whatever starts next.
        *self
            .current_execution
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = None;
        self.running.store(false, Ordering::SeqCst);
    }

    /// Arm the soft cancel flag for `execution_id` — but only when it names the
    /// execution actually running (C6).
    ///
    /// Deliberately NOT gated on `engine_enabled`: a workflow that is already
    /// running has to stay stoppable even after the user switches the feature
    /// off, which is the whole point of audit 20260803 §3. The gate belongs to
    /// `run_workflow`, which STARTS work; cancelling only ever stops it.
    pub(super) fn request_cancel(&self, execution_id: &str) -> CancelDecision {
        let current = self
            .current_execution
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let decision = decide_cancel(current.as_deref(), execution_id);
        if decision == CancelDecision::Cancel {
            self.cancel_requested.store(true, Ordering::SeqCst);
        }
        decision
    }

    /// Ask whatever is running to stop, without naming it. Returns whether
    /// anything was running.
    ///
    /// Used by the `false` transition of `workflow_engine_policy`: switching
    /// the engine off should not leave a run going that the (now hidden) UI can
    /// no longer reach. Arming the flag while idle would be latched state the
    /// next run has to remember to clear, so the `running` check is part of the
    /// contract, not an optimization.
    pub(super) fn request_cancel_if_running(&self) -> bool {
        if self.running.load(Ordering::SeqCst) {
            self.cancel_requested.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }
}

/// Outcome of evaluating a cancel request against the currently-running
/// execution. Pure (no Tauri/i18n dependency) so it is unit-testable.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum CancelDecision {
    /// The requested id matches the running execution — fire the cancel.
    Cancel,
    /// Nothing is running, or a *different* execution is running. The
    /// requested execution must not be cancelled.
    NotRunning,
}

/// Decide whether a cancel request for `requested_id` should fire, given the
/// id of the execution currently running (`current`, `None` when idle).
///
/// Honoring the execution id (C6) closes a TOCTOU window: execution A finishes
/// and execution B starts before A's late `cancel_workflow(A)` arrives. A
/// global `running`-only check would cancel B; matching the id drops the stale
/// request instead.
fn decide_cancel(current: Option<&str>, requested_id: &str) -> CancelDecision {
    match current {
        Some(id) if id == requested_id => CancelDecision::Cancel,
        _ => CancelDecision::NotRunning,
    }
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
