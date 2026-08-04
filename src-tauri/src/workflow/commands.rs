//! Tauri commands for workflow execution.
//!
//! Key decisions:
//!   - `run_workflow` spawns the runner as a background tokio task and returns
//!     the execution ID immediately — so the frontend can subscribe to events
//!     before any step runs.
//!   - Concurrency guard: only one workflow at a time via AtomicBool.
//!   - Cancellation via shared CancellationToken (AtomicBool checked per step).
//!   - Snapshots created before execution for file-modifying steps.
//!   - **The feature flag is enforced here, not only in the UI (WI-19).**
//!     `run_workflow` opens with `require_workflow_engine_enabled` and the
//!     state starts fail-closed. Only the command that STARTS work is gated:
//!     `cancel_workflow` and `respond_workflow_approval` are not, because
//!     gating them made a running workflow unstoppable by the very user who
//!     had just switched the feature off (audit 20260803 §3).
//!     `workflow_engine_policy` is not gated either — it IS the setter.
//!   - Errors are `CommandError` (WI-14), not `String`: the frontend has to be
//!     able to tell `feature-disabled` from `conflict` (already running) from
//!     `invalid-input` (bad YAML) without matching prose.

use super::genie_step::{resolve_genies_dir, ProviderConfig};
use super::guards::require_workflow_engine_enabled;
use super::runner::run_workflow_sequential;
use super::snapshots;
use super::state::{CancelDecision, WorkflowRunnerState};
use super::types::RawWorkflow;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
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
) -> Result<String, CommandError> {
    // The feature gate comes FIRST — before the concurrency CAS, so a refused
    // call cannot leave `running` latched true for the rest of the session.
    require_workflow_engine_enabled(&state)?;

    // Concurrency guard
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(localized_error!(
            ErrorCode::Conflict,
            "errors.workflow.alreadyRunning"
        ));
    }

    // Reset cancellation flag
    state.cancel_requested.store(false, Ordering::SeqCst);

    // Validate inputs
    if yaml.trim().is_empty() {
        state.running.store(false, Ordering::SeqCst);
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.workflow.emptyYaml"
        ));
    }

    let workspace = PathBuf::from(&workspace_root);
    if !workspace.is_dir() {
        state.running.store(false, Ordering::SeqCst);
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.workflow.invalidWorkspace",
            path = workspace_root
        ));
    }

    let workflow: RawWorkflow = match serde_yaml_ng::from_str(&yaml) {
        Ok(w) => w,
        Err(e) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(localized_error!(
                ErrorCode::InvalidInput,
                "errors.workflow.parseFailed",
                detail = e.to_string()
            ));
        }
    };

    // Validate step count
    if workflow.steps.len() > 50 {
        state.running.store(false, Ordering::SeqCst);
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.workflow.tooManySteps",
            count = workflow.steps.len().to_string()
        ));
    }

    // Validate supported features — reject only what the runner truly can't
    // handle yet. `genie/*` is supported (WI-2.2); webhooks are not.
    for (i, step) in workflow.steps.iter().enumerate() {
        let step_id = step.id.as_deref().unwrap_or("(unnamed)");
        if step.uses.starts_with("webhook/") {
            state.running.store(false, Ordering::SeqCst);
            return Err(localized_error!(
                ErrorCode::Unsupported,
                "errors.workflow.webhookNotImplemented",
                index = (i + 1).to_string(),
                id = step_id
            ));
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
            return Err(localized_error!(
                ErrorCode::Io,
                "errors.workflow.appDataDirUnavailable",
                detail = e.to_string()
            ));
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
///
/// **Deliberately NOT gated on the engine flag** (audit 20260803 §3). Turning
/// `advanced.workflowEngine` off while a workflow runs used to make that
/// workflow unstoppable: the UI vanished and the only command that could stop
/// it started returning `feature-disabled`. A gate whose job is "do not START
/// things" has no business refusing to stop one.
#[tauri::command]
pub async fn cancel_workflow(
    _app: AppHandle,
    execution_id: String,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), CommandError> {
    match state.request_cancel(&execution_id) {
        CancelDecision::Cancel => {
            log::info!("Workflow cancellation requested for {}", execution_id);
            Ok(())
        }
        CancelDecision::NotRunning => Err(localized_error!(
            ErrorCode::NotFound,
            "errors.workflow.notRunning"
        )),
    }
}

/// Respond to an outstanding approval request from the frontend dialog.
///
/// Ungated for the same reason as [`cancel_workflow`]: a step already blocked
/// on an approval must stay answerable — including with `approved = false` —
/// after the engine is switched off. Refusing here would strand the runner on
/// its receiver until the step's own timeout.
#[tauri::command]
pub async fn respond_workflow_approval(
    execution_id: String,
    step_id: String,
    approved: bool,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), CommandError> {
    let key = (execution_id, step_id);
    if state.approvals.respond(&key, approved) {
        Ok(())
    } else {
        Err(localized_error!(
            ErrorCode::NotFound,
            "errors.workflow.noPendingApproval"
        ))
    }
}

/// Record whether `advanced.workflowEngine` is on.
///
/// The webview's settings are not readable from Rust, so the flag is pushed —
/// once at bootstrap and on every change — the same way `browser_ai_policy`
/// carries the embedded browser's posture. This command is deliberately NOT
/// gated: it is the gate's setter, it starts nothing, and gating it would make
/// the engine unswitchable.
///
/// **Threat model (audit 20260803 §4).** This is an unauthenticated boolean
/// setter, and that is the intended design, not an oversight. It MIRRORS a
/// frontend-authoritative setting; the authoritative copy lives in the
/// webview's localStorage and is pushed here because Rust cannot read it. What
/// the gate buys is that a UI-less path — the MCP bridge, a second window, a
/// replayed `run_workflow` — cannot execute YAML for a feature the user
/// switched off. What it does NOT claim is protection against a caller who can
/// already invoke Tauri commands in this process: such a caller runs at the
/// app's own privilege and is inside the trust boundary by definition, so it
/// could simply call `run_workflow` were the flag not consulted at all.
/// Persisting the flag Rust-side would move the toggle, not the boundary — see
/// rule 60 §12's WI-19 verdict.
///
/// The `false` transition also asks any in-flight run to stop: the user who
/// turns the engine off is asking for it to be off, and the panel that carries
/// the cancel button is exactly what disappears.
#[tauri::command]
pub async fn workflow_engine_policy(
    enabled: bool,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), CommandError> {
    state.set_engine_enabled(enabled);
    if !enabled && state.request_cancel_if_running() {
        log::info!("Workflow engine switched off — cancelling the running workflow");
    }
    Ok(())
}
