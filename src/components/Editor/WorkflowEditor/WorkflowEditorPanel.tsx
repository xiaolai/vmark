/**
 * Purpose: Container for the structured workflow editor surface. Sits
 *   below the @xyflow/react canvas in the side panel and shows:
 *
 *     1. SaveControls bar (top, always visible).
 *     2. TriggerForm read-only summary.
 *     3. Either a JobForm (if a job is selected) or a StepForm (if a
 *        step within a job is selected) or a "select a job" hint.
 *
 *   Selection is driven by the workflow view store, which is also
 *   what JobNode click handlers populate, so the canvas and form
 *   are tightly bound through the store rather than via props.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 7 / WI-7.1 + WI-7.2.
 *
 * @coordinates-with src/stores/workflowViewStore.ts — selection
 * @coordinates-with src/stores/workflowEditStore.ts — patch queue
 * @module components/Editor/WorkflowEditor/WorkflowEditorPanel
 */

import { type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { JobForm } from "./JobForm";
import { StepForm } from "./StepForm";
import { TriggerForm } from "./TriggerForm";
import { SaveControls } from "./SaveControls";
import "./workflow-editor.css";

interface WorkflowEditorPanelProps {
  workflow: WorkflowIR | null;
  onSave: () => Promise<void> | void;
  onDiscard: () => void;
}

export function WorkflowEditorPanel({
  workflow,
  onSave,
  onDiscard,
}: WorkflowEditorPanelProps): ReactElement | null {
  const { t } = useTranslation("workflowEditor");
  const selectedJobId = useWorkflowViewStore((s) => s.selectedJobId);
  const selectedStepId = useWorkflowViewStore((s) => s.selectedStepId);

  if (!workflow) return null;

  const selectedJob = selectedJobId
    ? workflow.jobs.find((j) => j.id === selectedJobId) ?? null
    : null;

  const selectedStepIndex =
    selectedJob && selectedStepId
      ? selectedJob.steps.findIndex((s) => s.id === selectedStepId)
      : -1;
  const selectedStep =
    selectedStepIndex >= 0 ? selectedJob!.steps[selectedStepIndex] : null;

  return (
    <div className="workflow-editor-panel">
      <SaveControls onSave={onSave} onDiscard={onDiscard} />
      <TriggerForm triggers={workflow.triggers} />
      {selectedStep && selectedJob ? (
        <StepForm
          jobId={selectedJob.id}
          stepIndex={selectedStepIndex}
          step={selectedStep}
        />
      ) : selectedJob ? (
        <JobForm job={selectedJob} />
      ) : (
        <div className="workflow-editor-panel__empty">
          {t("form.empty.selectJob")}
        </div>
      )}
    </div>
  );
}
