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

use super::sandbox::validate_path;
use super::types::*;
use regex::Regex;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

// Resource limits for file actions
const MAX_FILES_PER_FOLDER: usize = 1000;
const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_READ_BYTES: u64 = 100 * 1024 * 1024; // 100MB
const MAX_OUTPUT_SIZE_BYTES: usize = 5 * 1024 * 1024; // 5MB per step output in IPC

static ENV_VAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\$\{(\w+)\}").expect("Invalid env var regex"));

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
        let id = step
            .id
            .clone()
            .unwrap_or_else(|| step.uses.split('/').last().unwrap_or("step").to_string());
        let needs = step.needs.to_vec();
        id_set.insert(id.clone());
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
            adjacency.entry(dep.clone()).or_default().push(rs.id.clone());
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
    let mut step_map: HashMap<String, ResolvedStep> = resolved
        .into_iter()
        .map(|rs| (rs.id.clone(), rs))
        .collect();
    let mut ordered = Vec::new();
    for id in sorted_ids {
        if let Some(rs) = step_map.remove(&id) {
            ordered.push(rs);
        }
    }

    Ok(ordered)
}

/// Execute a parsed workflow with topological ordering and cancellation support.
///
/// The `execution_id` is provided by the caller (commands.rs) so events can
/// be emitted with the correct ID from the start.
pub async fn run_workflow_sequential(
    app: &AppHandle,
    workflow: RawWorkflow,
    env: HashMap<String, String>,
    workspace_root: &Path,
    execution_id: &str,
    cancel_token: &Arc<AtomicBool>,
) -> Result<String, String> {
    let mut outputs: HashMap<String, String> = HashMap::new();

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

        // Evaluate condition (if: field) — skip step if condition is literally "false"
        if let Some(condition) = &step.condition {
            let trimmed = condition.trim().to_lowercase();
            if trimmed == "false" || trimmed == "0" {
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
            // TODO: full expression evaluation for conditions like `step.output.length > 100`
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

        // Execute step based on type
        let result = execute_step(&step.uses, &resolved_params, workspace_root).await;
        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(output) => {
                // Store full output for downstream step consumption
                outputs.insert(step_id.clone(), output.clone());
                completed_steps.insert(step_id.clone());
                // Truncate only for IPC emission (char-safe, no byte-boundary panic)
                let emitted_output = truncate_utf8_safe(&output, MAX_OUTPUT_SIZE_BYTES);
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

/// Resolve step parameters: substitute ${VAR} env refs and step.output refs.
fn resolve_params(
    params: &HashMap<String, String>,
    outputs: &HashMap<String, String>,
    env: &HashMap<String, String>,
    workspace_root: &Path,
) -> Result<HashMap<String, String>, String> {
    let mut resolved = HashMap::new();

    for (key, value) in params {
        let mut val = value.clone();

        // 1. Env variable substitution (regex-based, handles embedded ${VAR})
        val = ENV_VAR_RE
            .replace_all(&val, |caps: &regex::Captures| {
                let var_name = &caps[1];
                env.get(var_name).cloned().unwrap_or_else(|| {
                    log::warn!("Unresolved env variable '${{{}}}'", var_name);
                    String::new()
                })
            })
            .to_string();

        // 2. Output reference resolution (stepId.output)
        if val.ends_with(".output") {
            let ref_id = val.trim_end_matches(".output");
            if let Some(output) = outputs.get(ref_id) {
                val = output.clone();
            } else {
                log::warn!(
                    "Unresolved output reference '{}.output'",
                    ref_id
                );
                return Err(format!(
                    "Step output reference '{}.output' not found — the step may have failed or been skipped",
                    ref_id
                ));
            }
        }

        // 3. Re-validate paths after substitution
        if key == "path" {
            validate_path(&val, workspace_root).map_err(|e| {
                format!("Path validation failed after parameter resolution: {}", e)
            })?;
        }

        resolved.insert(key.clone(), val);
    }

    Ok(resolved)
}

/// Execute a single step based on its `uses:` prefix.
async fn execute_step(
    uses: &str,
    params: &HashMap<String, String>,
    workspace_root: &Path,
) -> Result<String, String> {
    if uses.starts_with("action/") {
        execute_action(uses, params, workspace_root).await
    } else if uses.starts_with("genie/") {
        Err(format!(
            "Genie '{}' execution not yet implemented — requires AI provider adapter",
            uses
        ))
    } else if uses.starts_with("webhook/") {
        Err(format!(
            "Webhook '{}' execution not yet implemented",
            uses
        ))
    } else {
        Err(format!("Unknown step type: {}", uses))
    }
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

                let meta = match tokio::fs::metadata(entry.path()).await {
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

                match tokio::fs::read_to_string(entry.path()).await {
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

/// Check if a filename matches an accept pattern.
fn matches_accept(name: &str, accept: &str) -> bool {
    if accept == "*" {
        return true;
    }
    let ext = accept.trim_start_matches('*');
    name.ends_with(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_topological_sort_sequential() {
        let steps = vec![
            RawStep {
                id: Some("a".into()),
                uses: "action/read-file".into(),
                with: HashMap::new(),
                needs: NeedsDef::None,
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
            RawStep {
                id: Some("b".into()),
                uses: "genie/summarize".into(),
                with: HashMap::new(),
                needs: NeedsDef::Single("a".into()),
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
        ];
        let sorted = topological_sort(steps).unwrap();
        assert_eq!(sorted[0].id, "a");
        assert_eq!(sorted[1].id, "b");
    }

    #[test]
    fn test_topological_sort_fan_out() {
        let steps = vec![
            RawStep {
                id: Some("read".into()),
                uses: "action/read-folder".into(),
                with: HashMap::new(),
                needs: NeedsDef::None,
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
            RawStep {
                id: Some("sum".into()),
                uses: "genie/summarize".into(),
                with: HashMap::new(),
                needs: NeedsDef::Single("read".into()),
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
            RawStep {
                id: Some("translate".into()),
                uses: "genie/translate".into(),
                with: HashMap::new(),
                needs: NeedsDef::Single("read".into()),
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
            RawStep {
                id: Some("save".into()),
                uses: "action/save-file".into(),
                with: HashMap::new(),
                needs: NeedsDef::List(vec!["sum".into(), "translate".into()]),
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
        ];
        let sorted = topological_sort(steps).unwrap();
        // "read" must come first, "save" must come last
        assert_eq!(sorted[0].id, "read");
        assert_eq!(sorted[3].id, "save");
        // "sum" and "translate" are in between (order among them doesn't matter)
        let middle: HashSet<&str> = [sorted[1].id.as_str(), sorted[2].id.as_str()].into();
        assert!(middle.contains("sum"));
        assert!(middle.contains("translate"));
    }

    #[test]
    fn test_topological_sort_circular() {
        let steps = vec![
            RawStep {
                id: Some("a".into()),
                uses: "action/read-file".into(),
                with: HashMap::new(),
                needs: NeedsDef::Single("b".into()),
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
            RawStep {
                id: Some("b".into()),
                uses: "genie/summarize".into(),
                with: HashMap::new(),
                needs: NeedsDef::Single("a".into()),
                condition: None,
                model: None,
                approval: None,
                limits: None,
            },
        ];
        let result = topological_sort(steps);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Circular"));
    }

    #[test]
    fn test_topological_sort_missing_dep() {
        let steps = vec![RawStep {
            id: Some("a".into()),
            uses: "action/read-file".into(),
            with: HashMap::new(),
            needs: NeedsDef::Single("nonexistent".into()),
            condition: None,
            model: None,
            approval: None,
            limits: None,
        }];
        let result = topological_sort(steps);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown step"));
    }

    #[test]
    fn test_truncate_utf8_safe_ascii() {
        let s = "hello world";
        assert_eq!(truncate_utf8_safe(s, 100), s);
    }

    #[test]
    fn test_truncate_utf8_safe_cjk() {
        let s = "你好世界测试数据";
        // Each CJK char is 3 bytes. 8 chars = 24 bytes.
        let result = truncate_utf8_safe(s, 10);
        // Should truncate at char boundary, not panic
        assert!(result.contains("..."));
        assert!(!result.is_empty());
    }

    #[tokio::test]
    async fn test_execute_action_notify() {
        let mut params = HashMap::new();
        params.insert("message".to_string(), "Hello".to_string());
        let root = std::path::Path::new("/tmp");
        let result = execute_action("action/notify", &params, root).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Hello");
    }

    #[tokio::test]
    async fn test_execute_action_copy() {
        let mut params = HashMap::new();
        params.insert("input".to_string(), "test data".to_string());
        let root = std::path::Path::new("/tmp");
        let result = execute_action("action/copy", &params, root).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test data");
    }

    #[tokio::test]
    async fn test_execute_action_unknown() {
        let params = HashMap::new();
        let root = std::path::Path::new("/tmp");
        let result = execute_action("action/unknown", &params, root).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_execute_step_unknown_type() {
        let params = HashMap::new();
        let root = std::path::Path::new("/tmp");
        let result = execute_step("unknown/thing", &params, root).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_genie_step_returns_error() {
        let params = HashMap::new();
        let root = std::path::Path::new("/tmp");
        let result = execute_step("genie/summarize", &params, root).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_webhook_step_returns_error() {
        let params = HashMap::new();
        let root = std::path::Path::new("/tmp");
        let result = execute_step("webhook/stripe", &params, root).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_prompt_returns_error() {
        let params = HashMap::new();
        let root = std::path::Path::new("/tmp");
        let result = execute_action("action/prompt", &params, root).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_matches_accept() {
        assert!(matches_accept("readme.md", "*"));
        assert!(matches_accept("readme.md", "*.md"));
        assert!(matches_accept("readme.md", ".md"));
        assert!(!matches_accept("readme.md", "*.txt"));
    }

    #[test]
    fn test_env_substitution_regex() {
        let env: HashMap<String, String> = [("DIR".to_string(), "notes".to_string())].into();
        let input = "output/${DIR}/file.md";
        let result = ENV_VAR_RE
            .replace_all(input, |caps: &regex::Captures| {
                env.get(&caps[1]).cloned().unwrap_or_default()
            })
            .to_string();
        assert_eq!(result, "output/notes/file.md");
    }

    #[test]
    fn test_env_substitution_multiple_vars() {
        let env: HashMap<String, String> = [
            ("A".to_string(), "hello".to_string()),
            ("B".to_string(), "world".to_string()),
        ]
        .into();
        let input = "${A}/${B}";
        let result = ENV_VAR_RE
            .replace_all(input, |caps: &regex::Captures| {
                env.get(&caps[1]).cloned().unwrap_or_default()
            })
            .to_string();
        assert_eq!(result, "hello/world");
    }

    #[test]
    fn test_resolve_params_output_ref_missing() {
        let mut params = HashMap::new();
        params.insert("input".to_string(), "missing.output".to_string());
        let outputs = HashMap::new();
        let env = HashMap::new();
        let root = std::path::Path::new("/tmp");
        let result = resolve_params(&params, &outputs, &env, root);
        assert!(result.is_err());
    }
}
