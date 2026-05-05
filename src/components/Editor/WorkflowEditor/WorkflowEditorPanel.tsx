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

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { DiagnosticsBanner } from "./DiagnosticsBanner";
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
  // Form-generation counter — bumped on Discard so the JobForm /
  // StepForm remount, dropping any locally-typed-but-uncommitted
  // `useState` values. Without this, "Discard" cleared the patch queue
  // (via SaveControls.handleDiscard → clearPatches) but the visible
  // form fields still showed the user's mid-edit text (impact-analyst
  // audit finding for WI-7.2).
  const [formGen, setFormGen] = useState(0);

  const handleDiscard = useCallback((): void => {
    setFormGen((n) => n + 1);
    onDiscard();
  }, [onDiscard]);

  // Restore focus after a step→step navigation remount. The `key=`
  // prop change unmounts/remounts StepForm and strands keyboard focus
  // on document.body. Only fires when transitioning between two
  // non-null step ids — initial selection (null → step) does NOT
  // auto-focus, so users who clicked a step row in JobForm aren't
  // pulled to the nav buttons. Codex audit MED-3 + verify regression.
  const prevStepIdRef = useRef<string | null>(null);
  useEffect(() => {
    const wasStepNavigation =
      prevStepIdRef.current !== null &&
      selectedStepId !== null &&
      prevStepIdRef.current !== selectedStepId;
    prevStepIdRef.current = selectedStepId;
    if (!wasStepNavigation) return;
    // Defer to the next frame so the new StepForm has mounted before
    // we query its DOM. requestAnimationFrame ensures layout has run.
    const id = requestAnimationFrame(() => {
      const next = document.querySelector(
        '.workflow-form__nav-btn[aria-label*="Next"]:not([disabled])',
      ) as HTMLElement | null;
      const prev = document.querySelector(
        '.workflow-form__nav-btn[aria-label*="Previous"]:not([disabled])',
      ) as HTMLElement | null;
      const back = document.querySelector(
        '.workflow-form__nav-btn[aria-label*="Back to job"]',
      ) as HTMLElement | null;
      (next ?? prev ?? back)?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [selectedStepId]);

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
  const stepCount = selectedJob ? selectedJob.steps.length : 0;
  const prevStepId =
    selectedJob && selectedStepIndex > 0
      ? selectedJob.steps[selectedStepIndex - 1].id
      : null;
  const nextStepId =
    selectedJob && selectedStepIndex >= 0 && selectedStepIndex < stepCount - 1
      ? selectedJob.steps[selectedStepIndex + 1].id
      : null;

  return (
    <div className="workflow-editor-panel">
      <SaveControls onSave={onSave} onDiscard={handleDiscard} />
      <DiagnosticsBanner diagnostics={workflow.diagnostics} />
      <TriggerForm triggers={workflow.triggers} />
      {selectedStep && selectedJob ? (
        // key forces remount when selection switches so useState seeded
        // from the IR resets cleanly. Without this, switching jobs/steps
        // shows stale field values from the previously-selected entity.
        // The formGen suffix bumps on Discard for the same reason
        // applied to mid-edit fields.
        <StepForm
          key={`${selectedJob.id}::${selectedStep.id}::${formGen}`}
          jobId={selectedJob.id}
          stepIndex={selectedStepIndex}
          step={selectedStep}
          stepCount={stepCount}
          prevStepId={prevStepId}
          nextStepId={nextStepId}
        />
      ) : selectedJob ? (
        <JobForm
          key={`${selectedJob.id}::${formGen}`}
          job={selectedJob}
        />
      ) : (
        <div className="workflow-editor-panel__empty">
          {t("form.empty.selectJob")}
        </div>
      )}
    </div>
  );
}
