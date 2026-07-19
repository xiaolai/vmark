//! WI-1.6 — coherence capture for workflow `action/save-file` writes
//! (in-process, no IPC). The runner is the capture site: it knows the
//! step graph, so the input set is computed by walking template
//! references (`${{ steps.X... }}` and bare `X.output` aliases)
//! transitively from the save step to the `action/read-file` steps that
//! actually feed it — reachable reads become `direct` inputs; unrelated
//! reads never pollute the edge set (spec §7). Fire-and-forget: capture
//! failures log and never fail the workflow step.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::coherence::capture::{capture, CaptureInputSpec, CaptureRequest};
use crate::coherence::commands::CoherenceState;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Agent, AgentType, Confidence, InputRole, Intent};

/// One step's dataflow-relevant slice: (derived id, uses, raw `with`).
pub type StepSlice = (String, String, HashMap<String, String>);

/// Collect `steps.<id>` and bare `<id>.<output>` references in a raw
/// template value.
fn referenced_ids(value: &str, known_ids: &HashSet<&str>) -> Vec<String> {
    let mut out = Vec::new();
    // `steps.X` refs count only inside `${{ … }}` template regions
    // (audit A-M11): a literal path like `notes/steps.foo.md` in a plain
    // param must not become a false dependency.
    let mut scan = value;
    while let Some(open) = scan.find("${{") {
        let region = &scan[open + 3..];
        let close = region.find("}}").unwrap_or(region.len());
        let inner = &region[..close];
        let mut rest = inner;
        while let Some(pos) = rest.find("steps.") {
            let after = &rest[pos + "steps.".len()..];
            let id: String = after
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if !id.is_empty() {
                out.push(id);
            }
            rest = after;
        }
        scan = &region[close..];
    }
    // Bare whole-value alias `X.output` (legacy grammar).
    let trimmed = value.trim();
    if let Some((head, _tail)) = trimmed.split_once('.') {
        if known_ids.contains(head)
            && trimmed
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        {
            out.push(head.to_string());
        }
    }
    out
}

/// Transitive `action/read-file` paths feeding `target_id` (BFS over
/// template references).
pub fn direct_input_paths(steps: &[StepSlice], target_id: &str) -> Vec<String> {
    let by_id: HashMap<&str, &StepSlice> = steps.iter().map(|s| (s.0.as_str(), s)).collect();
    let known_ids: HashSet<&str> = by_id.keys().copied().collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<&str> = VecDeque::from([target_id]);
    let mut paths = Vec::new();
    while let Some(id) = queue.pop_front() {
        let Some((_, uses, with)) = by_id.get(id) else {
            continue;
        };
        if uses == "action/read-file" {
            if let Some(path) = with.get("path") {
                if !paths.contains(path) {
                    paths.push(path.clone());
                }
            }
        }
        for value in with.values() {
            for referenced in referenced_ids(value, &known_ids) {
                if seen.insert(referenced.clone()) {
                    if let Some((id_ref, _, _)) = by_id.get(referenced.as_str()) {
                        queue.push_back(id_ref);
                    }
                }
            }
        }
    }
    paths.sort();
    paths
}

/// Capture one successful save-file step into a workspace kernel.
pub fn capture_save_file(
    kernel: &mut WorkspaceKernel,
    workspace_root: &Path,
    rel_path: &str,
    content: &str,
    input_paths: &[String],
    step_id: &str,
) -> Result<(), String> {
    let _ = workspace_root;
    let inputs = input_paths
        .iter()
        .filter(|p| p.as_str() != rel_path)
        .map(|p| CaptureInputSpec {
            path: Some(p.clone()),
            object_id: None,
            revision: None,
            role: InputRole::Direct,
            kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
        })
        .collect();
    capture(
        kernel,
        CaptureRequest {
            path: rel_path.to_string(),
            content: content.to_string(),
            inputs,
            agent: Agent {
                kind: AgentType::Model,
                id: Some("workflow-genie".into()),
            },
            intent: Intent {
                kind: "workflow".into(),
                summary: format!("action/save-file ({step_id})"),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
    )
    .map(|_| ())
}

/// Runner-facing entry: runs off-thread but is AWAITED by the runner
/// (audit A11 — captures land in step order; a same-path later step can
/// never record before an earlier one). Failures log; steps never fail.
pub async fn capture_save_file_ordered(
    app: &AppHandle,
    workspace_root: &Path,
    steps: Vec<StepSlice>,
    step_id: String,
    rel_path: String,
    content: String,
) {
    let Some(_state) = app.try_state::<CoherenceState>() else {
        return; // coherence unavailable — degrade silently
    };
    let app = app.clone();
    let root = workspace_root.to_path_buf();
    let task = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CoherenceState>();
        let kernel = match state.registry.kernel_for(&root, state.writer) {
            Ok(k) => k,
            Err(e) => {
                log::warn!("coherence: workflow capture skipped: {e}");
                return;
            }
        };
        let Ok(mut kernel) = kernel.lock() else {
            log::warn!("coherence: workflow capture skipped: kernel poisoned");
            return;
        };
        let inputs = direct_input_paths(&steps, &step_id);
        if let Err(e) =
            capture_save_file(&mut kernel, &root, &rel_path, &content, &inputs, &step_id)
        {
            log::warn!("coherence: workflow capture failed (step untouched): {e}");
        }
    });
    if task.await.is_err() {
        log::warn!("coherence: workflow capture task panicked (step untouched)");
    }
}

#[cfg(test)]
#[path = "coherence_capture.test.rs"]
mod tests;
