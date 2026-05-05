/**
 * GHA Workflow Panel Store
 *
 * Purpose: Manages the side-panel state for standalone GitHub Actions
 *   workflow `.yml` files (Phase 2 of dev-docs/plans/20260504-github-actions-
 *   workflow-viewer.md). Mirrors workflowPreviewStore.ts (which serves the
 *   existing Genie workflow feature) — both stores coexist; the
 *   sourceWorkflowPreview / sourceGhaWorkflowPreview CodeMirror plugins
 *   populate the appropriate one based on content shape.
 *
 * Key decisions:
 *   - Workflow IR comes from src/lib/ghaWorkflow/parser/index.ts (different
 *     shape from Genie's WorkflowGraph; the two are not interchangeable).
 *   - Panel opens automatically when a parse succeeds and stays open across
 *     non-fatal edits — same UX as the Genie panel.
 *   - reset() clears everything; called when leaving a workflow file.
 *
 * @coordinates-with src/plugins/codemirror/sourceGhaWorkflowPreview.ts —
 *   writes workflow/parseError on every doc change.
 * @coordinates-with src/plugins/ghaWorkflowPreview/GhaWorkflowSidePanel.tsx —
 *   reads workflow + panelOpen to render the canvas.
 * @module stores/ghaWorkflowPanelStore
 */

import { create } from "zustand";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";

interface GhaWorkflowPanelState {
  panelOpen: boolean;
  workflow: WorkflowIR | null;
  parseError: string | null;
}

interface GhaWorkflowPanelActions {
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setWorkflow: (workflow: WorkflowIR | null, error?: string) => void;
  reset: () => void;
}

const initialState: GhaWorkflowPanelState = {
  panelOpen: false,
  workflow: null,
  parseError: null,
};

export const useGhaWorkflowPanelStore = create<
  GhaWorkflowPanelState & GhaWorkflowPanelActions
>((set) => ({
  ...initialState,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  setWorkflow: (workflow, error) =>
    set({
      workflow,
      parseError: error ?? null,
    }),

  reset: () => set(initialState),
}));
