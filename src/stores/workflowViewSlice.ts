/**
 * The canvas-selection slice's transitions — pure functions over `ViewSlice`.
 *
 * Split from `workflowStore.ts` for the same reason as the preview slice
 * (audit #1001): the store file is the wiring, and a 156-line initializer
 * carrying five domains had pushed it past the ~300-line cap.
 *
 * @coordinates-with src/stores/workflowStore.ts — the only consumer
 * @module stores/workflowViewSlice
 */
import type { LayoutDirection } from "@/lib/ghaWorkflow/render/layout";

export interface ViewSlice {
  selectedJobId: string | null;
  selectedStepId: string | null;
  expandedMatrices: Set<string>;
  layoutDirection: LayoutDirection;
}

export const initialView: ViewSlice = {
  selectedJobId: null,
  selectedStepId: null,
  expandedMatrices: new Set<string>(),
  layoutDirection: "TD",
};

export function selectJob(slice: ViewSlice, jobId: string): ViewSlice {
  return { ...slice, selectedJobId: jobId, selectedStepId: null };
}

export function selectStep(slice: ViewSlice, jobId: string, stepId: string): ViewSlice {
  return { ...slice, selectedJobId: jobId, selectedStepId: stepId };
}

export function clearSelection(slice: ViewSlice): ViewSlice {
  return { ...slice, selectedJobId: null, selectedStepId: null };
}

export function toggleMatrix(slice: ViewSlice, jobId: string): ViewSlice {
  const next = new Set(slice.expandedMatrices);
  if (next.has(jobId)) next.delete(jobId);
  else next.add(jobId);
  return { ...slice, expandedMatrices: next };
}

export function setLayoutDirection(slice: ViewSlice, layoutDirection: LayoutDirection): ViewSlice {
  return { ...slice, layoutDirection };
}

/**
 * A FRESH `Set` every time, never `initialView`'s own.
 *
 * `initialView.expandedMatrices` is one mutable object shared by the module; a
 * reset that handed it back would let the next `toggleMatrix`… — which copies
 * before mutating — be fine, but any future in-place edit would corrupt the
 * initial state for every later reset.
 */
export function resetView(): ViewSlice {
  return { ...initialView, expandedMatrices: new Set<string>() };
}
