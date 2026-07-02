//! Tauri commands for workflow execution.
//!
//! Key decisions:
//!   - `run_workflow` spawns the runner as a background tokio task and returns
//!     the execution ID immediately — so the frontend can subscribe to events
//!     before any step runs.
//!   - Concurrency guard: only one workflow at a time via AtomicBool.
//!   - Cancellation via shared CancellationToken (AtomicBool checked per step).
//!   - Snapshots created before execution for file-modifying steps.

use super::approval::ApprovalRegistry;
use super::genie_step::{resolve_genies_dir, ProviderConfig};
use super::runner::run_workflow_sequential;
use super::snapshots;
use super::types::RawWorkflow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

/// RAII guard that releases the workflow `running` concurrency flag on drop.
///
/// Whether the spawned runner returns normally, returns `Err`, or panics,
/// `Drop::drop` runs and resets `running` to `false`. Without this, a panic
/// inside `run_workflow_sequential` (caught by `spawn_logged`) would leave
/// `running == true` forever and permanently block every subsequent
/// workflow start.
struct RunningGuard {
    app: AppHandle,
}

impl RunningGuard {
    fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.app.state::<WorkflowRunnerState>().clear_running();
    }
}

/// Outcome of evaluating a cancel request against the currently-running
/// execution. Pure (no Tauri/i18n dependency) so it is unit-testable.
#[derive(Debug, PartialEq, Eq)]
enum CancelDecision {
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
    /// Id of the execution currently running, or `None` when idle.
    /// `run_workflow` sets it under the concurrency guard; `RunningGuard::drop`
    /// clears it. `cancel_workflow` matches against it so a stale cancel for an
    /// already-finished execution can't cancel whatever started next (C6).
    pub current_execution: Arc<Mutex<Option<String>>>,
}

impl WorkflowRunnerState {
    /// Release the concurrency flag and clear the published execution id.
    /// Called by `RunningGuard::drop`; factored out (no `AppHandle`) so the
    /// cancel-lifecycle clearing is unit-testable without a Tauri runtime.
    fn clear_running(&self) {
        self.running.store(false, Ordering::SeqCst);
        // Clear the running execution id so a late cancel targeting the
        // finished execution can no longer fire against whatever starts next.
        *self
            .current_execution
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = None;
    }
}

/// Execute a workflow from YAML string.
///
/// Spawns the runner as a background task and returns the execution ID
/// immediately. The frontend should subscribe to `workflow:step-update`
/// and `workflow:complete` events using this ID before calling this command.
///
/// `provider` is optional: action-only workflows don't need it. Workflows
/// containing `genie/*` steps will fail those steps with a clear error if
/// no provider is supplied.
#[tauri::command]
pub async fn run_workflow(
    app: AppHandle,
    yaml: String,
    env: HashMap<String, String>,
    workspace_root: String,
    provider: Option<ProviderConfig>,
    // Optional caller-supplied execution ID. Frontends pre-generate this so
    // they can subscribe to events with the right key before the runner
    // emits its first event (closes the executionId race in
    // useWorkflowExecution).
    execution_id: Option<String>,
    state: State<'_, WorkflowRunnerState>,
) -> Result<String, String> {
    // Concurrency guard
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(rust_i18n::t!("errors.workflow.alreadyRunning").to_string());
    }

    // Reset cancellation flag
    state.cancel_requested.store(false, Ordering::SeqCst);

    // Validate inputs
    if yaml.trim().is_empty() {
        state.running.store(false, Ordering::SeqCst);
        return Err(rust_i18n::t!("errors.workflow.emptyYaml").to_string());
    }

    let workspace = PathBuf::from(&workspace_root);
    if !workspace.is_dir() {
        state.running.store(false, Ordering::SeqCst);
        return Err(
            rust_i18n::t!("errors.workflow.invalidWorkspace", path = workspace_root).to_string(),
        );
    }

    let workflow: RawWorkflow = match serde_yaml_ng::from_str(&yaml) {
        Ok(w) => w,
        Err(e) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(
                rust_i18n::t!("errors.workflow.parseFailed", detail = e.to_string()).to_string(),
            );
        }
    };

    // Validate step count
    if workflow.steps.len() > 50 {
        state.running.store(false, Ordering::SeqCst);
        return Err(rust_i18n::t!(
            "errors.workflow.tooManySteps",
            count = workflow.steps.len().to_string()
        )
        .to_string());
    }

    // Validate supported features — reject only what the runner truly can't
    // handle yet. `genie/*` is supported (WI-2.2); webhooks are not.
    for (i, step) in workflow.steps.iter().enumerate() {
        let step_id = step.id.as_deref().unwrap_or("(unnamed)");
        if step.uses.starts_with("webhook/") {
            state.running.store(false, Ordering::SeqCst);
            return Err(rust_i18n::t!(
                "errors.workflow.webhookNotImplemented",
                index = (i + 1).to_string(),
                id = step_id
            )
            .to_string());
        }
    }

    // Use the caller-supplied execution ID if present (avoids a race where the
    // frontend can't filter events by ID until invoke() resolves). Otherwise
    // generate a fresh one.
    let execution_id = execution_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let exec_id_clone = execution_id.clone();
    let cancel_token = Arc::clone(&state.cancel_requested);
    let app_clone = app.clone();

    // Create snapshot of files that may be modified. This is the last fallible
    // pre-spawn step; on error we must release the `running` concurrency flag
    // (the RunningGuard that normally does this only exists once we spawn).
    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(format!("Failed to resolve app data directory: {}", e));
        }
    };
    let snapshot_workspace = workspace.clone();

    // Collect file paths from save-file steps for snapshotting
    let files_to_snapshot: Vec<PathBuf> = workflow
        .steps
        .iter()
        .filter(|s| s.uses == "action/save-file")
        .filter_map(|s| {
            s.with.get("path").map(|p| {
                if std::path::Path::new(p).is_absolute() {
                    PathBuf::from(p)
                } else {
                    snapshot_workspace.join(p)
                }
            })
        })
        .collect();

    if !files_to_snapshot.is_empty() {
        if let Err(e) = snapshots::create_snapshot(
            &app_data_dir,
            &execution_id,
            &files_to_snapshot,
            &snapshot_workspace,
        )
        .await
        {
            log::warn!("Failed to create pre-execution snapshot: {}", e);
            // Continue execution — snapshot failure shouldn't block the workflow
        }
    }

    // Resolve genies dir up-front so the runner doesn't need a Tauri handle
    // for filesystem I/O. `app.path().app_data_dir()` can fail on rare
    // sandbox configurations; in that case genie steps will report a clean
    // error and action-only workflows still run.
    let genies_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| resolve_genies_dir(&d));

    // Approval registry is per-app, shared across executions.
    let approvals = Arc::clone(&state.approvals);

    // Publish the running execution id only now — after every fallible
    // pre-spawn step has succeeded — so an early-return error path can never
    // leave a stale id behind. From here, RunningGuard::drop clears it on every
    // exit path of the spawned task. A cancel arriving right after invoke()
    // resolves still matches, because we return execution_id immediately below.
    *state
        .current_execution
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = Some(execution_id.clone());

    // Spawn runner as background task — return ID immediately.
    //
    // Wrapped in spawn_logged so a panic inside the runner is logged instead
    // of silently swallowed by the tokio runtime. The RunningGuard below
    // clears `WorkflowRunnerState.running` on Drop so even an unwind path
    // releases the concurrency lock — preventing a stuck-true flag from
    // permanently blocking subsequent workflow runs.
    crate::task::spawn_logged("workflow-runner", async move {
        let _guard = RunningGuard::new(app_clone.clone());

        let result = run_workflow_sequential(
            &app_clone,
            workflow,
            env,
            &workspace,
            &exec_id_clone,
            &cancel_token,
            provider,
            genies_dir,
            approvals,
        )
        .await;

        if let Err(e) = result {
            log::error!("Workflow execution failed: {}", e);
        }
        // _guard drops here on the happy path and clears the flag.
    });

    Ok(execution_id)
}

/// Cancel a running workflow.
///
/// The cancel only fires when `execution_id` matches the execution currently
/// running (C6). A request for any other id — typically a stale cancel for an
/// execution that already finished — is rejected so it can't cancel a workflow
/// that started in the meantime.
#[tauri::command]
pub async fn cancel_workflow(
    _app: AppHandle,
    execution_id: String,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), String> {
    let current = state
        .current_execution
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    match decide_cancel(current.as_deref(), &execution_id) {
        CancelDecision::Cancel => {
            state.cancel_requested.store(true, Ordering::SeqCst);
            log::info!("Workflow cancellation requested for {}", execution_id);
            Ok(())
        }
        CancelDecision::NotRunning => Err(rust_i18n::t!("errors.workflow.notRunning").to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_fires_when_id_matches_running_execution() {
        assert_eq!(
            decide_cancel(Some("exec-a"), "exec-a"),
            CancelDecision::Cancel
        );
    }

    #[test]
    fn cancel_rejected_when_nothing_is_running() {
        // A cancel arriving while idle must not arm the cancel flag.
        assert_eq!(decide_cancel(None, "exec-a"), CancelDecision::NotRunning);
    }

    #[test]
    fn cancel_rejected_when_a_different_execution_is_running() {
        // The TOCTOU case: exec-a finished, exec-b started, late cancel(exec-a)
        // arrives — it must NOT cancel exec-b.
        assert_eq!(
            decide_cancel(Some("exec-b"), "exec-a"),
            CancelDecision::NotRunning
        );
    }

    fn state_with(running: bool, exec: Option<&str>) -> WorkflowRunnerState {
        WorkflowRunnerState {
            running: AtomicBool::new(running),
            cancel_requested: Arc::new(AtomicBool::new(false)),
            approvals: Arc::new(ApprovalRegistry::new()),
            current_execution: Arc::new(Mutex::new(exec.map(str::to_string))),
        }
    }

    #[test]
    fn clear_running_releases_flag_and_execution_id() {
        // Mirrors what RunningGuard::drop does on every exit path: the running
        // execution id and the concurrency flag are both released, so the next
        // run starts clean and a stale cancel can no longer match.
        let st = state_with(true, Some("exec-a"));
        st.clear_running();
        assert!(!st.running.load(Ordering::SeqCst));
        assert!(st.current_execution.lock().unwrap().is_none());
    }

    #[test]
    fn cancel_no_longer_matches_after_clear() {
        // End-to-end of the cancel state transition: publish id → clear (as on
        // drop / pre-spawn failure) → a cancel for that id is now rejected.
        let st = state_with(true, Some("exec-a"));
        let published = st.current_execution.lock().unwrap().clone();
        assert_eq!(
            decide_cancel(published.as_deref(), "exec-a"),
            CancelDecision::Cancel
        );
        st.clear_running();
        let after = st.current_execution.lock().unwrap().clone();
        assert_eq!(
            decide_cancel(after.as_deref(), "exec-a"),
            CancelDecision::NotRunning
        );
    }
}

/// Respond to an outstanding approval request from the frontend dialog.
#[tauri::command]
pub async fn respond_workflow_approval(
    execution_id: String,
    step_id: String,
    approved: bool,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), String> {
    let key = (execution_id, step_id);
    if state.approvals.respond(&key, approved) {
        Ok(())
    } else {
        Err("No outstanding approval request matched".to_string())
    }
}
