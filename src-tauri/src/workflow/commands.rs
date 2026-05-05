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
use super::genie_step::ProviderConfig;
use super::runner::run_workflow_sequential;
use super::snapshots;
use super::types::RawWorkflow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

/// Shared state for workflow execution.
pub struct WorkflowRunnerState {
    pub running: AtomicBool,
    pub cancel_requested: Arc<AtomicBool>,
    pub approvals: Arc<ApprovalRegistry>,
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

    let workflow: RawWorkflow = match serde_yaml::from_str(&yaml) {
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
        return Err(
            rust_i18n::t!(
                "errors.workflow.tooManySteps",
                count = workflow.steps.len().to_string()
            )
            .to_string(),
        );
    }

    // Validate supported features — reject only what the runner truly can't
    // handle yet. `genie/*` is supported (WI-2.2); webhooks are not.
    for (i, step) in workflow.steps.iter().enumerate() {
        let step_id = step.id.as_deref().unwrap_or("(unnamed)");
        if step.uses.starts_with("webhook/") {
            state.running.store(false, Ordering::SeqCst);
            return Err(
                rust_i18n::t!(
                    "errors.workflow.webhookNotImplemented",
                    index = (i + 1).to_string(),
                    id = step_id
                )
                .to_string(),
            );
        }
    }

    // Generate execution ID and return immediately
    let execution_id = Uuid::new_v4().to_string();
    let exec_id_clone = execution_id.clone();
    let cancel_token = Arc::clone(&state.cancel_requested);
    let app_clone = app.clone();

    // Create snapshot of files that may be modified
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
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
    let genies_dir = app.path().app_data_dir().ok().map(|d| d.join("genies"));

    // Approval registry is per-app, shared across executions.
    let approvals = Arc::clone(&state.approvals);

    // Spawn runner as background task — return ID immediately
    tokio::spawn(async move {
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

        // Reset the concurrency guard so the next workflow can run.
        // AppHandle::state::<T>() is available inside tokio::spawn because
        // AppHandle implements Clone + Send + Sync.
        app_clone
            .state::<WorkflowRunnerState>()
            .running
            .store(false, Ordering::SeqCst);
    });

    Ok(execution_id)
}

/// Cancel a running workflow.
#[tauri::command]
pub async fn cancel_workflow(
    _app: AppHandle,
    _execution_id: String,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), String> {
    if !state.running.load(Ordering::SeqCst) {
        return Err(rust_i18n::t!("errors.workflow.notRunning").to_string());
    }
    state.cancel_requested.store(true, Ordering::SeqCst);
    log::info!("Workflow cancellation requested");
    Ok(())
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
