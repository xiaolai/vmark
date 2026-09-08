//! Tauri commands for workflow execution.
//!
//! Key decisions:
//!   - `run_workflow` spawns the runner as a background tokio task and returns
//!     the execution ID immediately — so the frontend can subscribe to events
//!     before any step runs.
//!   - Concurrency guard: only one workflow at a time via AtomicBool, claimed
//!     through `state::AdmissionGuard` so every refusal releases it (#259).
//!   - Cancellation via shared CancellationToken (AtomicBool checked per step).
//!   - Snapshots created before execution for file-modifying steps — and
//!     REQUIRED: a snapshot that fails refuses the run (`prepare.rs`, #266).
//!   - `run_workflow` is four steps in order (#262): admit (`admit_run`),
//!     settle the id (`prepare::execution_id_for`, then
//!     `state.begin_execution`, which refuses a reused one — #264), prepare
//!     (`prepare::prepare_run`: snapshot, cancel check, genies directory),
//!     spawn (`launch::spawn_run`, which owns the flag from then on).
//!   - **The feature flag is enforced here, not only in the UI (WI-19).**
//!     `run_workflow` admits through `admit_run`, whose first check is the
//!     gate (`require_workflow_engine_enabled`); the state starts fail-closed.
//!     The gate and the claim run under the state's admission lock, the same
//!     one `workflow_engine_policy(false)` holds across its flag write and its
//!     cancel (#260). Only the command that STARTS work is gated:
//!     `cancel_workflow` and `respond_workflow_approval` are not; gating them
//!     made a running workflow unstoppable by the user who just switched it
//!     off (audit 20260803 §3). `workflow_engine_policy` is not gated either —
//!     it IS the setter.
//!   - Errors are `CommandError` (WI-14), not `String`: the frontend has to be
//!     able to tell `feature-disabled` from `conflict` (already running) from
//!     `invalid-input` (bad YAML) without matching prose.

use super::genie_step::ProviderConfig;
use super::guards::require_workflow_engine_enabled;
use super::launch::spawn_run;
use super::prepare::{execution_id_for, prepare_run};
use super::runner::run_workflow_sequential;
use super::state::{AdmissionGuard, CancelDecision, WorkflowRunnerState};
use super::types::RawWorkflow;
use super::validate::validate_document;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// The pre-spawn half of `run_workflow`, against the managed state alone: the
/// engine gate, then the one-run-at-a-time claim, then input validation.
/// Split from the command because a `State<'_, T>` needs a Tauri runtime and
/// the ORDER here is what has to be pinned: gate before claim, and a refused
/// start must neither latch `running` nor touch a live run's flags. Every
/// refusal after the claim releases it by dropping the guard.
fn admit_run<'s>(
    state: &'s WorkflowRunnerState,
    yaml: &str,
    workspace_root: &str,
    execution_id: &str,
) -> Result<(RawWorkflow, PathBuf, AdmissionGuard<'s>), CommandError> {
    let admission = {
        // Gate and claim under one lock (#260): the feature gate comes FIRST —
        // before the concurrency claim, so a refused call cannot leave
        // `running` latched true for the rest of the session.
        let _serial = state.admission_lock();
        require_workflow_engine_enabled(state)?;
        // Claim and publish in one step (#559): `request_cancel` matches
        // against the published id, so a cancel landing between a separate
        // claim and publication saw `None`, answered `NotRunning`, and was
        // dropped — leaving a run the frontend had already asked to stop.
        state.claim_and_publish(execution_id).ok_or_else(|| {
            localized_error!(ErrorCode::Conflict, "errors.workflow.alreadyRunning")
        })??
    };

    let (workflow, workspace) = validate_document(yaml, workspace_root)?;
    Ok((workflow, workspace, admission))
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
///
/// Generic over the runtime — like the runner it spawns (#263) — so
/// `commands.test.rs` drives the whole composition on a mock app: what the
/// command returns, what it publishes before it spawns, and what a refusal
/// leaves behind. `admit_run` alone could be tested without an app, and that
/// left the four joins around it untested.
#[tauri::command]
pub async fn run_workflow<R: tauri::Runtime>(
    app: AppHandle<R>,
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
    // The caller's id — pre-generated so the frontend can subscribe to events
    // before invoke() resolves — validated (#264), or a fresh one. Settled
    // BEFORE admission (#559) so the claim and the publication happen in one
    // critical section: a cancel that arrives while the snapshot is being
    // taken, or while the YAML is still being parsed, already matches. Every
    // `?` from here drops `admission`, which clears the id with the flag, so
    // an early return can never leave a stale id behind.
    let execution_id = execution_id_for(execution_id)?;
    let (workflow, workspace, admission) =
        admit_run(&state, &yaml, &workspace_root, &execution_id)?;

    let genies_dir = prepare_run(&app, &state, &workflow, &workspace, &execution_id).await?;

    // Approval registry is per-app, shared across executions.
    let approvals = Arc::clone(&state.approvals);
    let cancel_token = Arc::clone(&state.cancel_requested);
    let runner_app = app.clone();
    let id = execution_id.clone();
    spawn_run(app, execution_id.clone(), admission, async move {
        run_workflow_sequential(
            &runner_app,
            workflow,
            env,
            &workspace,
            &id,
            &cancel_token,
            provider,
            genies_dir,
            approvals,
        )
        .await
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
///
/// It took an unused `AppHandle` until audit 20260907 #523. Tauri injects that
/// parameter, so the frontend never sent it and nothing broke by asking — but a
/// command's parameter list is its ABI as read by anyone maintaining it, and an
/// argument declared for no reason reads as a dependency this command does not
/// have. The cancel is decided entirely on `WorkflowRunnerState`.
#[tauri::command]
pub async fn cancel_workflow(
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
/// the cancel button is exactly what disappears. Flag and cancel are applied
/// under the admission lock, so a start cannot slip between them (#260).
#[tauri::command]
pub async fn workflow_engine_policy(
    enabled: bool,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), CommandError> {
    if state.apply_engine_policy(enabled) {
        log::info!("Workflow engine switched off — cancelling the running workflow");
    }
    Ok(())
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
