//! Workflow execution types.
//!
//! Source-of-truth for the YAML wire contract that workflow genie authors
//! see. The runner (`runner.rs`) and the picker dispatcher
//! (`useGenieInvocation.ts`) consume these structs; the public guide at
//! `website/guide/workflow-genies.md` mirrors the field semantics for users.
//! Keep all three in sync when fields change.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Raw YAML workflow parsed from a `.yml` file.
///
/// Field-level docs below describe the on-the-wire YAML shape. Author-facing
/// guidance — including the v1 expression grammar and template binding rules
/// — lives in `website/guide/workflow-genies.md`.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RawWorkflow {
    /// Human-readable name of the workflow. Required. Surfaces in logs and
    /// (for picker-invoked workflow genies) as the description fallback when
    /// `description:` is absent.
    pub name: String,
    /// Optional one-line description. Shown in the genie picker row.
    #[serde(default)]
    pub description: Option<String>,
    /// Workflow-scope environment variables available to every step via
    /// `${VAR}` and `${{ env.VAR }}` expressions. Merged with the per-call
    /// `env` map at `run_workflow_sequential`; the call-time map wins on
    /// key collision.
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// Workflow-level defaults applied to every step that doesn't override.
    /// Resolution order is step → genie metadata → workflow defaults →
    /// hard-coded fallback (ADR-6 in `dev-docs/plans/20260418-genie-in-workflow.md`).
    #[serde(default)]
    pub defaults: RawDefaults,
    /// Ordered list of steps. The runner enforces a 50-step ceiling at
    /// `run_workflow` to keep IPC payloads bounded; deeper pipelines should
    /// compose multiple workflows.
    pub steps: Vec<RawStep>,
}

/// Workflow-level defaults — applied to every step unless that step overrides.
///
/// Each field's precedence is documented in ADR-6. Resolution happens in
/// `step_config::resolve_step_config`.
#[derive(Debug, Default, Deserialize)]
#[allow(dead_code)]
pub struct RawDefaults {
    /// Default AI model for `genie/*` steps. Step-level `model:` overrides;
    /// genie metadata `model:` overrides defaults; provider default applies
    /// when nothing is set.
    pub model: Option<String>,
    /// Default approval mode (`"auto"` or `"ask"`). Anything else is dropped
    /// during step-config resolution.
    pub approval: Option<String>,
    /// Default execution limits applied per step. See `RawLimits`.
    pub limits: Option<RawLimits>,
}

/// A single step in a raw workflow.
///
/// `uses:` selects the step type:
///   - `action/<name>` — built-in I/O actions (read-file, save-file, etc.).
///   - `genie/<name>` — load and run a markdown genie's prompt template.
///   - `webhook/...` — reserved; not yet implemented.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RawStep {
    /// Optional explicit step identifier. When absent, the runner derives
    /// one from `uses` (last path segment). Required for downstream
    /// `${{ steps.ID.outputs.* }}` references.
    pub id: Option<String>,
    /// Step type selector — see the type-level doc for the supported prefixes.
    pub uses: String,
    /// Parameters passed to the step. Values support the full expression
    /// grammar (`${{ steps.X.outputs.Y }}`, `${{ env.NAME }}`, legacy `${VAR}`,
    /// and bare `stepId.output` aliases). For `genie/*` steps these become
    /// the template `{{key}}` substitutions per ADR-2.
    #[serde(default)]
    pub with: HashMap<String, String>,
    /// Dependency edges. The step doesn't run until every named step has
    /// completed successfully. Accepts either a bare string or a YAML list
    /// (the `untagged` `NeedsDef` enum normalizes them).
    #[serde(default)]
    pub needs: NeedsDef,
    /// Conditional execution gate. The runner currently recognizes only
    /// literal `"false"` / `"0"` (skip the step). Anything else falls through
    /// to execution; full expression evaluation is a follow-up.
    #[serde(rename = "if")]
    pub condition: Option<String>,
    /// Per-step model override. See `RawDefaults.model` for precedence.
    pub model: Option<String>,
    /// Per-step approval override. `"ask"` opens the approval dialog before
    /// the AI provider is called; `"auto"` proceeds. See `RawDefaults.approval`.
    pub approval: Option<String>,
    /// Per-step execution limits. See `RawLimits`.
    pub limits: Option<RawLimits>,
}

/// YAML-friendly `needs:` shape — accepts either a bare string or a list of
/// strings, normalized to `Vec<String>` via `to_vec`.
#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
pub enum NeedsDef {
    /// `needs:` field absent.
    #[default]
    None,
    /// Single dependency: `needs: prior-step`.
    Single(String),
    /// Multiple dependencies: `needs: [a, b]`.
    List(Vec<String>),
}

impl NeedsDef {
    pub fn to_vec(&self) -> Vec<String> {
        match self {
            NeedsDef::None => vec![],
            NeedsDef::Single(s) => vec![s.clone()],
            NeedsDef::List(v) => v.clone(),
        }
    }
}

/// Per-step (or workflow-default) execution limits.
///
/// `timeout` and `max_tokens` are now actively enforced (post-WI-2.5 +
/// audit-fix #4). `max_cost` is parsed for forward compatibility but
/// remains unenforced — see ADR-6 / D9 in
/// `dev-docs/plans/20260418-genie-in-workflow.md` for the rationale.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RawLimits {
    /// Per-step wall-clock timeout. Accepts a bare integer (seconds) or a
    /// suffixed form: `"30s"`, `"5m"`, `"1h"`. Defaults to 300 s when no
    /// step or workflow-default sets it. On elapse the runner cancels the
    /// shared cancellation token, killing CLI children and dropping REST
    /// requests, then surfaces `"Timed out after Xs"` as the step error.
    pub timeout: Option<String>,
    /// Cap on AI provider response length. Mapping is provider-specific:
    /// Anthropic body `max_tokens`, OpenAI body `max_tokens`, Google AI
    /// `generationConfig.maxOutputTokens`, Ollama `options.num_predict`.
    /// CLI providers (claude/codex/gemini) cannot enforce this and emit a
    /// warning when the field is set (D8).
    pub max_tokens: Option<u64>,
    /// Cap on AI provider cost. **Currently parsed but unenforced** — see
    /// D9: cost accounting needs per-provider pricing tables and per-model
    /// tokenizers, deferred to a future plan.
    pub max_cost: Option<String>,
}

/// Step execution status emitted to the frontend as `workflow:step-update`.
///
/// The TypeScript counterpart (`StepUpdateEvent` in `useWorkflowExecution.ts`)
/// mirrors this shape via Tauri serde camelCase rename.
#[derive(Debug, Serialize, Clone)]
pub struct StepStatusEvent {
    /// Workflow run identifier (UUID). Frontends filter events by this id.
    #[serde(rename = "executionId")]
    pub execution_id: String,
    /// Step identifier within the workflow (matches `RawStep.id` or the
    /// derived id when `id:` was absent).
    #[serde(rename = "stepId")]
    pub step_id: String,
    /// Current status. Value space is one of:
    /// `"running"`, `"success"`, `"error"`, `"skipped"`. (No `"pending"` —
    /// pending is the absence of an event for a given step.)
    pub status: String,
    /// Step's primary output for IPC display. For multi-field genie
    /// outputs this carries only the `"text"` field; full structured
    /// outputs stay Rust-side for downstream `${{ steps.X.outputs.Y }}`
    /// resolution. Truncated to 5 MB on a UTF-8 boundary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Human-readable error message when `status == "error"` or `"skipped"`.
    /// `None` on success.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Wall-clock duration in milliseconds. Set on terminal transitions
    /// (success / error / approval-timeout); `None` for `"running"` events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u64>,
}

/// Workflow-completion event, emitted as `workflow:complete` after the
/// last step's status update.
#[derive(Debug, Serialize, Clone)]
pub struct ExecutionCompleteEvent {
    /// Workflow run identifier (matches the `executionId` of every
    /// preceding `workflow:step-update` event for this run).
    #[serde(rename = "executionId")]
    pub execution_id: String,
    /// Final status. Value space is one of: `"completed"` (every step
    /// succeeded), `"failed"` (any step errored), `"cancelled"` (user
    /// cancelled mid-run).
    pub status: String,
}
