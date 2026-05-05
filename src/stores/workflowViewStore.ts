/**
 * Workflow View Store
 *
 * Purpose: Zustand state for the GitHub Actions workflow viewer
 *   (src/components/Editor/WorkflowPanel/). Tracks selected job/step
 *   for click-to-jump, expanded-matrix set, and layout direction.
 *   Pure UI state — no document content, no derived data from the IR.
 *
 * Key decisions:
 *   - selectedJobId/selectedStepId are stored as ids only, not full
 *     IR references — the viewer re-resolves from the latest parsed
 *     IR each render so stale selections don't crash on save+reparse.
 *   - expandedMatrices is a Set keyed by job id; default is collapsed
 *     (per plan §4.3, large matrices don't render every combination
 *     up front).
 *
 * @coordinates-with src/lib/ghaWorkflow/render/ — consumes selection
 *   to highlight nodes and reveal step lists.
 * @coordinates-with workflowEditStore.ts — separate store for edit
 *   state; not introduced until Phase 7.
 * @module stores/workflowViewStore
 */

import { create } from "zustand";
import type { LayoutDirection } from "@/lib/ghaWorkflow/render/layout";

interface WorkflowViewState {
  selectedJobId: string | null;
  selectedStepId: string | null;
  expandedMatrices: Set<string>;
  layoutDirection: LayoutDirection;
}

interface WorkflowViewActions {
  /** Select a job (clears step selection). */
  selectJob: (jobId: string) => void;
  /** Select a step within a job. */
  selectStep: (jobId: string, stepId: string) => void;
  /** Clear all selection. */
  clearSelection: () => void;
  /** Toggle a job's expanded-matrix state. */
  toggleMatrix: (jobId: string) => void;
  /** Set canvas layout direction. */
  setLayoutDirection: (dir: LayoutDirection) => void;
  /** Reset to initial state — used in tests and on document close. */
  reset: () => void;
}

const initialState: WorkflowViewState = {
  selectedJobId: null,
  selectedStepId: null,
  expandedMatrices: new Set<string>(),
  layoutDirection: "TD",
};

export const useWorkflowViewStore = create<
  WorkflowViewState & WorkflowViewActions
>((set) => ({
  ...initialState,

  selectJob: (jobId) =>
    set({ selectedJobId: jobId, selectedStepId: null }),

  selectStep: (jobId, stepId) =>
    set({ selectedJobId: jobId, selectedStepId: stepId }),

  clearSelection: () =>
    set({ selectedJobId: null, selectedStepId: null }),

  toggleMatrix: (jobId) =>
    set((state) => {
      const next = new Set(state.expandedMatrices);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return { expandedMatrices: next };
    }),

  setLayoutDirection: (dir) => set({ layoutDirection: dir }),

  reset: () => set({ ...initialState, expandedMatrices: new Set() }),
}));
