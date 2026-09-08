//! The workflow runner's managed state.
//!
//! Split out of `commands.rs` by WI-19: adding the feature flag pushed that
//! file past its frozen size, and the state was never a command anyway — it is
//! what `.manage()` holds and what `workflow::guards` reads.
//!
//! Three transitions are ATOMIC here because they raced as separate atomics
//! (audit 20260907):
//!   - the engine gate + the `running` claim of a start, against the flag
//!     write + cancel of `workflow_engine_policy(false)` — one lock,
//!     `admission`, held across each pair (#260, #274);
//!   - matching an execution id and arming its cancel — done under the
//!     `current_execution` lock, which the next run's reset also takes, so a
//!     stale cancel cannot land after the flag was reset for a new run (#273);
//!   - releasing `running` on a refused start — an RAII `AdmissionGuard`
//!     rather than a `store(false)` on every early return (#259).
//!
//! @coordinates-with workflow/commands.rs — the commands that mutate it
//! @coordinates-with workflow/guards.rs — reads `engine_enabled`
//! @coordinates-with lib.rs — `.manage(WorkflowRunnerState::default())`
//! @module workflow::state

/// The cancel decision, split out at the file-size limit: it is pure — no
/// Tauri, no locks, no i18n — and it is the one rule `request_cancel` applies.
#[path = "state_cancel.rs"]
mod state_cancel;
pub(super) use state_cancel::{decide_cancel, CancelDecision};

use super::approval::ApprovalRegistry;
use super::recent_ids::RecentExecutionIds;
use crate::command_error::CommandError;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Manager, Runtime};

/// RAII guard that releases the workflow `running` concurrency flag on drop.
///
/// Whether the spawned runner returns normally, returns `Err`, or panics,
/// `Drop::drop` runs and resets `running` to `false`. Without this, a panic
/// inside `run_workflow_sequential` (caught by `spawn_logged`) would leave
/// `running == true` forever and permanently block every subsequent
/// workflow start. Held by the runner task `launch::spawn_run` spawns.
/// Generic over the runtime so `launch.test.rs` can hold one on a mock app.
pub(super) struct RunningGuard<R: Runtime> {
    pub(super) app: AppHandle<R>,
}

impl<R: Runtime> Drop for RunningGuard<R> {
    fn drop(&mut self) {
        self.app.state::<WorkflowRunnerState>().clear_running();
    }
}

/// The `running` flag between a successful claim and the spawn (#259).
///
/// Every refusal between the two — bad YAML, a missing workspace, a failed
/// snapshot — used to carry its own `running.store(false)`, six of them, and
/// the seventh was in the command. Dropping this guard releases the flag and
/// the published execution id; `commit` hands the flag to the runner task,
/// whose `RunningGuard` releases it when the run ends.
pub(super) struct AdmissionGuard<'a> {
    state: &'a WorkflowRunnerState,
    committed: bool,
}

impl AdmissionGuard<'_> {
    /// The run is spawned: the flag now belongs to its `RunningGuard`.
    pub(super) fn commit(mut self) {
        self.committed = true;
    }
}

impl std::fmt::Debug for AdmissionGuard<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AdmissionGuard")
            .field("committed", &self.committed)
            .finish()
    }
}

impl Drop for AdmissionGuard<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.state.clear_running();
        }
    }
}

/// Shared state for workflow execution. Held by the Tauri app via `.manage()`
/// at startup; outlives any individual execution.
///
/// **The synchronization is PRIVATE, and the transitions are the API** (#558).
/// Every field was `pub`, and so was the raw `set_engine_enabled` setter, so
/// the three atomic pairings this module exists to enforce could each be
/// walked around by a caller that took the pieces directly. `pub(super)` makes
/// the compiler the enforcement: outside `crate::workflow` nothing reaches the
/// primitives at all. Not private, because `commands.test.rs` reads `running`
/// and `current_execution` to assert what a command left behind.
pub struct WorkflowRunnerState {
    /// Concurrency guard — only one workflow runs at a time, APP-WIDE (#272):
    /// this state is `.manage()`d once per app, so every window's
    /// `run_workflow` claims the same flag, and a second window is refused
    /// with `alreadyRunning` while any window's run is live.
    /// `run_workflow` flips this from `false` → `true` via `compare_exchange`
    /// and the spawned runner task flips it back when done. The CAS makes
    /// double-start attempts return `errors.workflow.alreadyRunning`.
    pub(super) running: AtomicBool,
    /// Soft cancel flag observed by the runner before each step. The bridge
    /// task in `runner::spawn_cancel_bridge` polls this and forwards the
    /// signal to a tokio `CancellationToken` so the AI provider stack
    /// (CLI children, REST requests) reacts without polling.
    pub(super) cancel_requested: Arc<AtomicBool>,
    /// Outstanding approval senders keyed by `(execution_id, step_id)`.
    /// `respond_workflow_approval` looks the entry up and delivers the user's
    /// verdict; the runner awaits the matching receiver.
    pub(super) approvals: Arc<ApprovalRegistry>,
    /// Whether `advanced.workflowEngine` is on, as last pushed by the webview
    /// (`workflow_engine_policy`). Settings live in the webview's localStorage,
    /// which Rust cannot read, so the flag has to be told to us — the same
    /// mechanism `browser_ai_policy` uses for the embedded browser. Starts
    /// `false`: the window between app start and the first push must refuse,
    /// not run.
    pub(super) engine_enabled: AtomicBool,
    /// Id of the execution currently running, or `None` when idle.
    /// `run_workflow` sets it under the concurrency guard; `RunningGuard::drop`
    /// clears it. `cancel_workflow` matches against it so a stale cancel for an
    /// already-finished execution can't cancel whatever started next (C6).
    pub(super) current_execution: Arc<Mutex<Option<String>>>,
    /// Serializes a start's gate-check + claim against a policy change's
    /// flag write + cancel (#260, #274). Held only across those two pairs.
    admission: Mutex<()>,
    /// The ids recent runs carried, so a caller cannot reuse one (#264).
    recent_ids: RecentExecutionIds,
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
            admission: Mutex::new(()),
            recent_ids: RecentExecutionIds::default(),
        }
    }
}

impl WorkflowRunnerState {
    /// Is the bespoke workflow engine switched on in Settings?
    pub(super) fn engine_enabled(&self) -> bool {
        self.engine_enabled.load(Ordering::SeqCst)
    }

    /// Record the flag the webview pushed. Idempotent in both directions — the
    /// settings subscription pushes on every change, including back to off.
    pub(super) fn set_engine_enabled(&self, enabled: bool) {
        self.engine_enabled.store(enabled, Ordering::SeqCst);
    }

    /// The lock a start holds across its gate-check and claim. Taken here
    /// rather than inside a state method because the gate call itself has to
    /// stay in `commands.rs`, where `guards.test.rs` reads it.
    pub(super) fn admission_lock(&self) -> MutexGuard<'_, ()> {
        self.admission.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Record the flag AND, on the `false` transition, cancel whatever is
    /// running — both under the admission lock, so a start cannot read
    /// "enabled", lose the cancel to its own flag reset, and run disabled
    /// (#260, #274). Returns whether a run was asked to stop.
    pub(super) fn apply_engine_policy(&self, enabled: bool) -> bool {
        let _serial = self.admission_lock();
        self.set_engine_enabled(enabled);
        !enabled && self.request_cancel_if_running()
    }

    /// Claim the `running` flag AND publish the id the run will carry, in one
    /// critical section (#559) — resetting the previous run's cancel on the
    /// way, under the lock `request_cancel` arms it under (#273).
    ///
    /// The two used to be separate calls, and `request_cancel` matches against
    /// `current_execution` — so a cancel arriving between them read `None`,
    /// answered `NotRunning`, and was dropped. The frontend PRE-GENERATES the
    /// id and subscribes before `run_workflow` resolves, so it can legitimately
    /// cancel an id this process has claimed but not published; the gap spanned
    /// a YAML parse, a `canonicalize` and a graph sort. `None` means another
    /// run holds the flag; `Some(Err)` a reused id (#264), refused with the
    /// claim already released.
    pub(super) fn claim_and_publish(
        &self,
        execution_id: &str,
    ) -> Option<Result<AdmissionGuard<'_>, CommandError>> {
        // ONE acquisition of the id lock covers the claim, the cancel reset
        // and the publication — splitting it into helpers would reopen the
        // window, since each would release the lock between the two.
        let mut ids = self
            .current_execution
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()?;
        self.cancel_requested.store(false, Ordering::SeqCst);
        let admission = AdmissionGuard {
            state: self,
            committed: false,
        };
        let fresh = self.recent_ids.remember(execution_id);
        if fresh {
            *ids = Some(execution_id.to_string());
        }
        // Released BEFORE `admission` can drop: its `Drop` calls
        // `clear_running`, which takes this same lock.
        drop(ids);
        if !fresh {
            return Some(Err(CommandError::conflict(format!(
                "execution id {execution_id:?} was already used by an earlier run; every run needs a fresh id"
            ))));
        }
        Some(Ok(admission))
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
    /// execution actually running (C6). The match and the store happen under
    /// one lock: a request that read the id before it changed cannot store
    /// its cancel after the next run has already reset the flag (#273).
    ///
    /// Deliberately NOT gated on `engine_enabled`: a workflow that is already
    /// running has to stay stoppable even after the user switches the feature
    /// off, which is the whole point of audit 20260803 §3. The gate belongs to
    /// `run_workflow`, which STARTS work; cancelling only ever stops it.
    pub(super) fn request_cancel(&self, execution_id: &str) -> CancelDecision {
        let current = self
            .current_execution
            .lock()
            .unwrap_or_else(|p| p.into_inner());
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

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
