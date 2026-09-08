/**
 * Workflow feature flags.
 *
 * Purpose: the non-reactive reader for the ONE workflow flag that remains. The
 * yaml-surface fallback the file explorer used to consult went with the viewer
 * flag (D6): `isVMarkFileName` covers the pre-bootstrap edge unconditionally.
 *
 * Until WI-19 a single `advanced.workflowEngine` gated two unrelated features:
 * the GitHub Actions authoring aids and the bespoke execution engine. WI-19
 * split them; D6 (WI-FL2.6) then removed the viewer flag outright, because the
 * workbench was always unconditional, the split-pane source aids never
 * consulted it, and rule 60 §12 wanted it on by 2026-09-15.
 *
 *   - **Viewer** — no flag. The GHA workbench (the yaml adapter's
 *     `gha-workflow` schema renderer) and its source-pane aids — `${{ }}`
 *     expression completion, cursor↔canvas job sync, `uses:` goto-def — ship
 *     on. They read; they never run anything.
 *   - **Engine** (`advanced.workflowEngine`): the bespoke YAML execution
 *     engine — the side panel's Run/Cancel controls, the live preview graph
 *     that feeds them, and the `run_workflow` Rust runner. The backend refuses
 *     its commands when this is off (`workflow::guards`), so hiding the button
 *     is no longer the whole enforcement.
 *
 * Non-reactive reads (imperative code, extension assembly) use the functions
 * here. React components read the store selector directly
 * (`useSettingsStore(s => s.advanced.workflowEngine)`).
 *
 * @coordinates-with src/services/workflow/workflowEnginePolicySync.ts — pushes
 *   the engine flag to Rust, which starts fail-closed
 * @coordinates-with src/stores/settingsStore/migrations.ts — drops a persisted
 *   viewer flag (`migrateRemoveWorkflowViewer`)
 * @module services/featureFlags/workflowFeatureFlag
 */

import { useSettingsStore } from "@/stores/settingsStore";

/** The bespoke YAML workflow execution engine (Run/Cancel + the Rust runner). */
export function isWorkflowEngineEnabled(): boolean {
  return useSettingsStore.getState().advanced.workflowEngine ?? false;
}
