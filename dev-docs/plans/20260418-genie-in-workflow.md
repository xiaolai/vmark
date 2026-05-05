---
title: "Genie Execution Inside YAML Workflows"
created_at: "2026-04-18"
mode: "full-plan"
status: "Complete"
supersedes_sections_of: "dev-docs/plans/20260331-workflow-engine.md#WI-5.2"
owner: "xiaolai"
feature_flag: "settings.advanced.workflowEngine (isWorkflowEnabled())"
---

# Genie Execution Inside YAML Workflows

## Executive Summary

The workflow engine ships with a stubbed genie runner: `runner.rs:433` returns `"Genie '{uses}' execution not yet implemented — requires AI provider adapter"`, and `commands.rs:89` pre-rejects any workflow that uses `genie/*` steps. Visualization, topological sort, cancellation, snapshots, and action steps all work. The AI streaming provider (`run_ai_prompt`) exists for interactive editor use but only emits chunks to a window via `ai:response`; there is no internal collector.

This plan closes the stub end-to-end: refactors the AI provider core to emit via a pluggable sink, adds a collector variant for in-process use, implements `execute_genie` in the workflow runner, upgrades the expression/output model to support multi-field genie outputs, wires an approval gate, and adds a minimal Run/Cancel UX on the existing `WorkflowSidePanel`. Total delta estimate: **~2,050 LOC** across 6 phases, all behind the existing `isWorkflowEnabled()` flag.

The plan is intentionally scoped to **text-in / text-or-json-out** genies. File-output genies, matrix expansion, and webhook steps remain deferred (they are tracked in the original workflow-engine plan and will be addressed after this plan ships).

---

## Architecture Decision Record

### ADR-1: Sink abstraction for AI provider output (not event loopback, not code duplication)

**Decision:** Introduce a single `AiSink` trait in `src-tauri/src/ai_provider/sink.rs` with two implementations: `WindowSink` (emits `ai:response` events — today's behavior) and `ChannelSink` (sends chunks to a tokio mpsc channel — new). Refactor `cli.rs`, `rest_providers.rs`, and `rest_api.rs` to emit through `&dyn AiSink` instead of a bare `&WebviewWindow`. Add `run_ai_prompt_collect(...) -> Result<String, String>` that drives a `ChannelSink` and awaits the full response.

**Context:** The workflow runner runs as a background tokio task; it needs the AI result as a string, not a stream of window events. Three options were considered:

| Option | Pros | Cons |
|---|---|---|
| A. Duplicate provider fns into `_collect` siblings | Zero refactor to streaming path | Doubles ~500 LOC of provider code; drift hazard forever |
| B. `AiSink` trait with two impls (chosen) | One code path; ~30 lines of new abstraction; providers unchanged in shape | Touches 5 provider fns (~5–15 lines each) |
| C. Event loopback — emit to window, listen in Rust | Zero change to providers | Pings the whole frontend for every chunk of every internal genie call; complicates lifetime of listeners; harder to reason about cancellation |

**Consequences:** One emission path for both UI streaming and in-process collection. Future consumers (MCP workflow trigger, headless scripting) also get the collector for free. Providers now depend on `sink::AiSink` instead of `WebviewWindow` directly — the public command `run_ai_prompt` constructs a `WindowSink` and keeps its current signature.

### ADR-2: Template binding — every `with:` key becomes `{{key}}`; `{{content}}` and `{{context}}` are v0 compatibility aliases

**Decision:** Move template filling into Rust (`src-tauri/src/workflow/template.rs`). Substitution rules (in this precedence):

1. `{{input}}` → `with.input` (required for v1 genies).
2. `{{content}}` → `with.content` if present, else `with.input`. **Fatal error if neither is present** and the template contains `{{content}}`.
3. `{{context}}` → `with.context` if present, else the empty string. Never fatal (context was always editor-side extraction; dropping it in workflow mode is the honest degradation).
4. `{{key}}` → `with.key` for every other key in the step's `with:` map.
5. **Unbound placeholders are a fatal step error.** The executor returns `Err("Unbound placeholders: {{foo}}, {{bar}}")` listing every unresolved name. No LLM call is made.

**Context:** Existing genies use `{{content}}` and `{{context}}` filled by editor extraction. Workflow steps supply `with:` key/value pairs and have no editor. V1 genies declare `input.type`/`output.type` but the template body still uses `{{content}}`-like placeholders. We need a binding that works for both v0 and v1 authored templates without magic.

The original draft of this ADR made unbound placeholders a soft warning. That was wrong: shipping a prompt containing literal `{{foo}}` to the LLM produces silently-wrong output and the step reports "success" — the worst possible failure mode. Fatal is correct; the two v0 aliases are the only semantically-safe relaxations.

**Consequences:** V0 genies run unmodified in workflows as long as the caller supplies `with.input` (or `with.content`). V1 genies get a real contract: every `{{placeholder}}` in the template must resolve, or the step fails before any token is spent. `{{context}}` in v0 templates degrades to empty string in workflow mode — genies that genuinely depend on editor context must supply `with.context` explicitly.

### ADR-3: Expression syntax — `${{ steps.ID.outputs.FIELD }}` with `stepId.output` alias

**Decision:** Extend `resolve_params` in `runner.rs` to support:

- `${{ env.NAME }}` — environment variable (new explicit form).
- `${NAME}` — environment variable (existing form, preserved).
- `${{ steps.ID.outputs.FIELD }}` — structured step output.
- `${{ steps.ID.output }}` — default/text output (sugar for `${{ steps.ID.outputs.text }}`).
- `stepId.output` (bare, full-string match only) — legacy alias that resolves to `${{ steps.stepId.outputs.text }}`.

Change the `outputs` map type from `HashMap<String, String>` to `HashMap<String, HashMap<String, String>>`. Action steps populate `{"text": "..."}`; genie steps populate `{"text": "...", "<k>": "..."}` for each declared field in v1 `output` (when `output.type: json`).

**Context:** Today's `resolve_params` only matches when a parameter value `.ends_with(".output")` and only stores a single string per step. Genies with structured output need multi-field access. GitHub Actions-style `${{ }}` is familiar to authors and is already called out in ADR-4 of the parent plan (which said "Dropped: ${{ }} expressions") — we selectively re-introduce the minimum needed subset. No arithmetic, no conditionals in expressions for this plan.

**Consequences:** Expression parser is a ~80 LOC regex + resolver. Existing action-step tests that rely on `stepId.output` keep working via the alias. Frontend YAML lint (future) can preview unresolved refs.

### ADR-4: Approval is a synchronous in-runner wait — not a checkpoint/resume

**Decision:** When a step's effective `approval` resolves to `ask`, the runner emits `workflow:approval-request` with `{ executionId, stepId, summary, preview }` and awaits a `tokio::sync::oneshot` receiver. The frontend opens a dialog, user decides, frontend calls a new `respond_workflow_approval(execution_id, step_id, approved)` command, the command sends on the oneshot sender. Timeout: the shorter of step `limits.timeout` (if set) or 10 minutes.

**Context:** Approval was planned in WI-5.5 of the parent plan but not implemented. A checkpoint-resume model (persist state, shut down runner, restart on response) is strictly more general but requires serializable state and workspace root re-validation. For a single-window desktop app, an in-process wait is simpler and equally safe: the user can't "approve later" across an app restart anyway (workflow is transient).

**Consequences:** Approval has one outstanding request per execution at a time (sequential runner matches this). Timeout becomes a failure mode; tests must cover it. Adds `approval_senders: Mutex<HashMap<String, oneshot::Sender<bool>>>` to `WorkflowRunnerState`. Approval applies to genie steps specifically in this plan; `action/save-file` approval is layered on top once the event pair is in place (stretch goal, not a blocker).

### ADR-5: Output type support — `text` and `json` only; `file` / `files` deferred

**Decision:** Genie v1 `output.type` values handled in this plan:

- `text` — return the raw AI response as `{"text": response}`.
- `json` — parse response as JSON; if `output.schema` is present, validate shape (keys/types); populate outputs map with each top-level field. Schema validation is minimal (keys exist, types match) — no JSON Schema library.

Deferred (returns "unsupported output type" error from runner): `file`, `files`, `pipe`.

**Context:** File-output genies need workspace-relative path validation, snapshot integration, and a sandboxed write surface — all achievable but each adds its own failure mode. Shipping `text` + `json` covers 95% of "transfer genie commands to workflows" cases without blocking on file I/O semantics.

**Consequences:** A v1 genie declaring `output.type: file` fails fast at step execution with a clear error. The sample workflow shipped in WI-6.1 exercises the `text` path (bundled genies are v0 per D11). JSON-output tests live alongside WI-2.2 using synthetic v1 genie fixtures.

### ADR-6: Per-step `model` / `approval` / `limits` — step wins over genie default wins over workflow default

**Decision:** Resolution order for each field when executing a genie step:

| Field | Precedence (highest first) |
|---|---|
| `model` | `step.model` → `genie.metadata.model` → `workflow.defaults.model` → provider default |
| `approval` | `step.approval` → `genie.metadata.approval` → `workflow.defaults.approval` → `auto` |
| `limits.timeout` | `step.limits.timeout` → `workflow.defaults.limits.timeout` → 300s (AI CLI default) |
| `limits.max_tokens` | `step.limits.max_tokens` → `workflow.defaults.limits.max_tokens` → provider default. **REST providers only.** CLI steps with `max_tokens` set emit a single warning per workflow run (not per step) and proceed unconstrained. |
| `limits.max_cost` | **Out of scope for this plan** — see D9. Accepted in YAML for forward compatibility but not surfaced in UI and not enforced. |

**Context:** `RawStep` already has `model`, `approval`, `limits` fields. `WorkflowDefaults` in the TS types exists but Rust `RawWorkflow` only reads `env` and `steps` from the YAML. We need to add `defaults` parsing on the Rust side.

**Consequences:** New `RawWorkflow.defaults` serde field. Resolution logic centralized in a new `step_config.rs` module. `max_cost` is silently ignored; the field is not mentioned in the user-facing guide so authors are not misled into thinking it is a guardrail.

---

## Decision Log (internal, non-ADR)

- **D1:** V0 genies are allowed in workflows as long as they supply `with.input` or `with.content`. **Rejected:** v1-only. **Rationale:** 13 bundled genies are all v0; hard cutoff would force conversion before anything runs.
- **D2:** Approval dialog uses a diff-free "preview string" (first 500 chars of the filled prompt + resolved model/limits). **Rejected:** diff view. **Rationale:** genie output is a string replacing nothing — no diff exists until after execution. The parent plan's WI-5.5 diff is about file-write approval (deferred to the file/files output phase).
- **D3:** `run_ai_prompt_collect` does NOT time out internally; the runner wraps it in `tokio::time::timeout(step_timeout, ...)`. **Rejected:** built-in timeout. **Rationale:** avoids duplicated timeout logic; step timeout is the canonical source.
- **D4:** Genie output streaming into the React Flow node preview is deferred to Phase 5 (UX polish), behind a setting. Phase 2 runner emits only terminal `success`/`error` events for genie steps. **Rationale:** correctness first, streaming UX later; the `workflow:step-update` event shape can carry an optional `chunk` field from day one without breaking consumers.
- **D5:** `workflow:genie-chunk` event (if added in Phase 5) is per-step, not aggregated. Frontend filters by `executionId + stepId`. **Rationale:** matches existing `workflow:step-update` filtering model.
- **D6:** Template fill is implemented in Rust, not frontend. **Rejected:** frontend fills then sends to runner. **Rationale:** runner is authoritative; frontend-side filling would duplicate logic and break MCP-triggered workflows.
- **D7 (closes Q-1):** Unbound template placeholders are a **fatal step error**, except for the two named v0 aliases: `{{content}}` degrades to `with.content` / `with.input` (fatal if neither present), and `{{context}}` degrades to the empty string. **Rejected:** soft warning with literal-passthrough. **Rationale:** shipping a prompt with literal `{{foo}}` silently produces garbage output and misreports success — worst failure mode. Fatal surfaces the author error before any tokens are spent.
- **D8 (closes Q-2):** REST providers enforce `limits.max_tokens`; CLI providers accept the field without enforcement. Each workflow run emits exactly one warning log if any CLI step has `max_tokens` set (not per-step, to avoid log flooding). **Rejected:** parse-time rejection for CLI steps. **Rationale:** users want their workflow to run; degraded enforcement beats a hard stop.
- **D9 (closes Q-3):** `limits.max_cost` is **dropped from this plan entirely**. The YAML field is still accepted by serde for forward compatibility, but the guide does not mention it, no UI surfaces it, and nothing enforces it. **Rejected:** "parse and surface, do not enforce" (would mislead users into thinking it's a guardrail). **Rationale:** cost accounting done right needs per-provider pricing tables, per-model tokenizers, and partial-run handling; half-measure is worse than nothing. Defer to a dedicated future plan.
- **D10 (closes Q-4):** Workflows require an open workspace. **Rejected:** optional workspace for genie-only workflows. **Rationale:** the UX path is "open a `.yml` file in a workspace → side panel → Run"; there is no reachable UX that runs a workflow without a workspace. Revisit when MCP-triggered workflows land.
- **D11 (closes Q-5):** **Zero bundled genies are converted to v1 in this plan.** WI-0.1 (nested-frontmatter parse) still lands as future-proofing for authors who opt into v1, but the shipped catalog stays v0. The sample workflow in WI-6.1 uses a v0 genie to prove the v0 → workflow path works. **Rejected:** converting 3 genies. **Rationale:** with ADR-2 aliasing, v0 genies run in workflows unmodified; converting a subset is ceremony — it either signals "v1 is the right way" (mandating 13 conversions) or "v1 is optional" (making partial conversion arbitrary).

---

## Constraints & Dependencies

- **Runtime/toolchain:** Node 22 (pnpm), Rust stable, Tauri v2. No new crates required. Frontend adds 0 new npm deps.
- **OS/platform:** macOS primary. Windows/Linux best-effort. CLI-provider spawning already platform-neutral via `ai_provider::build_command`.
- **External services:** none new. Uses existing CLI provider binaries (claude, codex, gemini) and REST endpoints (anthropic, openai, google-ai, ollama-api).
- **Required env/secrets:** REST provider API keys via existing `aiProviderStore`. No new secret surface.
- **Feature flags:** everything gated on `isWorkflowEnabled()` (reads `settingsStore.advanced.workflowEngine`). Default off for users.
- **Coexistence:** existing `useGenieInvocation` editor path must remain unchanged in behavior. Tests for it stay green.

---

## Current Behavior Inventory (grounded)

Observed in-tree at commit `7bc49c52` on `main`:

### Workflow side

| Area | File | State |
|---|---|---|
| YAML schema (TS) | `src/lib/workflow/types.ts` | Full — has `WorkflowStep`, `WorkflowEdge`, `WorkflowDefaults`, `WorkflowLimits`, matrix field |
| YAML schema (Rust) | `src-tauri/src/workflow/types.rs` | Partial — `RawWorkflow` missing `defaults`, `triggers`. `RawStep` missing `matrix` |
| Parser | `src/lib/workflow/parser.ts` | Working — full WorkflowGraph output |
| Layout | `src/lib/workflow/layout.ts` | Working — dagre-based |
| Canvas | `src/plugins/workflowPreview/WorkflowPreview.tsx` | Working — React Flow, activeStep highlight, click→yamlLine callback |
| Side panel | `src/plugins/workflowPreview/WorkflowSidePanel.tsx` | Working — passive view only, **no Run/Cancel controls** |
| Source-mode preview | `src/plugins/codemirror/sourceWorkflowPreview.ts` | Working — debounced parse, writes `workflowPreviewStore` |
| Runner core | `src-tauri/src/workflow/runner.rs:144` | Working — topo sort, cancel token, event emission |
| Param resolution | `src-tauri/src/workflow/runner.rs:373` | Partial — only `${VAR}` regex and bare `stepId.output` terminator match |
| Outputs storage | `runner.rs:152` | `HashMap<String, String>` — single string per step |
| Action executor | `runner.rs:449` | Working — `read-file`, `read-folder`, `save-file`, `notify`, `copy` |
| Genie executor | `runner.rs:433` | **Stub — returns Err** |
| Webhook executor | `runner.rs:438` | **Stub — returns Err** |
| Pre-validation | `commands.rs:89` | **Rejects any workflow with `genie/*` or `webhook/*` steps** before spawn |
| Snapshots | `workflow/snapshots.rs` | Working — only triggered by `action/save-file` path globbing |
| Approval | all files | Not implemented — field parsed, never read |
| Matrix expansion | all files | Not implemented — TS parser reads it, Rust struct does not |
| Frontend `run_workflow` caller | `src/**` | **None — no UI invocation of the command exists** |

### Genie side

| Area | File | State |
|---|---|---|
| Definition (TS) | `src/types/aiGenies.ts` | `GenieMetadata` + `GenieMetadataV1`. `isGenieV1` type guard |
| Frontmatter parser | `src-tauri/src/genies/parsing.rs:87` | **Flat k/v only. Nested YAML for v1 `input`/`output` explicitly deferred.** Uses `input_type:`, `output_type:` workaround keys |
| Discovery | `src-tauri/src/genies/{scanning,commands}.rs` | Working — `list_genies`, `read_genie` |
| Frontend store | `src/stores/geniesStore.ts` | Working — loads at startup, recents/favorites persisted |
| Editor invocation | `src/hooks/useGenieInvocation.ts:196` | Working — extracts from Tiptap, fills `{{content}}`/`{{context}}`, streams via `run_ai_prompt` + `listen("ai:response")`, applies to editor via ProseMirror tr or `aiSuggestionStore` |
| Bundled genies | `src-tauri/resources/genies/` | **13 genies, 0 in v1 format** |
| AI provider dispatcher | `src-tauri/src/ai_provider/mod.rs:48` | `run_ai_prompt` — streaming-only to `WebviewWindow` |
| Providers | `cli.rs`, `rest_providers.rs` | Streaming-only, take `&WebviewWindow` |

### Feature flag

- `src/utils/workflowFeatureFlag.ts:15` — reads `settingsStore.advanced.workflowEngine`, default `false`.
- `FileExplorer.tsx:50`, `useFileTree.ts:30`, `useFileOpen.ts:31`, `sourceEditorExtensions.ts:29` — all gate YAML-as-VMark-file behavior on this flag.
- No backend enforcement — any frontend that can construct a YAML string and call `run_workflow` runs. Frontend gating is sufficient because the command is not publicly exposed.

---

## Target Rules

Listed in precedence order. "Runner" = the backend tokio task in `run_workflow_sequential`.

- **R1** (Trigger: user clicks Run on a `.yml` file with the feature flag on): runner starts a background execution and returns an execution_id immediately; frontend subscribes to `workflow:step-update` and `workflow:complete` before the first step runs (already guaranteed by the command's spawn-then-return shape).
- **R2** (Trigger: a step has `uses: genie/<name>`): runner resolves genie path via `list_genies`; if not found, step fails with `"Genie '<name>' not found"`; if found, loads content via `read_genie`.
- **R3** (Trigger: any step with `with:` params): runner resolves every value via the expression parser (ADR-3) before passing to the executor. Unresolvable refs produce a step-level error, not a panic. Env vars from `workflow.env` + command-argument `env` are merged (command wins).
- **R4** (Trigger: genie step has v1 `input.type` requirement): runner validates that the step's `with:` satisfies the declared input. For `input.type: text`, `with.input` must be present and non-empty. For `input.type: json`, `with.input` must parse as JSON.
- **R5** (Trigger: effective `approval` resolves to `ask`): runner emits `workflow:approval-request`, awaits oneshot response, proceeds on `approved=true`, fails step with "Approval denied by user" on `approved=false`, fails with "Approval timed out" after `limits.timeout` or 10 min default.
- **R6** (Trigger: genie step execution): runner calls `run_ai_prompt_collect` with the resolved model / provider / api_key / endpoint / cli_path + filled template + per-step timeout. Result is stored in outputs under declared field names (or `text` for v0/unspec).
- **R7** (Trigger: provider unavailable at step time): runner fails the step with the exact message from provider detection (e.g., `"claude CLI not found on PATH"`). Subsequent dependents are skipped per existing runner contract.
- **R8** (Trigger: cancel mid-execution while a genie is streaming): runner must kill the child CLI process (for CLI providers) or drop the HTTP request (for REST). Uses existing `CancellationToken` mapped to `child.kill()` / reqwest drop. Step marked `skipped` with `"Workflow cancelled"`.
- **R9** (Trigger: workflow completes with all genie steps successful): final event is `workflow:complete { status: "completed" }`. Snapshots for any `action/save-file` steps remain on disk per existing policy. No genie-specific artifact persistence.
- **R10** (Trigger: workflow loads but feature flag is off): `run_workflow` command is still registered; frontend cannot reach the Run button (gated). Rust does not re-check the flag — frontend gating is the single source of truth.

Edge cases (must each be covered by a test):

- E1. Zero-step workflow (`steps: []`) — runner completes immediately with `status: completed`.
- E2. Step references `${{ steps.unknown.outputs.text }}` — step fails with `"Reference to unknown step 'unknown'"`.
- E3. Step references `${{ steps.prior.outputs.missing }}` where `prior` succeeded but only populated `text` — step fails with `"Step 'prior' output 'missing' not available"`.
- E4. Genie template has unbound `{{placeholder}}` — step fails fatally with `"Unbound placeholders: {{foo}}, {{bar}}"` before any LLM call (D7). Exceptions: `{{content}}` falls back to `with.content` / `with.input` (fatal only if neither present); `{{context}}` falls back to the empty string (never fatal).
- E5. Genie returns valid JSON but `output.schema` declares required key missing — step fails with `"Output missing required field '<key>'"`.
- E6. Genie returns invalid JSON when `output.type: json` — step fails with `"Output not valid JSON: <parse error snippet>"`.
- E7. Step timeout fires mid-stream — runner kills provider, step marked error with `"Timed out after Xs"`. CLI: `child.kill()`. REST: drop the reqwest future.
- E8. REST provider API key missing — step fails with the existing `require_api_key` error.
- E9. Two concurrent workflow runs — second is blocked by existing `WorkflowRunnerState.running` guard (no change).
- E10. Approval request emitted but frontend crashes / dialog dismissed by window close — oneshot closes, runner interprets as denial, step fails with `"Approval channel closed"`.
- E11. CRLF / UTF-8 BOM in genie file — parser must strip (frontmatter parser already does; no regression).
- E12. Empty genie response (model returned nothing) — step succeeds with empty string in outputs.text. Downstream ref `${{ steps.X.outputs.text }}` resolves to empty string, not error.
- E13. Unicode in step outputs — existing `truncate_utf8_safe` handles IPC truncation; runner outputs remain untruncated for downstream use.

---

## Data Model Changes

### Rust `RawWorkflow` / `RawStep` (types.rs)

Add:

```rust
#[derive(Debug, Deserialize, Default)]
pub struct RawDefaults {
    pub model: Option<String>,
    pub approval: Option<String>,
    pub limits: Option<RawLimits>,
}

// RawWorkflow gains:
#[serde(default)]
pub defaults: RawDefaults,
```

Change:

```rust
// outputs: HashMap<String, String>
// becomes
pub type StepOutputs = HashMap<String, String>;   // field name -> value
pub type WorkflowOutputs = HashMap<String, StepOutputs>;  // step id -> StepOutputs
```

`StepStatusEvent.output` keeps its `Option<String>` shape (default-text field for IPC preview); new optional field `outputs: Option<HashMap<String, String>>` for the full map, serialized only for genie steps.

### No persistence-schema changes

- Settings store: no new fields.
- Workspace config: no new fields.
- Snapshots on disk: unchanged.
- Recent/favorite genies: unchanged.

Migration: **none required**. Existing action-only workflows run unchanged (outputs stored under `{step_id: {"text": value}}`; bare `stepId.output` alias keeps reading the `"text"` field).

---

## API / Contract Changes

### New Tauri commands

```rust
#[tauri::command]
pub async fn respond_workflow_approval(
    execution_id: String,
    step_id: String,
    approved: bool,
    state: State<'_, WorkflowRunnerState>,
) -> Result<(), String>;
```

### Modified Tauri events

- `workflow:step-update` — adds optional `outputs: Option<HashMap<String, String>>` (genie steps only). Backward-compatible (consumers that read only `output` still work).
- **New:** `workflow:approval-request` — `{ executionId, stepId, summary, preview, model, approval }`.
- **New:** `workflow:approval-response` — **not emitted**; the command `respond_workflow_approval` replaces it. (Per ADR-4: command-based response keeps state contained.)
- **Optional (Phase 5):** `workflow:genie-chunk` — `{ executionId, stepId, chunk }`. Emitted only when Phase 5 streaming ships.

### Modified Rust public surface

- `ai_provider::run_ai_prompt` — signature unchanged from callers' perspective; internally constructs a `WindowSink` and calls the new `dispatch(sink, ...)` helper.
- **New:** `ai_provider::run_ai_prompt_collect(app, provider, prompt, model, api_key, endpoint, cli_path) -> Result<String, String>`.
- **New:** `ai_provider::sink::AiSink` trait + `WindowSink` + `ChannelSink` impls.

All `#[command]` signatures preserved. Frontend calls to `invoke("run_ai_prompt", ...)` remain unchanged.

---

## Observability

- **Metrics:** per-step duration already emitted via `StepStatusEvent.duration`. Add `model: Option<String>` and `token_estimate: Option<u64>` on the event for genie steps (Phase 3).
- **Logs:**
  - `workflow:` target — `log::info!` for step start/end, `log::error!` for step failures (including unbound placeholders per D7), `log::warn!` once per run when any CLI step has `max_tokens` set (D8).
  - `ai_provider:` target — unchanged, still emits per-chunk at `trace` level.
- **Debug toggles:** existing `workflowLog` / `workflowWarn` (`src/utils/debug.ts`) cover the frontend side.

---

## Work Items

### Phase 0 — Foundation fixes

> Prereqs that must land before genie execution can be wired.

#### WI-0.1 — Nested YAML frontmatter parse for v1 genies

- **Goal:** Parse v1 genie `input: { type: ..., accept: ..., description: ... }` and `output: { type: ..., filename: ..., schema: ... }` as nested YAML rather than the current flat `input_type:` / `output_type:` workaround.
- **Acceptance:**
  - `parse_genie()` returns full `GenieIoSpec` from a v1 frontmatter block using proper YAML.
  - Flat-form frontmatter (`input_type:`) still parses for one release as a deprecation bridge; logs warning.
  - Unit test fixtures for: v0 genie, v1 with nested `input`/`output`, v1 with flat (deprecated) form, v1 with malformed nested YAML.
- **Tests (first):**
  - `src-tauri/src/genies/parsing.rs` — `#[test] fn parse_v1_nested_io()`, `fn parse_v1_flat_io_deprecated()`, `fn parse_v1_malformed_nested()`, `fn parse_v0_still_works()`.
  - Fixture files under `src-tauri/src/genies/test_fixtures/`.
- **Touched:** `src-tauri/src/genies/parsing.rs`, `src-tauri/src/genies/types.rs` (possibly add `schema: Option<serde_yaml::Value>` to `GenieIoSpec`), `Cargo.toml` (add `serde_yaml` if not already — it IS already present per the parent plan ADR-5, confirm).
- **Dependencies:** none.
- **Risks:** serde_yaml's `Value` differs from serde_json's; the `schema` field must round-trip through Tauri IPC. **Mitigation:** serialize to `serde_json::Value` at the Rust→TS boundary.
- **Rollback:** revert commit; flat-form parser still works.
- **Estimate:** S (~120 LOC + fixtures)

#### WI-0.2 — `RawWorkflow.defaults` and workflow-level overrides

- **Goal:** Add `defaults:` parsing to Rust `RawWorkflow`. Surface via `resolve_step_config(step, defaults) -> StepConfig`.
- **Acceptance:**
  - `defaults: { model: ..., approval: ..., limits: { timeout: ..., max_tokens: ... } }` parses.
  - `StepConfig` resolution matches ADR-6 precedence.
  - Unit tests cover each precedence level.
- **Tests (first):**
  - `src-tauri/src/workflow/step_config.rs` (new) — `#[test]` cases per ADR-6 row.
- **Touched:** `src-tauri/src/workflow/types.rs` (+`RawDefaults`), `src-tauri/src/workflow/step_config.rs` (new), `src-tauri/src/workflow/mod.rs`.
- **Dependencies:** none.
- **Estimate:** S (~150 LOC)

---

### Phase 1 — Headless AI primitive (Rust)

> The refactor that unlocks everything. Zero user-visible change on its own.

#### WI-1.1 — `AiSink` trait and `WindowSink` impl

- **Goal:** Introduce `ai_provider::sink::{AiSink, WindowSink}`. `WindowSink` wraps `(WebviewWindow, request_id)` and emits the same three `ai:response` events as today.
- **Acceptance:**
  - `AiSink` is `Send + Sync`. Has `fn chunk(&self, s: &str)`, `fn done(&self)`, `fn error(&self, msg: &str)`.
  - `WindowSink::new(&window, request_id)` matches today's `emit_chunk` / `emit_done` / `emit_error` byte-for-byte on the emitted payload.
- **Tests (first):**
  - `src-tauri/src/ai_provider/sink.rs` — `#[test]` using `MockWindow`-style (or a bare collection sink) that records emissions and asserts shape.
- **Touched:** `src-tauri/src/ai_provider/sink.rs` (new), `src-tauri/src/ai_provider/types.rs` (rewire `emit_*` to call through the sink).
- **Risks:** dynamic dispatch overhead per chunk. **Mitigation:** chunks are user-readable strings arriving at human-speech rates; dispatch cost is in the noise.
- **Rollback:** revert; no public API change.
- **Estimate:** S (~100 LOC)

#### WI-1.2 — `ChannelSink` impl + `run_ai_prompt_collect` helper

- **Goal:** Add `ChannelSink` that forwards chunks to a tokio mpsc channel. Add:

```rust
pub async fn run_ai_prompt_collect(
    app: &AppHandle,
    provider: &str,
    prompt: &str,
    model: Option<&str>,
    api_key: Option<&str>,
    endpoint: Option<&str>,
    cli_path: Option<&str>,
) -> Result<String, String>;
```

- **Acceptance:**
  - Returns the full concatenated response on success.
  - Returns `Err(msg)` if the sink receives an error event.
  - Returns `Err("stream ended without done signal")` if the channel closes before `done`.
  - Handles all 7 provider branches (`claude`, `codex`, `gemini`, `anthropic`, `openai`, `google-ai`, `ollama-api`).
- **Tests (first):**
  - `src-tauri/src/ai_provider/mod.rs` — integration tests with a fake CLI shim (`echo`-based) for one CLI branch, and a local HTTP server (e.g., `wiremock`) for one REST branch.
  - Fast unit tests with a directly-invoked `ChannelSink` to verify the collect loop.
- **Touched:** `src-tauri/src/ai_provider/sink.rs`, `src-tauri/src/ai_provider/mod.rs`, provider fns in `cli.rs` and `rest_providers.rs` (change `&WebviewWindow` → `&dyn AiSink`).
- **Dependencies:** WI-1.1.
- **Risks:** signature change cascades into every provider fn. **Mitigation:** land as one atomic commit; every `emit_*(window, req_id, ...)` becomes `sink.chunk(...)` / `sink.done()` / `sink.error(...)`.
- **Rollback:** revert; `run_ai_prompt` still works because WindowSink matches today's behavior exactly.
- **Estimate:** M (~400 LOC incl. test harness + refactor sweep)

#### WI-1.3 — Cancellation tokens + bounded collection (added post-Codex review)

> Closes Codex C1 (critical) and M3 (medium). Land before WI-2.2.

- **Goal:** Make `run_ai_prompt_collect` properly drop the dispatch future on
  early termination and allow callers to kill in-flight CLI providers from
  another task. Cap the collected text size so a runaway provider can't OOM
  the runner.
- **Acceptance:**
  - CLI providers run on `tokio::process::Command`, not `std::process::Command` —
    so the parent task can call `child.kill().await` without polling.
  - `run_ai_prompt_collect` accepts `cancel: tokio_util::sync::CancellationToken`
    and threads it through `dispatch_to_provider` → `cli::run_cli_blocking` →
    the spawned process. On token cancel: child is killed, sink emits Error,
    function returns `Err("Cancelled")`.
  - `tokio::select!` (not `tokio::join!`) drives dispatch + collect: as soon
    as collect resolves with terminal event (`Done`/`Error`/`recv None`), we
    cancel the dispatch token and return.
  - Hard cap on collected text size: `MAX_COLLECT_BYTES = 5 * 1024 * 1024`.
    On exceed, function returns `Err("Provider output exceeded 5 MB cap")`.
- **Tests (first):**
  - `src-tauri/src/ai_provider/mod.rs` (cfg-test block) —
    `run_collect_returns_text_on_done`, `run_collect_propagates_error`,
    `run_collect_cancellation_returns_cancelled`,
    `run_collect_size_cap_aborts`.
  - `src-tauri/src/ai_provider/cli.rs` test — provider-cancellation kills
    a sleep-shim child within a deadline.
- **Touched:** `ai_provider/cli.rs` (tokio::process refactor),
  `ai_provider/mod.rs` (select + cap), `Cargo.toml` (add `tokio-util` if not
  already), `ai_provider/sink.rs` (no change expected).
- **Estimate:** M (~250 LOC including the tokio::process port)

---

### Phase 2 — Genie step executor

> The point of the plan. Takes the stub to working.

#### WI-2.1 — Rust template renderer

- **Goal:** `template::fill(template: &str, with_map: &HashMap<String, String>) -> Result<String, TemplateError>`, where `TemplateError::Unbound(Vec<String>)` lists every unresolved placeholder.
- **Acceptance:**
  - `{{key}}` replaced by `with_map["key"]`; whitespace tolerated (`{{ key }}`).
  - `{{input}}` is an explicit alias for `with.input`.
  - `{{content}}` aliases `with.content` → `with.input` (first found). Fatal (`TemplateError::Unbound(["content"])`) if neither is present.
  - `{{context}}` aliases `with.context` if present, otherwise the empty string. **Never fatal.**
  - Any other unbound `{{placeholder}}` → `TemplateError::Unbound([names...])`. The caller does not invoke the provider.
  - Nested `{{` inside already-replaced content is NOT re-processed (single pass).
- **Tests (first):**
  - `src-tauri/src/workflow/template.rs` — table-driven tests covering: bare `{{key}}`, whitespace variants, `{{content}}` with input, `{{content}}` with content, `{{content}}` with neither (Err), `{{context}}` empty fallback, `{{input}}` alias, multiple unbound (single Err lists all), no-recursion guard.
- **Touched:** `src-tauri/src/workflow/template.rs` (new), `src-tauri/src/workflow/mod.rs`.
- **Estimate:** S (~140 LOC)

#### WI-2.2 — `execute_genie` in the runner

- **Goal:** Implement `execute_genie(uses, with_map, step_config, app, app_data_dir)` — load genie, fill template, resolve provider, call `run_ai_prompt_collect`, parse output per `output.type`.
- **Acceptance:**
  - Loads genie via existing `list_genies` + `read_genie`. Fails clearly when not found.
  - Validates v1 `input.type` (text/json) before invoking provider.
  - Per-step `model` override applied (ADR-6).
  - `output.type: text` → `{"text": <response>}`.
  - `output.type: json` → parsed, validated against schema, populated into outputs map.
  - `output.type: file|files|pipe` → `Err("Output type '<type>' not supported yet")`.
  - V0 genies (no `version`) behave as if `input.type: text, output.type: text`.
- **Tests (first):**
  - `src-tauri/src/workflow/runner.rs` tests — replace `test_genie_step_returns_error` with:
    - `test_genie_step_text_output` (mocked provider via env override to `echo`-CLI shim)
    - `test_genie_step_json_output_valid`
    - `test_genie_step_json_output_invalid`
    - `test_genie_step_missing_input`
    - `test_genie_step_v0_compat`
    - `test_genie_step_unknown_name`
- **Touched:** `src-tauri/src/workflow/runner.rs`, `src-tauri/src/workflow/genie_step.rs` (new, extracted from runner to keep runner.rs under budget).
- **Dependencies:** WI-0.1, WI-0.2, WI-1.2, WI-2.1.
- **Risks:** the test harness needs a provider stub. **Mitigation:** inject provider path via env var; use a shell script that prints a fixed line.
- **Rollback:** revert; runner returns to stub.
- **Estimate:** M (~350 LOC incl. tests)

#### WI-2.3 — Structured outputs + expression parser

- **Goal:** Replace `outputs: HashMap<String, String>` with `outputs: HashMap<String, HashMap<String, String>>`. Rewrite `resolve_params` to handle `${{ steps.ID.outputs.FIELD }}`, `${{ steps.ID.output }}`, `${{ env.NAME }}`, preserving `${VAR}` and bare `stepId.output` aliases.
- **Acceptance:**
  - All target rules R3/R4 and edge cases E2/E3/E12 covered by tests.
  - Existing action-step tests that use `stepId.output` all pass unchanged.
  - Unknown `steps.X` or `env.Y` produce clean errors, not panics.
- **Tests (first):**
  - `src-tauri/src/workflow/expressions.rs` (new) — table-driven tests: input expression, outputs context, env context → expected resolved value or expected error.
  - Update existing `resolve_params` tests (~10) to use the new outputs shape.
- **Touched:** `src-tauri/src/workflow/runner.rs` (call sites), `src-tauri/src/workflow/expressions.rs` (new), `src-tauri/src/workflow/types.rs` (`WorkflowOutputs` type alias).
- **Dependencies:** none on Phase 1/2.
- **Risks:** regex syntax for `${{ ... }}` must not conflict with `${VAR}`. **Mitigation:** parse `${{ ... }}` first, then run `${VAR}` on the remainder.
- **Rollback:** revert; no user-visible impact since old alias form still works.
- **Estimate:** M (~300 LOC)

#### WI-2.4 — Remove genie/webhook pre-validation reject

- **Goal:** `commands.rs:89` unconditionally rejects `genie/` steps. After WI-2.2 lands, the guard must be narrowed to reject only `webhook/`.
- **Acceptance:**
  - A workflow with a `genie/summarize` step is NOT rejected at the command layer. It reaches the runner.
  - A workflow with a `webhook/anything` step is still rejected until webhook support lands.
  - Unit test: `run_workflow` with a single `genie/` step returns an `execution_id`.
- **Tests (first):**
  - `src-tauri/src/workflow/commands.rs` — `#[tokio::test] fn run_workflow_accepts_genie_step()`, `fn run_workflow_still_rejects_webhook()`.
- **Touched:** `src-tauri/src/workflow/commands.rs` (delete the `genie/` branch).
- **Dependencies:** WI-2.2 must be complete so execution can actually succeed.
- **Rollback:** re-add the branch; frontend gating plus the rejection both protect users.
- **Estimate:** S (~20 LOC)

#### WI-2.5 — Per-step timeout enforcement

- **Goal:** Wrap every step execution in `tokio::time::timeout(step_config.timeout, ...)`. On elapsed: for CLI providers, force-kill the child; for REST, drop the future; emit step error.
- **Acceptance:**
  - Step with `limits.timeout: 1s` running a provider that takes 5s fails with `"Timed out after 1s"`.
  - Workflow defaults apply when step doesn't override.
  - CLI child process is confirmed dead after timeout (no zombie) — use `child.kill()` via a channel into the provider.
- **Tests (first):**
  - `src-tauri/src/workflow/runner.rs` — `fn test_step_timeout_kills_provider()` with a sleep-based shim.
- **Touched:** `src-tauri/src/workflow/runner.rs`, `src-tauri/src/ai_provider/cli.rs` (expose a cancel handle, or accept a `CancellationToken`).
- **Risks:** propagating cancellation into `run_cli_blocking` needs a kill channel. **Mitigation:** use `tokio::select!` between the join handle and a cancel receiver; send a kill signal to the child on cancel.
- **Estimate:** M (~180 LOC)

---

### Phase 3 — Approval gate

#### WI-3.1 — Rust approval channel

- **Goal:** `WorkflowRunnerState` gains `approval_senders: Mutex<HashMap<(String, String), oneshot::Sender<bool>>>` keyed by `(execution_id, step_id)`. Runner emits `workflow:approval-request`, awaits receiver.
- **Acceptance:**
  - When `effective_approval == "ask"`, runner emits request event and blocks.
  - `respond_workflow_approval(execution_id, step_id, approved)` sends on the oneshot; runner resumes.
  - Channel closed without response → step fails "Approval channel closed".
  - Timeout (step timeout or 10-min default, whichever smaller) → step fails "Approval timed out".
- **Tests (first):**
  - `src-tauri/src/workflow/approval.rs` (new) — unit tests via direct channel poking.
  - Runner-level test: `fn test_step_awaits_approval_then_resumes()`.
- **Touched:** `src-tauri/src/workflow/approval.rs` (new), `src-tauri/src/workflow/commands.rs` (new command), `src-tauri/src/workflow/runner.rs` (integration).
- **Estimate:** M (~220 LOC)

#### WI-3.2 — Frontend approval dialog

- **Goal:** Dialog shown on `workflow:approval-request`. Preview (first 500 chars of filled prompt + model + limits). Buttons: Approve / Deny / Cancel workflow.
- **Acceptance:**
  - Design token compliance (no hardcoded colors, focus indicators per `.claude/rules/33-focus-indicators.md`).
  - i18n: all strings via `t()` in `dialog.json` / new `workflow.json` namespace — all 10 locales.
  - Esc = Deny (consistent with other VMark dialogs — confirm during impl).
  - Enter = Approve on focused button only (no auto-approve).
- **Tests (first):**
  - `src/components/WorkflowApproval/ApprovalDialog.test.tsx` — behavior tests (click approve → `respond_workflow_approval` invoked; Esc → deny).
  - `src/stores/workflowApprovalStore.test.ts` — store state transitions.
- **Touched:** `src/stores/workflowApprovalStore.ts` (new), `src/components/WorkflowApproval/ApprovalDialog.tsx` (new), `src/components/WorkflowApproval/approval-dialog.css` (new), `src/locales/*/workflow.json` (new key block), i18n check script.
- **Estimate:** M (~250 LOC + 10 locale strings)

---

### Phase 4 — Run UX

#### WI-4.1 — `useWorkflowExecution` hook

- **Goal:** Hook that owns the execution lifecycle — calls `invoke("run_workflow", {yaml, env, workspaceRoot})`, listens for `workflow:step-update` and `workflow:complete`, updates `workflowPreviewStore.activeStepId` and a new `stepStatuses: Record<string, StepStatus>` map.
- **Acceptance:**
  - Single active execution per window.
  - Unlistens on unmount.
  - Cancel button calls `cancel_workflow(execution_id)`.
  - Store updates are throttled to 60fps worst case (RAF-coalesced).
- **Tests (first):**
  - `src/hooks/useWorkflowExecution.test.ts` — mock `invoke` / `listen`, assert store mutations on fake events.
- **Touched:** `src/hooks/useWorkflowExecution.ts` (new), `src/stores/workflowPreviewStore.ts` (add `stepStatuses`, `executionId`).
- **Estimate:** M (~200 LOC)

#### WI-4.2 — Run / Cancel buttons in `WorkflowSidePanel`

- **Goal:** Add Play / Stop buttons to the side panel header. Disabled when: no workflow parsed, feature flag off, or workspace not open (D10).
- **Acceptance:**
  - Tooltip + aria-label via i18n.
  - Icon: `Play` / `Square` (lucide).
  - Focus indicator per rule 33 (U-shaped underline on buttons).
  - Disabled state uses token opacity.
- **Tests (first):**
  - `src/plugins/workflowPreview/WorkflowSidePanel.test.tsx` (new) — click Run → `useWorkflowExecution.start` called; Stop → `cancel_workflow`.
- **Touched:** `src/plugins/workflowPreview/WorkflowSidePanel.tsx`, `src/plugins/workflowPreview/workflow-side-panel.css`, `src/locales/*/workflow.json`.
- **Estimate:** S (~150 LOC)

#### WI-4.3 — Live status on React Flow nodes

- **Goal:** Extend `WorkflowNode.tsx` to render status dot, duration badge, and error tooltip from `stepStatuses`. Running steps pulse. Errored steps show tooltip on hover.
- **Acceptance:**
  - Dark theme parity (tokens).
  - Animation uses reduced-motion media query.
  - No layout shift when status changes (absolute-positioned badge).
- **Tests (first):**
  - `src/plugins/workflowPreview/__tests__/WorkflowNode.test.tsx` — render with each status, assert class and ARIA.
- **Touched:** `src/plugins/workflowPreview/WorkflowNode.tsx`, `src/plugins/workflowPreview/workflow-node.css`.
- **Estimate:** S (~180 LOC)

---

### Phase 5 — Streaming preview (optional polish)

#### WI-5.1 — Optional chunk streaming into step nodes

- **Goal:** Add `workflow:genie-chunk` event from the runner. Runner wraps `ChannelSink` with a tee that also emits partial chunks as events. Frontend shows last ~120 chars in the node body during `running` state.
- **Gate:** Behind `settingsStore.advanced.workflowStreamPreview` (default off; added here).
- **Acceptance:**
  - Default off → no event emission overhead.
  - With flag on, events fire ≤ 30 Hz (coalesce in Rust).
- **Tests (first):**
  - `src-tauri/src/workflow/runner.rs` — `fn test_genie_chunks_emitted_when_enabled()`.
  - `src/plugins/workflowPreview/__tests__/WorkflowNode.test.tsx` — streaming preview renders.
- **Touched:** `src-tauri/src/workflow/runner.rs`, `src-tauri/src/ai_provider/sink.rs` (TeeSink helper), `src/stores/settingsStore.ts`, `src/plugins/workflowPreview/WorkflowNode.tsx`.
- **Estimate:** M (~250 LOC)

---

### Phase 6 — Authoring & docs

#### WI-6.1 — Sample workflow using bundled v0 genies

- **Goal:** Ship `src-tauri/resources/workflows/examples/triage-and-translate.yml` that chains two bundled **v0** genie steps (e.g., `genie/rewrite-in-english` → `genie/translate`) via `needs:` and feeds output to one `action/save-file`. No bundled genies are modified (D11).
- **Acceptance:**
  - Workflow parses without errors (TS parser + Rust parser).
  - Rust integration test runs the workflow against an `echo`-shim provider and asserts expected output of each step.
  - Side panel opens on the sample workflow and shows a 3-node graph.
  - Demonstrates ADR-2 aliasing in practice: step supplies `with: { input: "..." }`, template uses `{{content}}`, aliasing resolves it.
- **Tests (first):**
  - `src-tauri/src/workflow/examples.rs` (new, test-only) — `#[test] fn example_triage_and_translate_shape()` verifies parse + topo order; `#[test] fn example_triage_and_translate_runs_with_shim()` runs end-to-end.
- **Touched:** `src-tauri/resources/workflows/examples/triage-and-translate.yml` (new), `tauri.conf.json` (bundle entry for `resources/workflows/`). **No changes to bundled genie files.**
- **Dependencies:** WI-2.2, WI-2.4.
- **Estimate:** S (~40 LOC — YAML + integration test only)

#### WI-6.2 — Documentation

- **Goal:** New page `website/guide/workflows.md` covering: feature flag, YAML schema, genie-in-workflow binding rules, expressions, approval, limits, sample workflow walkthrough. Update `website/guide/ai-genies.md` with a "Genies in Workflows" section.
- **Acceptance:**
  - Page builds (`cd website && pnpm build`).
  - Cross-links to `ai-genies.md` and the original workflow-engine plan.
  - Mermaid diagram (validated via `mcp__mermaider__validate_syntax`) showing the execution pipeline.
- **Tests (first):** `pnpm lint:i18n` stays green (no new locale keys needed for website docs until this sees user feedback — English-first).
- **Touched:** `website/guide/workflows.md` (new), `website/guide/ai-genies.md`, `website/.vitepress/config.ts` (sidebar entry).
- **Dependencies:** WI-2.2, WI-3.2, WI-4.2.
- **Estimate:** S (~300 LOC prose + 1 Mermaid)

---

## Testing Procedures

### Fast checks (run per WI)

```bash
# Unit tests, touched file(s) only
pnpm test -- --run <path-to-test>
cargo test --manifest-path src-tauri/Cargo.toml <test_name>

# Typecheck
npx tsc --noEmit -p tsconfig.json

# Lint
pnpm -s lint
```

### Full gate (run at end of each phase)

```bash
pnpm check:all   # lint + lint:console + lint:selection-styles + lint:design-tokens
                 # + lint:emdash + lint:deps + lint:i18n + test:coverage + build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

### When to run each

- Fast checks: after every WI touch, before moving to next.
- Full gate: before merging each Phase.
- Manual checklist (below): before merging Phase 4 (first user-reachable behavior).

---

## Rollout Plan

- **Feature flag:** `settingsStore.advanced.workflowEngine` — already exists, default off.
- **Staging:**
  1. Phases 0–2 land without user-visible change (runner accepts genie steps, but no frontend can submit them).
  2. Phase 3 (approval) lands without user-visible change (no Run button).
  3. Phase 4 (Run UX) makes the feature reachable. Flag still off by default.
  4. Phase 6 docs published. Feature remains flag-gated.
- **Enable by default: NOT in this plan.** Remove the flag only after:
  - Dogfooding period (≥ 2 weeks).
  - ≥ 5 reported non-trivial workflows authored.
  - Zero open P0 bugs on the workflow engine.
- **Kill switch:**
  1. If a critical bug appears post-Phase-4, toggle the setting off in a patch release (user config flip).
  2. If more severe, revert Phase 4 commits to re-hide the Run button without touching the runner.
  3. The `commands.rs` pre-rejection of `genie/` (WI-2.4 removed it) can be re-added in a hotfix.

---

## Risk Register

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | Sink refactor introduces a streaming regression in editor genie UX | M | H | WI-1.1 lands with a byte-for-byte emission contract test before WI-1.2 touches providers. Run the full editor-genie manual test before merging Phase 1. |
| R-2 | Approval deadlock: dialog closed without response, workflow hangs | M | M | Oneshot cleanup on window close; absolute 10-min fallback timeout; cancel-workflow always works. |
| R-3 | Template placeholder conflict: user genie uses `{{content}}` but workflow `with:` supplies `input` only | H | L | ADR-2 aliasing resolves `{{content}}` → `with.input`; WI-2.1 covers both orderings with unit tests. Per D7, any genuinely unbound placeholder fails the step fatally before the provider is called — surfaces the author error immediately rather than shipping garbage. |
| R-4 | CLI provider child not killed on timeout → zombie process | L | M | WI-2.5 specifies `child.kill()` via cancel channel; integration test asserts process exits. |
| R-5 | JSON output schema validation false positives | M | L | Validation is minimum-viable: "required keys present, types match primitives". No regex, no length constraints. Document limits in the guide. |
| R-6 | `serde_yaml` version conflict with TS-side `js-yaml` (e.g., different tag semantics) | L | L | Only used on Rust side for nested frontmatter; TS parser unchanged. |
| R-7 | REST provider max_tokens silently ignored by some OpenAI-compatible endpoints | M | L | Document per-provider behavior in the guide. Add `model_capabilities` table in a follow-up. Note CLI providers never enforce (D8) — one warning log per run surfaces the fact without flooding. |
| R-8 | Flaky tests in Phase 1 due to real CLI spawn | H | M | All provider-path tests use a `VMARK_AI_PROVIDER_OVERRIDE` env var with an `echo`-shim script under `src-tauri/test-fixtures/`. No real network calls in unit tests. |
| R-9 | Matrix expansion requested mid-implementation | M | L | Out of scope (documented). Accept matrix-free workflows only; error on `matrix:` key at the Rust parse step. |
| R-10 | User enables the flag, runs a workflow on a machine with no provider installed | H | L | Provider detection already warns on startup; step-level error surfaces cleanly via R7. |

---

## Dependency Graph

```
Phase 0 (Foundations)
  WI-0.1 nested YAML frontmatter
  WI-0.2 RawDefaults + step_config

Phase 1 (AI primitive) ← depends on none
  WI-1.1 AiSink / WindowSink
  WI-1.2 ChannelSink + run_ai_prompt_collect ← WI-1.1

Phase 2 (Genie executor) ← Phase 0 + Phase 1
  WI-2.1 template render
  WI-2.2 execute_genie ← WI-0.1, WI-0.2, WI-1.2, WI-2.1
  WI-2.3 expressions + structured outputs
  WI-2.4 remove pre-reject ← WI-2.2
  WI-2.5 per-step timeout ← WI-2.2

Phase 3 (Approval) ← Phase 2
  WI-3.1 Rust channel
  WI-3.2 dialog ← WI-3.1

Phase 4 (Run UX) ← Phase 3
  WI-4.1 useWorkflowExecution
  WI-4.2 Run/Cancel ← WI-4.1
  WI-4.3 node status ← WI-4.1

Phase 5 (Streaming preview, optional) ← Phase 4
  WI-5.1

Phase 6 (Authoring & docs) ← Phase 2 + Phase 3
  WI-6.1 sample workflow (v0 genies, no conversions)
  WI-6.2 website guide
```

---

## LOC Summary

| Phase | WI | Est. LOC |
|---|---|---|
| 0 | WI-0.1 nested frontmatter | 120 |
| 0 | WI-0.2 RawDefaults + step_config | 150 |
| 1 | WI-1.1 AiSink/WindowSink | 100 |
| 1 | WI-1.2 ChannelSink + collect | 400 |
| 2 | WI-2.1 template render | 140 |
| 2 | WI-2.2 execute_genie | 350 |
| 2 | WI-2.3 expressions + outputs | 300 |
| 2 | WI-2.4 remove pre-reject | 20 |
| 2 | WI-2.5 per-step timeout | 180 |
| 3 | WI-3.1 Rust approval channel | 220 |
| 3 | WI-3.2 approval dialog | 250 |
| 4 | WI-4.1 useWorkflowExecution | 200 |
| 4 | WI-4.2 Run/Cancel buttons | 150 |
| 4 | WI-4.3 node status | 180 |
| 5 | WI-5.1 streaming preview (optional) | 250 |
| 6 | WI-6.1 sample workflow (v0 genies) | 40 |
| 6 | WI-6.2 docs | 300 |
| | **Total (excl. Phase 5)** | **~2,800** minus 250 = **~2,550** |
| | **Minimum viable (Phases 0–4)** | **~2,260** |

Deltas from original draft: WI-2.1 +20 (Result-based API vs tuple return); WI-6.1 –40 (no genie conversions per D11); wire-level `max_cost` enforcement removed (would have been ~30 LOC of plumbing per D9).

---

## Verification Gates

Each gate must pass before moving on.

- **Gate G-0 (end of Phase 0):**
  - All WI-0.x unit tests green.
  - Parsing v0 and v1 (nested) genie fixtures round-trip.
  - `pnpm check:all` green.

- **Gate G-1 (end of Phase 1):**
  - `run_ai_prompt` editor path unchanged (manual test: invoke a genie from editor, stream renders, suggestion applies).
  - `run_ai_prompt_collect` returns expected string from an `echo`-shim CLI provider.
  - No regression in `src/hooks/useGenieInvocation.test.ts`.

- **Gate G-2 (end of Phase 2):**
  - `run_workflow_sequential` accepts a single genie step and returns its output in `outputs[step_id]["text"]`.
  - Expression `${{ steps.prior.outputs.text }}` resolves in a 2-step workflow.
  - Timeout fires and kills child within 500ms of the step's `limits.timeout`.
  - Pre-validation reject updated.

- **Gate G-3 (end of Phase 3):**
  - Approval request + response round-trips via `respond_workflow_approval`.
  - Denial fails the step with the expected error message.
  - Channel-closed path times out as specified.

- **Gate G-4 (end of Phase 4):**
  - Manual run of sample workflow from the side panel works end-to-end.
  - Cancel mid-stream marks remaining steps skipped and kills the provider.
  - Node status updates visible in both light and dark themes.

- **Gate G-5 (end of Phase 6):**
  - Sample workflow in `resources/workflows/examples/` runs green via Rust integration test with the `echo`-shim provider.
  - No bundled genies modified (confirmed via `git diff --stat src-tauri/resources/genies/` → empty).
  - Website guide builds, Mermaid validates. Guide does not mention `limits.max_cost` (D9).
  - All new i18n keys present in all 10 locales.

---

## Plan → Verify Handoff

**Evidence to collect per WI:**

- WI-0.1: cargo test output showing 4 parser fixture tests green.
- WI-0.2: cargo test output for step_config precedence table.
- WI-1.1: diff of `ai_provider/types.rs` `emit_*` now dispatches through sink; manual editor genie invocation screenshot/log.
- WI-1.2: test log showing a collected response from the echo-shim CLI.
- WI-2.1: unit test output with the placeholder table.
- WI-2.2: runner integration test output for each `output.type` branch.
- WI-2.3: resolved-expression test table with error cases.
- WI-2.4: `cargo test run_workflow_accepts_genie_step` green.
- WI-2.5: ps snapshot before/after timeout test proving child killed.
- WI-3.1: channel round-trip test log.
- WI-3.2: dialog screenshot (light + dark).
- WI-4.1: hook test log; store state snapshot.
- WI-4.2: side panel screenshot with Run button.
- WI-4.3: React Flow node screenshots per status (pending/running/success/error).
- WI-6.1: sample workflow YAML file + integration test log.
- WI-6.2: website build log + rendered page screenshot.

**Required fixtures / sample data:**

- `src-tauri/test-fixtures/echo-provider.sh` (unix) and `.cmd` (windows) — prints a fixed response body on stdin passthrough. Checked in.
- `src-tauri/src/genies/test_fixtures/v1_nested.md`, `v1_flat_deprecated.md`, `v0_classic.md`, `v1_malformed.md`.
- `src-tauri/resources/workflows/examples/triage-and-translate.yml`.
- `src-tauri/resources/workflows/examples/single-genie.yml` (smallest valid sample for the guide's first example).

---

## Manual Test Checklist

Run after Gate G-4 (first user-reachable behavior).

- [ ] Settings → Advanced → Developer → Workflow Engine toggle ON (hot reload OK?).
- [ ] Open a workspace; create a `.yml` file with a minimal genie workflow.
- [ ] Side panel opens; Run button appears enabled.
- [ ] Click Run → execution begins; first step highlights yellow; completes green with text output visible in node tooltip.
- [ ] Run a multi-step workflow with `needs:` chaining; second step uses `${{ steps.first.outputs.text }}`; verify downstream receives the text.
- [ ] Run a workflow with `approval: ask` on one step → dialog appears → Approve resumes; Deny fails that step and skips dependents.
- [ ] Run a workflow where the genie times out (e.g., `limits.timeout: 1s` with a slow CLI provider) → step fails with "Timed out", subsequent steps skipped.
- [ ] Cancel mid-stream with the Stop button → ps confirms no orphan CLI process.
- [ ] Dark theme: all new UI (Run button, Cancel button, node statuses, approval dialog) meet contrast.
- [ ] i18n: switch to zh-CN → all workflow strings translated (no missing keys).
- [ ] Editor genie invocation (unrelated path) still works — stream renders, suggestion applies, cancel works.
- [ ] Toggle Workflow Engine OFF → Run button disappears from side panel; `.yml` files revert to plain text file treatment.
- [ ] Try to run two workflows simultaneously → second fails with the existing concurrency message.
- [ ] Provider unavailable at step time (e.g., uninstall claude CLI) → step fails with clean error; workflow reports failed step id.

---

## Out of Scope

Items deliberately deferred:

- `action/save-file` approval with diff preview (requires diff renderer; belongs with WI-5.5 of the parent plan).
- `output.type: file` / `files` / `pipe` (file I/O with snapshot integration).
- Matrix step expansion.
- Webhook step execution (`webhook/`).
- Workflow triggers (`on:`) — manual trigger only via the Run button.
- Cost accounting (`limits.max_cost`).
- YAML-fence-in-markdown workflow rendering (addressed in a separate short exploration).
- Genie auto-complete in the source editor.
- CLI-provider `max_tokens` enforcement.
- MCP-triggered workflow runs (the command exists, but no MCP bridge entry).

Each appears in the parent plan (`20260331-workflow-engine.md`) or its follow-ups.

---

## Revision History

- **2026-04-18** — initial draft.
- **2026-04-18** — resolved all 5 Open Questions after review (D7–D11 added to Decision Log). Key shifts: unbound `{{placeholder}}` is now fatal with two named v0 aliases (D7); `limits.max_cost` dropped entirely (D9); zero bundled genies converted to v1, sample workflow uses v0 genies unchanged (D11). LOC deltas: WI-2.1 +20, WI-6.1 –40, no max_cost plumbing –~30. Open Questions section removed. Target rule R3, edge case E4, observability logs, risk register R-3/R-7, WI-2.1 contract, WI-6.1 scope, Verification Gate G-5, and LOC Summary updated to match.
