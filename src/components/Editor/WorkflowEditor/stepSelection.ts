/**
 * Purpose: the selected job/step derivation for the forms editor — a pure
 *   function over the preview IR, split out of WorkflowEditorPanel (audit
 *   20260907, #283) so the neighbour arithmetic the StepForm nav relies on
 *   is testable without rendering.
 *
 * @coordinates-with src/components/Editor/WorkflowEditor/WorkflowEditorPanel.tsx — the consumer
 * @module components/Editor/WorkflowEditor/stepSelection
 */
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";

type Job = WorkflowIR["jobs"][number];
type Step = Job["steps"][number];

/** Every field is `readonly`: `NONE` below is ONE object shared by every empty
 *  result, so a consumer writing to what it was handed would rewrite the answer
 *  every later caller gets (audit R3 #582). The type says so, and `NONE` is
 *  frozen so an untyped caller finds out too. */
export interface StepSelectionContext {
  readonly selectedJob: Job | null;
  readonly selectedStep: Step | null;
  /** Index of the selected step within its job, or -1. */
  readonly selectedStepIndex: number;
  readonly stepCount: number;
  readonly prevStepId: string | null;
  readonly nextStepId: string | null;
}

const NONE: StepSelectionContext = Object.freeze({
  selectedJob: null,
  selectedStep: null,
  selectedStepIndex: -1,
  stepCount: 0,
  prevStepId: null,
  nextStepId: null,
});

/** Resolve the store's (jobId, stepId) selection against `workflow`. */
export function selectStepContext(
  workflow: WorkflowIR,
  selectedJobId: string | null,
  selectedStepId: string | null,
): StepSelectionContext {
  const selectedJob = selectedJobId
    ? (workflow.jobs.find((j) => j.id === selectedJobId) ?? null)
    : null;
  if (!selectedJob) return NONE;
  const steps = selectedJob.steps;
  const index = selectedStepId ? steps.findIndex((s) => s.id === selectedStepId) : -1;
  return {
    selectedJob,
    selectedStep: index >= 0 ? steps[index] : null,
    selectedStepIndex: index,
    stepCount: steps.length,
    prevStepId: index > 0 ? steps[index - 1].id : null,
    nextStepId: index >= 0 && index < steps.length - 1 ? steps[index + 1].id : null,
  };
}
