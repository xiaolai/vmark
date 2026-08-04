/**
 * Workflow feature flags (WI-19 split).
 *
 * Purpose: tell the two workflow features apart. Until WI-19 a single
 * `advanced.workflowEngine` gated both, so a user who wanted GitHub Actions
 * authoring aids had to switch on a runner that spawns AI providers and writes
 * files — and the Rust side honoured neither, because the flag lived only in
 * the webview.
 *
 *   - **Viewer** (`advanced.workflowViewer`): GitHub Actions authoring extras
 *     in the source pane — `${{ }}` expression completion, cursor↔canvas job
 *     sync, `uses:` goto-def. Read-only aids over the `gha` IR; they execute
 *     nothing. NOT the GHA workbench itself, which ships always-on through the
 *     yaml adapter's `gha-workflow` schema renderer and is not flag-gated.
 *   - **Engine** (`advanced.workflowEngine`): the bespoke YAML execution
 *     engine — the side panel's Run/Cancel controls, the live preview graph
 *     that feeds them, and the `run_workflow` Rust runner. The backend refuses
 *     its commands when this is off (`workflow::guards`), so hiding the button
 *     is no longer the whole enforcement.
 *
 * Non-reactive reads (imperative code, extension assembly) use the functions
 * here. React components read the store selector directly
 * (`useSettingsStore(s => s.advanced.workflowViewer)`).
 *
 * @coordinates-with src/services/workflow/workflowEnginePolicySync.ts — pushes
 *   the engine flag to Rust, which starts fail-closed
 * @coordinates-with src/stores/settingsStore/migrations.ts — the split migration
 * @module services/featureFlags/workflowFeatureFlag
 */

import { useSettingsStore } from "@/stores/settingsStore";

/** GitHub Actions viewer extras (completion, cursor sync, goto-def). */
export function isWorkflowViewerEnabled(): boolean {
  return useSettingsStore.getState().advanced.workflowViewer ?? false;
}

/** The bespoke YAML workflow execution engine (Run/Cancel + the Rust runner). */
export function isWorkflowEngineEnabled(): boolean {
  return useSettingsStore.getState().advanced.workflowEngine ?? false;
}

/**
 * True when a standalone `.yml` should be treated as a VMark file rather than
 * handed to the OS. Either feature makes that so, which is why this is an OR
 * and not one of the two flags: gating it on the engine alone would hide
 * workflow files from a user who enabled only the viewer.
 *
 * Only reached before the format registry is bootstrapped — once it is,
 * `isSupportedFileName` already covers yaml.
 */
export function isWorkflowYamlSurfaceEnabled(): boolean {
  return isWorkflowViewerEnabled() || isWorkflowEngineEnabled();
}
