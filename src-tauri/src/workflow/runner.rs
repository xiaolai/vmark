//! Workflow runner with topological ordering and cancellation.
//!
//! Executes workflow steps respecting `needs:` dependencies via topological
//! sort. Steps without unmet dependencies run in declaration order.
//! All file operations are sandboxed to the workspace root directory.
//!
//! Key decisions:
//!   - Path sandboxing via `sandbox::validate_path` for all file I/O
//!   - Resource limits: max 1000 files, 10MB per file, 100MB total in read-folder
//!   - Event emission failures are logged, not silently dropped
//!   - Unimplemented step types (genie, webhook) return Err, not fake Ok
//!   - Returns Err when any step fails (not Ok with silent failure)
//!   - Env substitution uses regex for embedded `${VAR}` patterns
//!   - Cancellation checked before each step via shared AtomicBool
//!   - Steps ordered by topological sort on `needs:` dependencies

use super::approval::{ApprovalRegistry, ApprovalRequest};
use super::condition::evaluate_condition;
use super::expressions::{self, WorkflowOutputs};
use super::genie_step::{self, LoadedGenie, ProviderConfig};
use super::sandbox::validate_path;
use super::step_config::resolve_step_config;
use super::types::*;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

// Resource limits for file actions
const MAX_FILES_PER_FOLDER: usize = 1000;
const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_READ_BYTES: u64 = 100 * 1024 * 1024; // 100MB
const MAX_OUTPUT_SIZE_BYTES: usize = 5 * 1024 * 1024; // 5MB per step output in IPC

/// Emit a Tauri event, logging failures instead of silently dropping them.
fn emit_event<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(e) = app.emit(event, payload.clone()) {
        log::error!("Failed to emit '{}': {}", event, e);
        if event == "workflow:complete" {
            if let Err(e2) = app.emit(event, payload) {
                log::error!("Retry failed for '{}': {}", event, e2);
            }
        }
    }
}

/// A resolved step with its ID and dependencies.
#[derive(Debug)]
struct ResolvedStep {
    id: String,
    step: RawStep,
    needs: Vec<String>,
}

/// Topologically sort steps by `needs:` dependencies.
/// Returns steps in execution order. Steps with no deps come first.
fn topological_sort(steps: Vec<RawStep>) -> Result<Vec<ResolvedStep>, String> {
    // Build resolved steps with IDs
    let mut resolved: Vec<ResolvedStep> = Vec::new();
    let mut id_set: HashSet<String> = HashSet::new();

    for step in steps {
        let id = step.id.clone().unwrap_or_else(|| {
            step.uses
                .split('/')
                .next_back()
                .unwrap_or("step")
                .to_string()
        });
        let needs = step.needs.to_vec();
        // Duplicate IDs would silently overwrite earlier steps in step_map
        // below, dropping work — fail loudly instead.
        if !id_set.insert(id.clone()) {
            return Err(format!(
                "Duplicate step id '{}' — every step needs a unique id",
                id
            ));
        }
        resolved.push(ResolvedStep { id, step, needs });
    }

    // Validate all needs references exist
    for rs in &resolved {
        for dep in &rs.needs {
            if !id_set.contains(dep) {
                return Err(format!(
                    "Step '{}' depends on unknown step '{}'",
                    rs.id, dep
                ));
            }
        }
    }

    // Kahn's algorithm for topological sort
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

    for rs in &resolved {
        in_degree.entry(rs.id.clone()).or_insert(0);
        adjacency.entry(rs.id.clone()).or_default();
        for dep in &rs.needs {
            adjacency
                .entry(dep.clone())
                .or_default()
                .push(rs.id.clone());
            *in_degree.entry(rs.id.clone()).or_insert(0) += 1;
        }
    }

    let mut queue: VecDeque<String> = VecDeque::new();
    // Seed with steps that have no dependencies, preserving declaration order
    for rs in &resolved {
        if *in_degree.get(&rs.id).unwrap_or(&0) == 0 {
            queue.push_back(rs.id.clone());
        }
    }

    let mut sorted_ids: Vec<String> = Vec::new();
    while let Some(id) = queue.pop_front() {
        sorted_ids.push(id.clone());
        if let Some(dependents) = adjacency.get(&id) {
            for dep_id in dependents {
                if let Some(deg) = in_degree.get_mut(dep_id) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(dep_id.clone());
                    }
                }
            }
        }
    }

    if sorted_ids.len() != resolved.len() {
        return Err(rust_i18n::t!("errors.workflow.circularDependency").to_string());
    }

    // Reorder resolved steps by sorted order
    let mut step_map: HashMap<String, ResolvedStep> =
        resolved.into_iter().map(|rs| (rs.id.clone(), rs)).collect();
    let mut ordered = Vec::new();
    for id in sorted_ids {
        if let Some(rs) = step_map.remove(&id) {
            ordered.push(rs);
        }
    }

    Ok(ordered)
}

/// Outcome of the approval wait — explicit so the caller doesn't have to
/// reason about which `Result` variant came from where.
enum ApprovalOutcome {
    Approved,
    Denied,
    /// Sender side dropped without delivering a value (window close, etc.).
    ChannelClosed,
    /// Approval window expired.
    TimedOut,
    /// Workflow was cancelled while the dialog was open.
    Cancelled,
}

/// Build the preview the approval dialog shows.
///
/// For genie steps, attempts to load the genie and fill its template against
/// `resolved_params` so the preview matches what the model will actually
/// receive. Falls back to the raw `with.input` / `with.content` / `with.prompt`
/// value if the genie can't be loaded (so non-genie steps and authoring-time
/// errors still get a useful preview).
async fn build_approval_preview(
    step: &RawStep,
    resolved_params: &HashMap<String, String>,
    genies_dir: Option<&Path>,
) -> String {
    const PREVIEW_BYTES: usize = 500;

    if let Some(name) = step.uses.strip_prefix("genie/") {
        if let Some(dir) = genies_dir {
            if let Ok(path) = genie_step::find_genie_file(dir, name) {
                if let Ok(raw) = tokio::fs::read_to_string(&path).await {
                    if let Ok(content) = parse_genie_content(&raw, &path) {
                        if let Ok(filled) =
                            super::template::fill(&content.template, resolved_params)
                        {
                            return filled.chars().take(PREVIEW_BYTES).collect();
                        }
                    }
                }
            }
        }
    }

    resolved_params
        .get("input")
        .or_else(|| resolved_params.get("content"))
        .or_else(|| resolved_params.get("prompt"))
        .map(|s| s.chars().take(PREVIEW_BYTES).collect())
        .unwrap_or_default()
}

/// Convert the legacy `Arc<AtomicBool>` cancel flag into a polling task that
/// flips a `CancellationToken`. Bridges the existing API to the new tokio
/// cancellation primitive used by `run_ai_prompt_collect`.
///
/// Wrapped in `spawn_logged` so a panic inside the polling loop surfaces in
/// the log instead of silently leaking a cancel token (which would let the
/// downstream AI request run past its caller's cancel signal).
fn spawn_cancel_bridge(
    legacy: Arc<AtomicBool>,
    token: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    crate::task::spawn_logged("workflow-cancel-bridge", async move {
        loop {
            if legacy.load(Ordering::SeqCst) {
                token.cancel();
                return;
            }
            if token.is_cancelled() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    })
}

/// Execute a parsed workflow with topological ordering and cancellation support.
///
/// The `execution_id` is provided by the caller (commands.rs) so events can
/// be emitted with the correct ID from the start.
///
/// `provider` and `genies_dir` are required for `genie/*` steps; `None`
/// values cause genie steps to fail with a clear error rather than panic
/// (lets the runner exercise action-only workflows from contexts where no
/// AI provider has been selected yet).
#[allow(clippy::too_many_arguments)]
pub async fn run_workflow_sequential(
    app: &AppHandle,
    workflow: RawWorkflow,
    env: HashMap<String, String>,
    workspace_root: &Path,
    execution_id: &str,
    cancel_token: &Arc<AtomicBool>,
    provider: Option<ProviderConfig>,
    genies_dir: Option<PathBuf>,
    approvals: Arc<ApprovalRegistry>,
) -> Result<String, String> {
    // Bridge the legacy AtomicBool cancel flag into a CancellationToken that
    // the AI provider stack can react to without polling.
    let cancel = CancellationToken::new();
    let _bridge = spawn_cancel_bridge(Arc::clone(cancel_token), cancel.clone());

    let defaults = workflow.defaults;
    let mut outputs: WorkflowOutputs = HashMap::new();

    // Merge workflow env with provided env (provided takes precedence)
    let mut merged_env = workflow.env.clone();
    merged_env.extend(env);

    // Topologically sort steps by needs: dependencies
    let sorted_steps = topological_sort(workflow.steps)?;
    let step_count = sorted_steps.len();
    let mut failed = false;
    let mut failed_step = String::new();
    let mut completed_steps: HashSet<String> = HashSet::new();

    log::info!(
        "Workflow '{}' starting: {} steps",
        workflow.name,
        step_count
    );

    for (i, rs) in sorted_steps.into_iter().enumerate() {
        let step_id = rs.id;
        let step = rs.step;

        // Check cancellation
        if cancel_token.load(Ordering::SeqCst) {
            emit_event(
                app,
                "workflow:step-update",
                StepStatusEvent {
                    execution_id: execution_id.to_string(),
                    step_id: step_id.clone(),
                    status: "skipped".to_string(),
                    output: None,
                    error: Some("Workflow cancelled".to_string()),
                    duration: None,
                },
            );
            if !failed {
                failed = true;
                failed_step = format!("{} (cancelled)", step_id);
            }
            continue;
        }

        // Skip if a dependency failed
        if failed || rs.needs.iter().any(|dep| !completed_steps.contains(dep)) {
            emit_event(
                app,
                "workflow:step-update",
                StepStatusEvent {
                    execution_id: execution_id.to_string(),
                    step_id: step_id.clone(),
                    status: "skipped".to_string(),
                    output: None,
                    error: None,
                    duration: None,
                },
            );
            continue;
        }

        // Evaluate condition (if: field). Fail-loud (RW-6 / L10): an
        // unparseable condition fails the step, never silently passes.
        if let Some(condition) = &step.condition {
            match evaluate_condition(condition, &outputs, &merged_env, failed) {
                Ok(true) => {} // proceed
                Ok(false) => {
                    emit_event(
                        app,
                        "workflow:step-update",
                        StepStatusEvent {
                            execution_id: execution_id.to_string(),
                            step_id: step_id.clone(),
                            status: "skipped".to_string(),
                            output: None,
                            error: Some(format!("Condition not met: {}", condition)),
                            duration: None,
                        },
                    );
                    continue;
                }
                Err(e) => {
                    failed = true;
                    failed_step = step_id.clone();
                    emit_event(
                        app,
                        "workflow:step-update",
                        StepStatusEvent {
                            execution_id: execution_id.to_string(),
                            step_id,
                            status: "error".to_string(),
                            output: None,
                            error: Some(format!("Condition evaluation failed: {}", e)),
                            duration: None,
                        },
                    );
                    continue;
                }
            }
        }

        // Emit running status
        emit_event(
            app,
            "workflow:step-update",
            StepStatusEvent {
                execution_id: execution_id.to_string(),
                step_id: step_id.clone(),
                status: "running".to_string(),
                output: None,
                error: None,
                duration: None,
            },
        );

        let start = Instant::now();

        // Resolve parameters: output refs + env substitution
        let resolved_params =
            match resolve_params(&step.with, &outputs, &merged_env, workspace_root) {
                Ok(p) => p,
                Err(e) => {
                    failed = true;
                    failed_step = step_id.clone();
                    emit_event(
                        app,
                        "workflow:step-update",
                        StepStatusEvent {
                            execution_id: execution_id.to_string(),
                            step_id,
                            status: "error".to_string(),
                            output: None,
                            error: Some(format!("Parameter resolution failed: {}", e)),
                            duration: Some(start.elapsed().as_millis() as u64),
                        },
                    );
                    continue;
                }
            };

        // Resolve effective step timeout (ADR-6) so we can wrap execution.
        let step_config = resolve_step_config(&step, None, &defaults);
        let step_timeout = std::time::Duration::from_secs(step_config.timeout_secs);

        // Approval gate: if step.approval == "ask", emit a request event and
        // park on the registered oneshot until the dialog responds OR the
        // workflow is cancelled. Build the preview from the *resolved* prompt
        // for genie steps so the user approves what the model actually sees.
        if step_config.approval == "ask" {
            let approval_key = (execution_id.to_string(), step_id.clone());
            let rx = approvals.register(approval_key.clone());
            let preview =
                build_approval_preview(&step, &resolved_params, genies_dir.as_deref()).await;
            emit_event(
                app,
                "workflow:approval-request",
                ApprovalRequest {
                    execution_id: execution_id.to_string(),
                    step_id: step_id.clone(),
                    summary: step.uses.clone(),
                    preview,
                    model: step_config.model.clone(),
                },
            );
            let approval_timeout = step_timeout.min(std::time::Duration::from_secs(600));
            let approval_outcome = tokio::select! {
                _ = cancel.cancelled() => ApprovalOutcome::Cancelled,
                res = tokio::time::timeout(approval_timeout, rx) => match res {
                    Ok(Ok(true)) => ApprovalOutcome::Approved,
                    Ok(Ok(false)) => ApprovalOutcome::Denied,
                    Ok(Err(_)) => ApprovalOutcome::ChannelClosed,
                    Err(_) => ApprovalOutcome::TimedOut,
                },
            };
            match approval_outcome {
                ApprovalOutcome::Approved => {}
                ApprovalOutcome::Cancelled => {
                    approvals.drop_pending(&approval_key);
                    failed = true;
                    failed_step = step_id.clone();
                    emit_event(
                        app,
                        "workflow:step-update",
                        StepStatusEvent {
                            execution_id: execution_id.to_string(),
                            step_id,
                            status: "skipped".to_string(),
                            output: None,
                            error: Some("Workflow cancelled".to_string()),
                            duration: Some(start.elapsed().as_millis() as u64),
                        },
                    );
                    continue;
                }
                ApprovalOutcome::TimedOut => {
                    approvals.drop_pending(&approval_key);
                    failed = true;
                    failed_step = step_id.clone();
                    emit_event(
                        app,
                        "workflow:step-update",
                        StepStatusEvent {
                            execution_id: execution_id.to_string(),
                            step_id,
                            status: "error".to_string(),
                            output: None,
                            error: Some("Approval timed out".to_string()),
                            duration: Some(start.elapsed().as_millis() as u64),
                        },
                    );
                    continue;
                }
                ApprovalOutcome::Denied | ApprovalOutcome::ChannelClosed => {
                    failed = true;
                    failed_step = step_id.clone();
                    let err_msg = if matches!(approval_outcome, ApprovalOutcome::ChannelClosed) {
                        "Approval channel closed"
                    } else {
                        "Approval denied by user"
                    };
                    emit_event(
                        app,
                        "workflow:step-update",
                        StepStatusEvent {
                            execution_id: execution_id.to_string(),
                            step_id,
                            status: "error".to_string(),
                            output: None,
                            error: Some(err_msg.to_string()),
                            duration: Some(start.elapsed().as_millis() as u64),
                        },
                    );
                    continue;
                }
            }
        }

        // Execute step based on type, with a per-step timeout. On elapsed:
        // fire the cancel token so any in-flight AI provider work (CLI child,
        // REST request) is aborted, then surface a "Timed out" step error.
        let exec_fut = execute_step(
            &step,
            &resolved_params,
            workspace_root,
            cancel.clone(),
            provider.as_ref(),
            genies_dir.as_deref(),
            &defaults,
        );
        let result = match tokio::time::timeout(step_timeout, exec_fut).await {
            Ok(r) => r,
            Err(_elapsed) => {
                cancel.cancel();
                Err(format!("Timed out after {}s", step_config.timeout_secs))
            }
        };
        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(step_outputs) => {
                // Store full structured output for downstream step consumption.
                // Action steps + text genies have a single "text" entry; JSON
                // genies populate one entry per top-level field.
                let primary_text = step_outputs.get("text").cloned().unwrap_or_default();
                outputs.insert(step_id.clone(), step_outputs);
                completed_steps.insert(step_id.clone());
                // Truncate only for IPC emission (char-safe, no byte-boundary panic)
                let emitted_output = truncate_utf8_safe(&primary_text, MAX_OUTPUT_SIZE_BYTES);
                emit_event(
                    app,
                    "workflow:step-update",
                    StepStatusEvent {
                        execution_id: execution_id.to_string(),
                        step_id,
                        status: "success".to_string(),
                        output: Some(emitted_output),
                        error: None,
                        duration: Some(duration_ms),
                    },
                );
            }
            Err(error) => {
                failed = true;
                failed_step = step_id.clone();
                emit_event(
                    app,
                    "workflow:step-update",
                    StepStatusEvent {
                        execution_id: execution_id.to_string(),
                        step_id,
                        status: "error".to_string(),
                        output: None,
                        error: Some(error),
                        duration: Some(duration_ms),
                    },
                );
            }
        }

        log::info!(
            "Workflow '{}': step {}/{} ({}) ({}ms)",
            workflow.name,
            i + 1,
            step_count,
            if failed { "FAILED" } else { "ok" },
            duration_ms
        );
    }

    // Emit completion
    let final_status = if cancel_token.load(Ordering::SeqCst) {
        "cancelled"
    } else if failed {
        "failed"
    } else {
        "completed"
    };
    emit_event(
        app,
        "workflow:complete",
        ExecutionCompleteEvent {
            execution_id: execution_id.to_string(),
            status: final_status.to_string(),
        },
    );

    log::info!("Workflow '{}' {}", workflow.name, final_status);

    if failed {
        Err(format!(
            "Workflow '{}' failed at step '{}'",
            workflow.name, failed_step
        ))
    } else {
        Ok(execution_id.to_string())
    }
}

/// Truncate a string to at most `max_bytes` on a valid UTF-8 char boundary.
fn truncate_utf8_safe(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let safe_end = s
        .char_indices()
        .take_while(|(i, _)| *i < max_bytes)
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    format!(
        "{}...\n[Output truncated for display: {} bytes total]",
        &s[..safe_end],
        s.len()
    )
}

/// Resolve step parameters via the expression module (WI-2.3).
///
/// Supports `${{ steps.X.outputs.Y }}`, `${{ steps.X.output }}`,
/// `${{ env.NAME }}`, legacy `${VAR}`, and legacy whole-string
/// `stepId.output` aliases.
fn resolve_params(
    params: &HashMap<String, String>,
    outputs: &WorkflowOutputs,
    env: &HashMap<String, String>,
    workspace_root: &Path,
) -> Result<HashMap<String, String>, String> {
    let mut resolved = HashMap::new();

    for (key, value) in params {
        let val = expressions::resolve(value, outputs, env).map_err(|e| e.to_string())?;

        // Re-validate paths after substitution.
        if key == "path" {
            validate_path(&val, workspace_root)
                .map_err(|e| format!("Path validation failed after parameter resolution: {}", e))?;
        }

        resolved.insert(key.clone(), val);
    }

    Ok(resolved)
}

/// Execute a single step based on its `uses:` prefix.
///
/// Returns a `StepOutputs` map (step id → field → value). Action steps and
/// v0/v1-text genies populate just `{"text": ...}`; v1-JSON genies populate
/// each declared schema field as a sibling of `text`.
///
/// `genie/*` steps require `provider` and `genies_dir` — passing `None` for
/// either causes the step to fail with a clear error rather than panic, so
/// action-only workflows can run from contexts that haven't selected a
/// provider yet.
async fn execute_step(
    step: &RawStep,
    params: &HashMap<String, String>,
    workspace_root: &Path,
    cancel: CancellationToken,
    provider: Option<&ProviderConfig>,
    genies_dir: Option<&Path>,
    defaults: &RawDefaults,
) -> Result<HashMap<String, String>, String> {
    let uses = step.uses.as_str();
    if uses.starts_with("action/") {
        let text = execute_action(uses, params, workspace_root).await?;
        Ok(HashMap::from([("text".to_string(), text)]))
    } else if uses.starts_with("genie/") {
        execute_genie_step(step, params, cancel, provider, genies_dir, defaults).await
    } else if uses.starts_with("webhook/") {
        Err(format!("Webhook '{}' execution not yet implemented", uses))
    } else {
        Err(format!("Unknown step type: {}", uses))
    }
}

/// Resolve and execute a `genie/<name>` step.
///
/// Walks: name extraction → file discovery → frontmatter parse → input
/// validation → template fill → AI provider call → output validation.
/// Each failure mode produces a step-level error string suitable for the
/// `workflow:step-update` event payload.
async fn execute_genie_step(
    step: &RawStep,
    params: &HashMap<String, String>,
    cancel: CancellationToken,
    provider: Option<&ProviderConfig>,
    genies_dir: Option<&Path>,
    defaults: &RawDefaults,
) -> Result<HashMap<String, String>, String> {
    let name = genie_step::parse_genie_name(&step.uses).map_err(|e| e.to_string())?;
    let provider = provider.ok_or_else(|| {
        format!(
            "Genie '{}' requires an active AI provider — none configured for this workflow run",
            name
        )
    })?;
    let genies_dir = genies_dir.ok_or_else(|| {
        format!(
            "Genie '{}' requires a genies directory — none resolved for this workflow run",
            name
        )
    })?;

    let genie_path = genie_step::find_genie_file(genies_dir, name).map_err(|e| e.to_string())?;
    // Use tokio::fs to avoid blocking the runtime worker on slow disks.
    let raw = tokio::fs::read_to_string(&genie_path).await.map_err(|e| {
        format!(
            "Failed to read genie file '{}': {}",
            genie_path.display(),
            e
        )
    })?;

    // Parse via the same path the editor uses, so v0 + v1 frontmatter behave
    // identically. We inline the call here rather than re-export `parse_genie`
    // (private to the genies module) by going through the public Tauri command
    // surface in tests, but at runtime we need a synchronous path. Re-implement
    // the minimal slice: BOM strip + frontmatter detect + parse via serde_yaml.
    let content = parse_genie_content(&raw, &genie_path)?;

    let step_config = resolve_step_config(step, Some(&content.metadata), defaults);

    let loaded = LoadedGenie {
        metadata: content.metadata,
        template: content.template,
    };

    genie_step::execute_genie(cancel, &loaded, params, &step_config, provider)
        .await
        .map_err(|e| e.to_string())
}

/// Slim genie-content parser used by the runner.
///
/// The editor path goes through `crate::genies::commands::read_genie` which
/// is a Tauri command and can't be called from inside another Tauri command's
/// async handler without re-entering the IPC layer. This function calls the
/// same `parse_genie` underneath via the public `read_genie` Rust API exposed
/// through `genies::types::GenieContent`.
fn parse_genie_content(
    raw: &str,
    path: &Path,
) -> Result<crate::genies::types::GenieContent, String> {
    let path_str = path.to_string_lossy();
    crate::genies::parse_genie_for_runner(raw, &path_str)
        .map_err(|e| format!("Failed to parse genie '{}': {}", path.display(), e))
}

/// Execute a built-in action step.
async fn execute_action(
    uses: &str,
    params: &HashMap<String, String>,
    workspace_root: &Path,
) -> Result<String, String> {
    let action = uses.strip_prefix("action/").unwrap_or(uses);
    match action {
        "read-file" => {
            let path_str = params
                .get("path")
                .ok_or("action/read-file requires 'path' parameter")?;
            let path = validate_path(path_str, workspace_root)?;
            let meta = tokio::fs::metadata(&path)
                .await
                .map_err(|e| format!("Cannot access '{}': {}", path_str, e))?;
            if meta.len() > MAX_FILE_SIZE_BYTES {
                return Err(format!(
                    "File '{}' is too large ({} bytes, max {})",
                    path_str,
                    meta.len(),
                    MAX_FILE_SIZE_BYTES
                ));
            }
            tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| format!("Failed to read '{}': {}", path_str, e))
        }
        "read-folder" => {
            let path_str = params
                .get("path")
                .ok_or("action/read-folder requires 'path' parameter")?;
            let path = validate_path(path_str, workspace_root)?;
            // Canonical root for per-entry symlink containment checks below.
            let canonical_root = workspace_root
                .canonicalize()
                .unwrap_or_else(|_| workspace_root.to_path_buf());
            let accept = params.get("accept").map(|s| s.as_str()).unwrap_or("*");
            let mut entries = Vec::new();
            let mut total_bytes: u64 = 0;
            let mut file_count: usize = 0;
            let mut dir = tokio::fs::read_dir(&path)
                .await
                .map_err(|e| format!("Failed to read directory '{}': {}", path_str, e))?;

            while let Some(entry) = dir
                .next_entry()
                .await
                .map_err(|e| format!("Failed to read entry: {}", e))?
            {
                file_count += 1;
                if file_count > MAX_FILES_PER_FOLDER {
                    return Err(format!(
                        "Directory '{}' exceeds max file limit ({})",
                        path_str, MAX_FILES_PER_FOLDER
                    ));
                }

                let name = entry.file_name().to_string_lossy().to_string();
                if !matches_accept(&name, accept) {
                    continue;
                }

                // Resolve symlinks and verify the target stays inside the
                // workspace — the directory was validated, but an entry may
                // be a symlink pointing outside the sandbox.
                let entry_path = match tokio::fs::canonicalize(entry.path()).await {
                    Ok(p) => p,
                    Err(e) => {
                        log::warn!("Skipping unresolvable entry '{}': {}", name, e);
                        continue;
                    }
                };
                if !entry_path.starts_with(&canonical_root) {
                    log::warn!("Skipping '{}': resolves outside the workspace", name);
                    continue;
                }

                let meta = match tokio::fs::metadata(&entry_path).await {
                    Ok(m) => m,
                    Err(e) => {
                        log::warn!("Skipping unreadable file '{}': {}", name, e);
                        continue;
                    }
                };
                if !meta.is_file() {
                    continue;
                }
                if meta.len() > MAX_FILE_SIZE_BYTES {
                    log::warn!("Skipping oversized file '{}' ({} bytes)", name, meta.len());
                    continue;
                }
                total_bytes += meta.len();
                if total_bytes > MAX_TOTAL_READ_BYTES {
                    return Err(format!(
                        "Total read size exceeds limit ({} bytes)",
                        MAX_TOTAL_READ_BYTES
                    ));
                }

                match tokio::fs::read_to_string(&entry_path).await {
                    Ok(content) => {
                        entries.push(format!("--- {} ---\n{}", name, content));
                    }
                    Err(e) => {
                        log::warn!("Skipping unreadable file '{}': {}", name, e);
                    }
                }
            }
            Ok(entries.join("\n\n"))
        }
        "save-file" => {
            let path_str = params
                .get("path")
                .ok_or("action/save-file requires 'path' parameter")?;
            let path = validate_path(path_str, workspace_root)?;
            let input = params
                .get("input")
                .ok_or("action/save-file requires 'input' parameter")?;
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("Failed to create directory for '{}': {}", path_str, e))?;
            }
            tokio::fs::write(&path, input)
                .await
                .map_err(|e| format!("Failed to write '{}': {}", path_str, e))?;
            Ok(format!("Saved to {}", path_str))
        }
        "notify" => {
            let message = params.get("message").cloned().unwrap_or_default();
            log::info!("Workflow notification: {}", message);
            Ok(message)
        }
        "copy" => {
            let input = params.get("input").cloned().unwrap_or_default();
            Ok(input)
        }
        "prompt" => Err(rust_i18n::t!("errors.workflow.noInteractivePrompt").to_string()),
        _ => Err(format!("Unknown action: {}", action)),
    }
}

/// Check if a filename matches an accept pattern. Supports `*`, a single
/// suffix pattern (`*.md` / `.md`), or a comma-separated list (`*.md,*.txt`).
fn matches_accept(name: &str, accept: &str) -> bool {
    if accept.trim().is_empty() || accept == "*" {
        return true;
    }
    accept
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .any(|p| p == "*" || name.ends_with(p.trim_start_matches('*')))
}

#[cfg(test)]
#[path = "runner.test.rs"]
mod tests;
