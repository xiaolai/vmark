/**
 * Unified Workflow Store — T09 consolidation.
 *
 * Merges five legacy workflow stores into a single Zustand store with
 * namespaced state slices. Action names are flat but prefixed to keep
 * each domain's verbs distinct.
 *
 * Slice mapping (was → is):
 *   - ghaWorkflowPanelStore      → state.gha (per-tab IR via sourceGhaIrSync; panel actions retired)
 *   - workflowPreviewStore       → state.preview + preview* actions
 *   - workflowViewStore          → state.view    + selectJob/.../resetView
 *   - workflowEditStore          → state.edit    + queuePatch/.../applyAndSerialize
 *     (the queue algebra lives in `workflowEditQueue.ts`, the YAML
 *      serialization in `workflowSerialize.ts`)
 *   - workflowApprovalStore      → state.approval + enqueueApproval / dismissApproval
 *
 * Each slice's TRANSITIONS are pure functions in a sibling module —
 * `workflowPreviewSlice`, `workflowViewSlice`, `workflowApprovalSlice`,
 * `workflowEditQueue`, `workflowSerialize` — and this file is the wiring that
 * lifts them into Zustand (audit #1001). One store, five readable domains.
 *
 * Why one store? The five legacy stores all coordinate around a single
 * workflow document; splitting them only spread per-feature state
 * thinly. Keeping state namespaced preserves slice locality without the
 * file-count explosion.
 *
 * @module stores/workflowStore
 */

import { create } from "zustand";
import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import { serializeWithPatches, type WorkflowSerializeResult } from "./workflowSerialize";
import {
  bindEditDocument,
  dedupQueue,
  mirrorActiveQueue,
  patchTarget,
  renameEditDocument,
  type EditSlice,
} from "./workflowEditQueue";
import * as preview from "./workflowPreviewSlice";
import * as view from "./workflowViewSlice";
import * as approval from "./workflowApprovalSlice";
import type { PreviewSlice, WorkflowRunOutcome } from "./workflowPreviewSlice";
import type { ViewSlice } from "./workflowViewSlice";
import type { ApprovalRequestPayload, ApprovalSlice } from "./workflowApprovalSlice";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import type { WorkflowGraph } from "@/lib/workflow/types";
import type { LayoutDirection } from "@/lib/ghaWorkflow/render/layout";

import type { StepStatusEntry } from "@/lib/workflow/types";

/* ───────────────────────────── slice shapes ───────────────────────────── */

interface GhaSlice {
  /** Live IR per tab — split panes (#1081) must not clobber each other. */
  byTab: Record<string, WorkflowIR>;
}

interface WorkflowStoreState {
  gha: GhaSlice;
  preview: PreviewSlice;
  view: ViewSlice;
  edit: EditSlice;
  approval: ApprovalSlice;
}

/* ─────────────────────────────── actions ──────────────────────────────── */

interface WorkflowStoreActions {
  // gha slice (standalone .yml workflow IR, written by sourceGhaIrSync)
  setGhaWorkflow: (tabId: string, workflow: WorkflowIR | null) => void;
  resetGha: () => void;

  // preview slice (Genie/embedded workflow)
  previewOpenPanel: () => void;
  previewClosePanel: () => void;
  previewTogglePanel: () => void;
  setGraph: (graph: WorkflowGraph | null, error?: string) => void;
  setActiveStepId: (stepId: string | null) => void;
  setExecution: (id: string | null) => void;
  /** End a run, keeping its step statuses (audit #767); see the impl. */
  finishExecution: (executionId: string, outcome: WorkflowRunOutcome) => void;
  setStepStatus: (stepId: string, entry: StepStatusEntry) => void;
  resetPreviewStatuses: () => void;
  resetPreview: () => void;

  // view slice (canvas selection)
  selectJob: (jobId: string) => void;
  selectStep: (jobId: string, stepId: string) => void;
  clearSelection: () => void;
  toggleMatrix: (jobId: string) => void;
  setLayoutDirection: (dir: LayoutDirection) => void;
  resetView: () => void;

  // edit slice (structured editor patch queue)
  queuePatch: (patch: IRPatch) => void;
  cancelPatchForTarget: (target: IRPatch) => void;
  clearPatches: () => void;
  bindToDocument: (documentId: string | null) => void;
  renameDocument: (from: string, to: string) => void;
  setPreserveYamlFormatting: (preserve: boolean | null) => void;
  /**
   * Apply the bound queue to `originalYaml` and report EXACTLY what happened
   * (audit #991/#1006) — a parse failure, a patch that would not apply, the
   * wrong document, a legitimate no-op, or the new text.
   */
  serializeWorkflowEdits: (originalYaml: string, documentId?: string) => WorkflowEditsResult;
  /**
   * The same, collapsed to text: the new YAML, or `originalYaml` for every
   * other outcome. A convenience for callers that only want the string; a
   * caller that must tell a failure from a no-op wants `serializeWorkflowEdits`.
   */
  applyAndSerialize: (originalYaml: string, documentId?: string) => string;
  resetEdit: () => void;

  // approval slice
  enqueueApproval: (req: ApprovalRequestPayload) => void;
  /** Clear the pending approval; `only` scopes it to that request (#1009). */
  dismissApproval: (only?: { executionId: string; stepId: string }) => void;
  resetApproval: () => void;
}

/**
 * What `serializeWorkflowEdits` reports: everything the serializer can say,
 * plus the store-level binding check that has to happen before it is called.
 */
export type WorkflowEditsResult =
  | WorkflowSerializeResult
  /** The queue belongs to another document; nothing was read or applied. */
  | { status: "wrong-document"; boundDocumentId: string | null };

export type WorkflowStore = WorkflowStoreState & WorkflowStoreActions;

/* ────────────────────────────── initial state ─────────────────────────── */

const initialGha: GhaSlice = {
  byTab: {},
};

const initialEdit: EditSlice = {
  pendingPatches: [],
  preserveYamlFormatting: null,
  boundDocumentId: null,
  patchesByDocument: {},
};

/* ────────────────────────────── store factory ─────────────────────────── */

export const useWorkflowStore = create<WorkflowStore>((set, get) => {
  /** Apply a pure preview transition; the same reference back means no-op. */
  const updatePreview = (f: (s: PreviewSlice) => PreviewSlice) =>
    set((state) => {
      const next = f(state.preview);
      return next === state.preview ? {} : { preview: next };
    });
  const updateView = (f: (s: ViewSlice) => ViewSlice) =>
    set((state) => ({ view: f(state.view) }));

  return {
    gha: initialGha,
    preview: preview.initialPreview,
    view: view.initialView,
    edit: initialEdit,
    approval: approval.initialApproval,

    /* gha slice */
    setGhaWorkflow: (tabId, workflow) =>
      set((s) => {
        const byTab = { ...s.gha.byTab };
        if (workflow) byTab[tabId] = workflow;
        else delete byTab[tabId];
        return { gha: { byTab } };
      }),
    resetGha: () => set({ gha: initialGha }),

    /* preview slice — transitions in workflowPreviewSlice.ts */
    previewOpenPanel: () => updatePreview((s) => preview.setPanelOpen(s, true)),
    previewClosePanel: () => updatePreview((s) => preview.setPanelOpen(s, false)),
    previewTogglePanel: () => updatePreview(preview.togglePanel),
    setGraph: (graph, error) => updatePreview((s) => preview.setGraph(s, graph, error)),
    setActiveStepId: (stepId) => updatePreview((s) => preview.setActiveStepId(s, stepId)),
    setExecution: (id) => updatePreview((s) => preview.setExecution(s, id)),
    finishExecution: (executionId, outcome) =>
      updatePreview((s) => preview.finishExecution(s, executionId, outcome)),
    setStepStatus: (stepId, entry) => updatePreview((s) => preview.setStepStatus(s, stepId, entry)),
    resetPreviewStatuses: () => updatePreview(preview.resetStatuses),
    resetPreview: () => set({ preview: preview.initialPreview }),

    /* view slice — transitions in workflowViewSlice.ts */
    selectJob: (jobId) => updateView((s) => view.selectJob(s, jobId)),
    selectStep: (jobId, stepId) => updateView((s) => view.selectStep(s, jobId, stepId)),
    clearSelection: () => updateView(view.clearSelection),
    toggleMatrix: (jobId) => updateView((s) => view.toggleMatrix(s, jobId)),
    setLayoutDirection: (dir) => updateView((s) => view.setLayoutDirection(s, dir)),
    resetView: () => set({ view: view.resetView() }),

    /* edit slice */
    queuePatch: (patch) =>
      set((s) => {
        const next = dedupQueue(s.edit.pendingPatches, patch);
        return { edit: mirrorActiveQueue(s.edit, next) };
      }),
    cancelPatchForTarget: (target) =>
      set((s) => {
        const t = patchTarget(target);
        const next = s.edit.pendingPatches.filter((p) => patchTarget(p) !== t);
        if (next.length === s.edit.pendingPatches.length) return {};
        return { edit: mirrorActiveQueue(s.edit, next) };
      }),
    clearPatches: () =>
      set((s) => ({ edit: mirrorActiveQueue(s.edit, []) })),
    bindToDocument: (documentId) =>
      set((s) => {
        const bound = bindEditDocument(s.edit, documentId);
        if (bound === null) return {};
        // An UNBOUND queue has no stash slot (`mirrorActiveQueue` skips the mirror
        // while `boundDocumentId` is null), so a plain bind DROPPED it — the first
        // bind replaced those patches with the incoming document's stash and the
        // edits were gone with no signal at all (audit #1004). They are adopted
        // into the document being bound instead, through the same dedup/mirror
        // algebra every other queue write uses. The incoming document's own queue
        // keeps precedence and the orphans follow it, the ordering
        // `renameEditDocument` already documents for the same situation.
        const orphaned = s.edit.boundDocumentId === null ? s.edit.pendingPatches : [];
        if (orphaned.length === 0 || documentId === null) return { edit: bound };
        const merged = orphaned.reduce(dedupQueue, bound.pendingPatches);
        return { edit: mirrorActiveQueue(bound, merged) };
      }),
    /**
     * Carry a document's queued patches to a new id, binding included — what a
     * Save As does to the document a queue belongs to (audit 20260907, #292).
     * The transformation itself is `renameEditDocument`; `null` means nothing
     * to do, and returning `{}` from `set` is Zustand's no-op.
     */
    renameDocument: (from, to) =>
      set((s) => {
        const edit = renameEditDocument(s.edit, from, to);
        return edit === null ? {} : { edit };
      }),

    setPreserveYamlFormatting: (preserve) =>
      set((s) => ({
        edit: { ...s.edit, preserveYamlFormatting: preserve },
      })),
    serializeWorkflowEdits: (originalYaml, documentId) => {
      const { pendingPatches, preserveYamlFormatting, boundDocumentId } = get().edit;
      // The binding is a single global slot, so a caller that read its queue and
      // then awaited could serialize whatever ANOTHER pane bound meanwhile
      // (audit #1005). A mismatch is its OWN outcome now (#991): it used to be
      // spelled "the text came back unchanged", indistinguishable from a parse
      // failure and from an edit that genuinely changes nothing.
      if (documentId !== undefined && boundDocumentId !== documentId) {
        return { status: "wrong-document", boundDocumentId };
      }
      return serializeWithPatches(originalYaml, pendingPatches, preserveYamlFormatting);
    },

    applyAndSerialize: (originalYaml, documentId) => {
      const result = get().serializeWorkflowEdits(originalYaml, documentId);
      return result.status === "applied" ? result.yaml : originalYaml;
    },

    resetEdit: () => set({ edit: initialEdit }),

    /* approval slice — transitions in workflowApprovalSlice.ts */
    enqueueApproval: (req) => set({ approval: approval.enqueue(req) }),
    dismissApproval: (only) =>
      set((s) => {
        const next = approval.dismiss(s.approval, only);
        return next === s.approval ? {} : { approval: next };
      }),
    resetApproval: () => set({ approval: approval.initialApproval }),
  };
});

/* The legacy `export type { IRPatch }` compat alias is GONE (audit #1010). It
 * dated from the T09 store consolidation, had no deprecation and no removal
 * path, and its last consumer (`WorkflowEditor/withRowPlans.ts`) now imports the
 * type from `@/lib/ghaWorkflow/save/mutators`, which defines it.
 *
 * Re-exported so the slice modules stay an implementation detail of the store:
 * `useWorkflowExecution` and the workflow panels import these names from here. */
export type { WorkflowRunOutcome, PreviewSlice, ViewSlice, ApprovalRequestPayload };
