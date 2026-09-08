/**
 * The preview slice's transitions — pure functions over `PreviewSlice`.
 *
 * Purpose: `workflowStore.ts` is the store's WIRING; what a run's panel state
 * looks like after an event is a separate concern with no Zustand in it, and it
 * had grown to the point of pushing that file past its size cap (audit #1001).
 * Same split `workflowEditQueue.ts` already makes for the patch queue.
 *
 * Everything here returns the SAME slice reference when nothing changes, which
 * is how the store expresses a no-op `set` without each caller restating it.
 *
 * @coordinates-with src/stores/workflowStore.ts — the only consumer
 * @module stores/workflowPreviewSlice
 */
import type { StepStatusEntry, WorkflowGraph } from "@/lib/workflow/types";

/** How a run ended, once `executionId` is back to null (audit #767). */
export type WorkflowRunOutcome = "completed" | "failed" | "cancelled";

export interface PreviewSlice {
  panelOpen: boolean;
  graph: WorkflowGraph | null;
  parseError: string | null;
  activeStepId: string | null;
  executionId: string | null;
  stepStatuses: Record<string, StepStatusEntry>;
  /** How the run that just ended ended; null since the last `setExecution`. */
  lastRunOutcome: WorkflowRunOutcome | null;
}

export const initialPreview: PreviewSlice = {
  panelOpen: false,
  graph: null,
  parseError: null,
  activeStepId: null,
  executionId: null,
  stepStatuses: {},
  lastRunOutcome: null,
};

export function setPanelOpen(slice: PreviewSlice, panelOpen: boolean): PreviewSlice {
  return { ...slice, panelOpen };
}

export function togglePanel(slice: PreviewSlice): PreviewSlice {
  return { ...slice, panelOpen: !slice.panelOpen };
}

/**
 * Replace the graph, clearing the SELECTION and the step statuses that belonged
 * to the old one.
 *
 * `executionId` deliberately SURVIVES (audit #1002 proposed clearing it, and the
 * code refutes it): the only production caller is the source pane's debounced
 * re-parse, which fires on every keystroke in a workflow file — including while
 * a run is in flight. `finishExecution` matches on the id, so clearing it here
 * would leave a running execution unfinishable, its outcome unrecordable, and
 * every "is a run active" read false while the backend was still working.
 */
export function setGraph(
  slice: PreviewSlice,
  graph: WorkflowGraph | null,
  error?: string,
): PreviewSlice {
  return {
    ...slice,
    graph,
    parseError: error ?? null,
    activeStepId: null,
    stepStatuses: {},
  };
}

export function setActiveStepId(slice: PreviewSlice, activeStepId: string | null): PreviewSlice {
  return { ...slice, activeStepId };
}

export function setExecution(slice: PreviewSlice, executionId: string | null): PreviewSlice {
  return { ...slice, executionId, stepStatuses: {}, lastRunOutcome: null };
}

/**
 * End `executionId`, KEEPING its step statuses (audit #767).
 *
 * `setExecution(null)` discarded every step result at the moment the run ended
 * — the canvas lost its success/failure colouring exactly when the user wanted
 * to read it — and made completed, failed and cancelled indistinguishable.
 * Request-scoped: a terminal frame from an earlier run cannot end a newer one,
 * and returns the slice unchanged so the store can skip the write entirely.
 */
export function finishExecution(
  slice: PreviewSlice,
  executionId: string,
  outcome: WorkflowRunOutcome,
): PreviewSlice {
  if (slice.executionId !== executionId) return slice;
  return { ...slice, executionId: null, lastRunOutcome: outcome };
}

export function setStepStatus(
  slice: PreviewSlice,
  stepId: string,
  entry: StepStatusEntry,
): PreviewSlice {
  return { ...slice, stepStatuses: { ...slice.stepStatuses, [stepId]: entry } };
}

export function resetStatuses(slice: PreviewSlice): PreviewSlice {
  return { ...slice, stepStatuses: {} };
}
