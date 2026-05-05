/**
 * Workflow Preview Store
 *
 * Purpose: Manages the state of the workflow side panel for standalone .yml files.
 * Tracks panel visibility, parsed graph, parse errors, active step highlighting,
 * and (WI-4.1) live execution state — running execution id and per-step status.
 *
 * @coordinates-with WorkflowSidePanel.tsx — UI reads this store
 * @coordinates-with Editor.tsx — panel rendered alongside editor content
 * @coordinates-with useWorkflowExecution.ts — owns the lifecycle that updates
 *                                              executionId and stepStatuses
 * @module stores/workflowPreviewStore
 */

import { create } from "zustand";
import type { WorkflowGraph } from "@/lib/workflow/types";

export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "skipped";

export interface StepStatusEntry {
  status: StepStatus;
  output?: string;
  error?: string;
  duration?: number;
}

interface WorkflowPreviewState {
  panelOpen: boolean;
  graph: WorkflowGraph | null;
  parseError: string | null;
  activeStepId: string | null;
  executionId: string | null;
  stepStatuses: Record<string, StepStatusEntry>;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setGraph: (graph: WorkflowGraph | null, error?: string) => void;
  setActiveStepId: (stepId: string | null) => void;
  setExecution: (id: string | null) => void;
  setStepStatus: (stepId: string, entry: StepStatusEntry) => void;
  resetStatuses: () => void;
  reset: () => void;
}

const initialState = {
  panelOpen: false,
  graph: null as WorkflowGraph | null,
  parseError: null as string | null,
  activeStepId: null as string | null,
  executionId: null as string | null,
  stepStatuses: {} as Record<string, StepStatusEntry>,
};

export const useWorkflowPreviewStore = create<WorkflowPreviewState>((set) => ({
  ...initialState,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  setGraph: (graph, error) =>
    set({
      graph,
      parseError: error ?? null,
      // Clear active step + status when graph changed (e.g. after edits).
      activeStepId: null,
      stepStatuses: {},
    }),

  setActiveStepId: (stepId) => set({ activeStepId: stepId }),

  setExecution: (id) =>
    set({ executionId: id, stepStatuses: id ? {} : {} }),

  setStepStatus: (stepId, entry) =>
    set((s) => ({
      stepStatuses: { ...s.stepStatuses, [stepId]: entry },
    })),

  resetStatuses: () => set({ stepStatuses: {} }),

  reset: () => set(initialState),
}));
