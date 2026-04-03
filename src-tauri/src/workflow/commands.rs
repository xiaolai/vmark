//! Tauri commands for workflow execution.
//!
//! Key decisions:
//!   - `run_workflow` spawns the runner as a background tokio task and returns
//!     the execution ID immediately — so the frontend can subscribe to events
//!     before any step runs.
//!   - Concurrency guard: only one workflow at a time via AtomicBool.
//!   - Cancellation via shared CancellationToken (AtomicBool checked per step).
//!   - Snapshots created before execution for file-modifying steps.

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
}

/// Execute a workflow from YAML string.
///
/// Spawns the runner as a background task and returns the execution ID
/// immediately. The frontend should subscribe to `workflow:step-update`
/// and `workflow:complete` events using this ID before calling this command.
#[tauri::command]
pub async fn run_workflow(
    app: AppHandle,
    yaml: String,
    env: HashMap<String, String>,
    workspace_root: String,
    state: State<'_, WorkflowRunnerState>,
) -> Result<String, String> {
    // Concurrency guard
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "A workflow is already running. Wait for it to complete or cancel it.".to_string(),
        );
    }

    // Reset cancellation flag
    state.cancel_requested.store(false, Ordering::SeqCst);

    // Validate inputs
    if yaml.trim().is_empty() {
        state.running.store(false, Ordering::SeqCst);
        return Err("Workflow YAML is empty".to_string());
    }

    let workspace = PathBuf::from(&workspace_root);
    if !workspace.is_dir() {
        state.running.store(false, Ordering::SeqCst);
        return Err(format!(
            "Workspace root '{}' is not a valid directory",
            workspace_root
        ));
    }

    let workflow: RawWorkflow = match serde_yaml::from_str(&yaml) {
        Ok(w) => w,
        Err(e) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(format!("Failed to parse workflow YAML: {}", e));
        }
    };

    // Validate step count
    if workflow.steps.len() > 50 {
        state.running.store(false, Ordering::SeqCst);
        return Err(format!(
            "Workflow has {} steps (max 50)",
            workflow.steps.len()
        ));
    }

    // Validate supported features — reject what the runner can't handle yet
    for (i, step) in workflow.steps.iter().enumerate() {
        let step_id = step.id.as_deref().unwrap_or("(unnamed)");
        if step.uses.starts_with("genie/") {
            state.running.store(false, Ordering::SeqCst);
            return Err(format!(
                "Step {} ('{}') uses genie execution which is not yet implemented",
                i + 1, step_id
            ));
        }
        if step.uses.starts_with("webhook/") {
            state.running.store(false, Ordering::SeqCst);
            return Err(format!(
                "Step {} ('{}') uses webhook execution which is not yet implemented",
                i + 1, step_id
            ));
        }
    }

    // Generate execution ID and return immediately
    let execution_id = Uuid::new_v4().to_string();
    let exec_id_clone = execution_id.clone();
    let cancel_token = Arc::clone(&state.cancel_requested);
    let running_flag = Arc::new(AtomicBool::new(true));
    // We need a second reference to clear the flag after the task finishes.
    // Since WorkflowRunnerState is behind a State<'_>, we clone the AtomicBool's
    // address via a raw pointer dance — but that's unsafe. Instead, use a
    // separate Arc for the spawned task and sync back via event.
    let app_clone = app.clone();

    // Create snapshot of files that may be modified
    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
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

    // Spawn runner as background task — return ID immediately
    tokio::spawn(async move {
        let result = run_workflow_sequential(
            &app_clone,
            workflow,
            env,
            &workspace,
            &exec_id_clone,
            &cancel_token,
        )
        .await;

        if let Err(e) = result {
            log::error!("Workflow execution failed: {}", e);
        }

        // Clear the running flag via event (the State<'_> isn't accessible here)
        use tauri::Emitter;
        let _ = app_clone.emit("workflow:runner-idle", ());
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
        return Err("No workflow is currently running".to_string());
    }
    state.cancel_requested.store(true, Ordering::SeqCst);
    log::info!("Workflow cancellation requested");
    Ok(())
}
