/**
 * Purpose: Container for the structured workflow editor surface. Sits
 *   below the @xyflow/react canvas in the side panel and shows:
 *
 *     1. SaveControls bar (top, always visible).
 *     2. DiagnosticsBanner — the parser's `workflow.diagnostics[]` merged
 *        with actionlint's rows from `useActionlintDiagnostics` (gated by
 *        `advanced.workflowActionlint`, async, never delaying the parser's).
 *     3. Add-job control, PermissionsForm, ConcurrencyForm, and the
 *        TriggerForm read-only summary.
 *     4. Either a JobForm (if a job is selected) or a StepForm (if a
 *        step within a job is selected) or a "select a job" hint.
 *
 *   Selection is driven by the workflow view store, which is also
 *   what JobNode click handlers populate, so the canvas and form
 *   are tightly bound through the store rather than via props. It is a
 *   SINGLETON, so two mounted panels share one selection (audit R2, #572 —
 *   keying it by document is a workflowStore change, not a panel one).
 *
 *   The preview overlay, by contrast, is scoped: the panel reads the patch
 *   queue of the document the workbench hands it, never the store's active
 *   one, which under a document split can be the other pane's (audit R2, #575).
 *   The forms are handed a SECOND, structural-only IR beside it: a field's own
 *   queued edit must not be the value it compares itself against (#1020).
 *
 *   The container composes and nothing else (audit 20260907, #283): the
 *   preview overlay is `usePreviewWorkflow`, the selection → form choice is
 *   `SelectionForm`, the derivation `stepSelection.ts`, and the focus
 *   restoration `useStepFocusRestore`.
 *
 * Origin: GitHub Actions workflow viewer plan (2026-05-04, retired) §6
 *   Phase 7 / WI-7.1 + WI-7.2.
 *
 * @coordinates-with src/stores/workflowStore.ts — selection + patch queue
 * @coordinates-with src/components/Editor/WorkflowEditor/useActionlintDiagnostics.ts — actionlint rows (WI-FL3.8)
 * @coordinates-with src/components/Editor/WorkflowEditor/stepSelection.ts — selected job/step derivation
 * @coordinates-with src/components/Editor/WorkflowEditor/useStepFocusRestore.ts — focus after step navigation
 * @module components/Editor/WorkflowEditor/WorkflowEditorPanel
 */

import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import { useWorkflowStore } from "@/stores/workflowStore";
import { AddJobControl } from "./AddJobControl";
import { DiagnosticsBanner } from "./DiagnosticsBanner";
import { useActionlintDiagnostics } from "./useActionlintDiagnostics";
import { JobForm } from "./JobForm";
import { StepForm } from "./StepForm";
import { TriggerForm } from "./TriggerForm";
import { SaveControls } from "./SaveControls";
import { PermissionsForm } from "./PermissionsForm";
import { ConcurrencyForm } from "./ConcurrencyForm";
import {
  applyPreviewPatches,
  applyStructuralPatches,
} from "@/lib/ghaWorkflow/save/previewIR";
import { selectStepContext } from "./stepSelection";
import { useStepFocusRestore } from "./useStepFocusRestore";
import "./workflow-editor.css";

interface WorkflowEditorPanelProps {
  workflow: WorkflowIR | null;
  /** The hosting pane's tab — the text actionlint lints (WI-FL3.8). Null
   *  keeps the banner parser-only; the workbench always supplies it. */
  tabId: string | null;
  /** The edit store's id for THIS pane's document, from the workbench that
   *  owns the binding. The preview overlay reads the queue belonging to it
   *  rather than whichever queue is active (audit R2, #575). */
  documentId: string | null;
  onSave: () => Promise<void> | void;
  /** Optional: SaveControls already clears the queue and the forms remount
   *  here, so a host with no source-of-truth to reload passes nothing (#299). */
  onDiscard?: () => void;
}

export function WorkflowEditorPanel({
  workflow,
  tabId,
  documentId,
  onSave,
  onDiscard,
}: WorkflowEditorPanelProps): ReactElement | null {
  const selectedJobId = useWorkflowStore((s) => s.view.selectedJobId);
  const selectedStepId = useWorkflowStore((s) => s.view.selectedStepId);
  // Form-generation counter — bumped on Discard so the JobForm /
  // StepForm remount, dropping any locally-typed-but-uncommitted
  // `useState` values. Without this, "Discard" cleared the patch queue
  // (via SaveControls.handleDiscard → clearPatches) but the visible
  // form fields still showed the user's mid-edit text (impact-analyst
  // audit finding for WI-7.2).
  const [formGen, setFormGen] = useState(0);

  const handleDiscard = useCallback((): void => {
    setFormGen((n) => n + 1);
    onDiscard?.();
  }, [onDiscard]);

  // Focus follows a step→step navigation remount (never an initial selection).
  // Scoped to THIS panel: the selection lives in one store slice, so every
  // mounted panel's hook reacts to it, and a document-wide query put focus on
  // whichever pane's nav button came first in the DOM (audit R2, #586).
  const rootRef = useRef<HTMLDivElement>(null);
  useStepFocusRestore(selectedStepId, rootRef);

  // WI-FL3.8 — actionlint's rows (setting-gated, debounced, async) join
  // the parser's in the banner below; they never delay the parser's rows.
  const actionlintDiagnostics = useActionlintDiagnostics(tabId);
  const previewed = usePreviewWorkflow(workflow, documentId);

  if (!previewed) return null;
  const { preview: previewWorkflow, baseline } = previewed;

  // Every stateful control is keyed by `formGen` — Discard clears the patch
  // queue, and a control that kept its own `useState` went on showing the
  // value it had just discarded (audit R2, #574).
  return (
    <div className="workflow-editor-panel" ref={rootRef}>
      <SaveControls onSave={onSave} onDiscard={handleDiscard} />
      <DiagnosticsBanner
        diagnostics={[...previewWorkflow.diagnostics, ...actionlintDiagnostics]}
      />
      <AddJobControl key={`add-job::${formGen}`} existingIds={previewWorkflow.jobs.map((j) => j.id)} />
      <PermissionsForm key={`permissions::${formGen}`} permissions={previewWorkflow.permissions} />
      <ConcurrencyForm key={`concurrency::${formGen}`} concurrency={previewWorkflow.concurrency} />
      <TriggerForm key={`triggers::${formGen}`} triggers={previewWorkflow.triggers} />
      <SelectionForm
        workflow={previewWorkflow}
        baseline={baseline}
        selectedJobId={selectedJobId}
        selectedStepId={selectedStepId}
        formGen={formGen}
      />
    </div>
  );
}

/** Stable empty queue — a fresh `[]` per render would re-run the selector forever. */
const NO_PATCHES: readonly IRPatch[] = [];

/**
 * Preview-IR overlay: the parsed IR with the structural pendingPatches
 * (job.create/delete, step.insert/delete/move) applied, so freshly-added
 * entities are visible before save (WI-C0). Non-structural edits are
 * tracked via local React state in the form components. The store selector
 * keeps this reactive — the panel re-renders when patches enqueue/dequeue.
 *
 * THIS document's queue, not the active one. The edit store holds one active
 * binding and stashes every other document's queue, so a panel that read
 * `pendingPatches` unconditionally rendered the OTHER pane's edits over its own
 * workflow — a job created in one document appearing in another (audit R2,
 * #575).
 */
function usePreviewWorkflow(
  workflow: WorkflowIR | null,
  documentId: string | null,
): { preview: WorkflowIR; baseline: WorkflowIR } | null {
  const pendingPatches = useWorkflowStore((s) => {
    if (documentId === null) return NO_PATCHES;
    return s.edit.boundDocumentId === documentId
      ? s.edit.pendingPatches
      : (s.edit.patchesByDocument[documentId] ?? NO_PATCHES);
  });
  // Memoized on the two inputs (audit R3 #576). Both walks rebuild the IR, and
  // they ran on EVERY panel render — an actionlint result arriving, a Discard,
  // a selection change — even when neither the parsed workflow nor the queue
  // had moved. Worse than the work: each run handed the forms a fresh
  // `triggers`/`permissions`/`jobs` object, so nothing downstream could rely on
  // referential equality. With an empty queue `applyPreviewPatches` already
  // returns its input unchanged, so this only ever tightens identity.
  return useMemo(() => {
    if (!workflow) return null;
    return {
      preview: applyPreviewPatches(workflow, pendingPatches),
      // What the forms measure an edit against — the same IR WITHOUT the
      // content patches, so a field's own queued edit is not its baseline.
      baseline: applyStructuralPatches(workflow, pendingPatches),
    };
  }, [workflow, pendingPatches]);
}

interface SelectionFormProps {
  workflow: WorkflowIR;
  /** The pre-edit IR the forms compare a field against (#1020). Same jobs and
   *  step ORDER as `workflow`, so an id or index selects the same entity. */
  baseline: WorkflowIR;
  selectedJobId: string | null;
  selectedStepId: string | null;
  /** Bumped on Discard; part of the form keys so mid-edit fields remount. */
  formGen: number;
}

/** The form for the canvas selection: a step, a job, or the "select a job" hint (#283). */
function SelectionForm({ workflow, baseline, selectedJobId, selectedStepId, formGen }: SelectionFormProps): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const { selectedJob, selectedStep, selectedStepIndex, stepCount, prevStepId, nextStepId } =
    selectStepContext(workflow, selectedJobId, selectedStepId);
  const baselineJob = baseline.jobs.find((j) => j.id === selectedJob?.id);

  // key forces remount when selection switches so useState seeded from the
  // IR resets cleanly. Without this, switching jobs/steps shows stale field
  // values from the previously-selected entity. The formGen suffix bumps on
  // Discard for the same reason applied to mid-edit fields.
  if (selectedStep && selectedJob) {
    return (
      <StepForm
        key={`${selectedJob.id}::${selectedStep.id}::${formGen}`}
        jobId={selectedJob.id}
        stepIndex={selectedStepIndex}
        step={selectedStep}
        baseline={baselineJob?.steps[selectedStepIndex]}
        stepCount={stepCount}
        prevStepId={prevStepId}
        nextStepId={nextStepId}
      />
    );
  }
  if (selectedJob) {
    return (
      <JobForm
        key={`${selectedJob.id}::${formGen}`}
        job={selectedJob}
        baseline={baselineJob}
      />
    );
  }
  return <div className="workflow-editor-panel__empty">{t("form.empty.selectJob")}</div>;
}

