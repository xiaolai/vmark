//! Coherence capture for workflow `action/save-file` writes
//! (in-process, no IPC). The runner is the capture site: it knows the
//! step graph, so the input set is computed by walking template
//! references (`${{ steps.X... }}` and bare `X.output` aliases)
//! transitively from the save step to the `action/read-file` steps that
//! actually feed it — reachable reads become `direct` inputs; unrelated
//! reads never pollute the edge set (spec §7). Fire-and-forget: capture
//! failures log and never fail the workflow step.
//!
//! The capture honours `general.coherenceCaptureOnSave` (WI-LX1.4) like every
//! other write path: `run_workflow` passes the run's `CapturePolicy` to the
//! runner as an ARGUMENT, the runner hands it to each capture, and
//! `capture_with_policy` applies it — with the setting off and no ledger, a
//! save-file step creates no `.vmark/` and stamps nothing. A run that carried
//! no policy is treated as off. It used to ride in `WorkflowRunnerState`, an
//! app-global slot whose correctness rested on one-run-at-a-time.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use crate::coherence::capture::{CaptureInputSpec, CaptureRequest};
use crate::coherence::capture_policy::{capture_with_policy, CapturePolicy};
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
    // Bare whole-value alias `X.output` (legacy grammar), judged by the
    // EXECUTOR's own rule. This used to accept any `known_id.<anything>`
    // whose whole value was `[A-Za-z0-9._-]`, so a step named `read` turned the
    // literal `read.text` — and even a plain filename like `read.md` — into a
    // dependency edge. `resolve` substitutes neither, so those edges recorded a
    // dataflow that never happened.
    if let Some(id) = super::expressions::bare_alias_id(value) {
        if known_ids.contains(id) {
            out.push(id.to_string());
        }
    }
    out
}

/// Every step `target_id` transitively depends on, by template reference —
/// including `target_id` itself (BFS).
///
/// One walk, two questions: which reads feed the save, and whether a
/// model was among the steps that produced it. Asking them separately would be
/// two traversals that can disagree about what "feeding this step" means.
fn reachable_from(steps: &[StepSlice], target_id: &str) -> HashSet<String> {
    let by_id: HashMap<&str, &StepSlice> = steps.iter().map(|s| (s.0.as_str(), s)).collect();
    let known_ids: HashSet<&str> = by_id.keys().copied().collect();
    let mut seen: HashSet<String> = HashSet::from([target_id.to_string()]);
    let mut queue: VecDeque<String> = VecDeque::from([target_id.to_string()]);
    while let Some(id) = queue.pop_front() {
        let Some((_, _, with)) = by_id.get(id.as_str()) else {
            continue;
        };
        for value in with.values() {
            for referenced in referenced_ids(value, &known_ids) {
                if by_id.contains_key(referenced.as_str()) && seen.insert(referenced.clone()) {
                    queue.push_back(referenced);
                }
            }
        }
    }
    seen
}

/// Transitive `action/read-file` paths feeding `target_id`.
pub fn direct_input_paths(steps: &[StepSlice], target_id: &str) -> Vec<String> {
    let reachable = reachable_from(steps, target_id);
    let mut paths: Vec<String> = steps
        .iter()
        .filter(|(id, uses, _)| reachable.contains(id) && uses == "action/read-file")
        .filter_map(|(_, _, with)| with.get("path").cloned())
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

/// A workspace path as coherence keys it: relative to `workspace_root`, with
/// `/` separators and no `./` prefix, or `None` when it resolves outside.
///
/// Resolution is by CANONICALIZATION where the file exists, so two spellings
/// of one object — an alias, an absolute path, a `./` prefix — normalize to
/// the same key. A path that does not exist yet cannot be canonicalized, so it
/// is normalized lexically instead: a save target is written moments later,
/// and refusing to record it would lose the edge entirely.
fn normalize_in_workspace(path: &str, workspace_root: &Path) -> Option<String> {
    let root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let joined = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        root.join(path)
    };
    let resolved = joined.canonicalize().unwrap_or(joined);
    let relative = resolved.strip_prefix(&root).ok()?;
    let text = relative.to_str()?.replace(std::path::MAIN_SEPARATOR, "/");
    (!text.is_empty()).then_some(text)
}

/// Who a save-file step's content should be attributed to.
///
/// Not always the model. A workflow may be actions only — read a file,
/// transform it, save it — and the kernel then recorded `AgentType::Model` /
/// `workflow-genie` over content no model ever saw, which is a provenance
/// ledger asserting something false about how a document came to be. The
/// distinction is what the workflow's steps USE: a `genie/*` step calls a
/// provider, an `action/*` step does not.
///
/// `External` is the class `coherence/adopt.rs` already uses for content a
/// process outside VMark's editor produced, which is what an action-only
/// workflow run is.
fn agent_for(steps: &[StepSlice], reachable: &HashSet<String>) -> Agent {
    let model_ran = steps
        .iter()
        .filter(|(id, _, _)| reachable.contains(id))
        .any(|(_, uses, _)| uses.starts_with("genie/"));
    if model_ran {
        Agent {
            kind: AgentType::Model,
            id: Some("workflow-genie".into()),
        }
    } else {
        Agent {
            kind: AgentType::External,
            id: Some("workflow".into()),
        }
    }
}

/// One successful save-file step, as its capture needs it (this was eight
/// positional arguments, four of them `&str`, under a lint suppression).
pub struct SaveFileCapture<'a> {
    pub workspace_root: &'a Path,
    /// The step's `with.path`, as written.
    pub rel_path: &'a str,
    pub content: &'a str,
    /// The `action/read-file` paths feeding the save, as written.
    pub input_paths: &'a [String],
    pub step_id: &'a str,
    pub agent: Agent,
    pub policy: CapturePolicy,
}

/// Capture one successful save-file step into a workspace kernel, under the
/// run's capture policy.
pub fn capture_save_file(
    kernel: &mut WorkspaceKernel,
    save: SaveFileCapture<'_>,
) -> Result<(), String> {
    let SaveFileCapture {
        workspace_root,
        rel_path,
        content,
        input_paths,
        step_id,
        agent,
        policy,
    } = save;
    // Coherence keys objects on a NORMALIZED workspace-relative path, so a
    // raw `with.path` cannot be handed to it as written.
    // `action/read-file` accepts `./notes.md`, `notes.md`, an absolute path
    // inside the workspace and a symlink alias for any of them — all valid,
    // all the same object, and all previously recorded as distinct names. The
    // consequences are two: an edge to a name no object carries, and a
    // self-edge that fails to suppress because `./out.md` did not compare
    // equal to `out.md`.
    let target = normalize_in_workspace(rel_path, workspace_root);
    let inputs = input_paths
        .iter()
        .filter_map(|p| normalize_in_workspace(p, workspace_root))
        .filter(|p| Some(p.as_str()) != target.as_deref())
        .map(|p| CaptureInputSpec {
            path: Some(p),
            object_id: None,
            revision: None,
            role: InputRole::Direct,
            kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
        })
        .collect();
    capture_with_policy(
        kernel,
        CaptureRequest {
            path: target.unwrap_or_else(|| rel_path.to_string()),
            content: content.to_string(),
            inputs,
            agent,
            intent: Intent {
                kind: "workflow".into(),
                summary: format!("action/save-file ({step_id})"),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
        policy,
    )
    .map(|_| ())
}

/// Runner-facing entry: runs off-thread but is AWAITED by the runner
/// (captures land in step order; a same-path later step can
/// never record before an earlier one). Failures log; steps never fail.
/// `policy` is the run's own, passed down from `run_workflow`.
pub async fn capture_save_file_ordered<R: Runtime>(
    app: &AppHandle<R>,
    workspace_root: &Path,
    steps: Vec<StepSlice>,
    step_id: String,
    rel_path: String,
    content: String,
    policy: CapturePolicy,
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
        // A poisoned kernel may hold a half-rebuilt index; it refuses until
        // reopened (logged by the helper), and the step is untouched.
        let Some(mut kernel) = crate::lock_policy::lock_or_refuse(
            &kernel,
            "the coherence kernel (workflow capture skipped)",
        ) else {
            return;
        };
        let reachable = reachable_from(&steps, &step_id);
        let inputs = direct_input_paths(&steps, &step_id);
        let save = SaveFileCapture {
            workspace_root: &root,
            rel_path: &rel_path,
            content: &content,
            input_paths: &inputs,
            step_id: &step_id,
            agent: agent_for(&steps, &reachable),
            policy,
        };
        if let Err(e) = capture_save_file(&mut kernel, save) {
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
