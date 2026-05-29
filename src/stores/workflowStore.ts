/**
 * Unified Workflow Store — T09 consolidation.
 *
 * Merges five legacy workflow stores into a single Zustand store with
 * namespaced state slices. Action names are flat but prefixed to keep
 * each domain's verbs distinct.
 *
 * Slice mapping (was → is):
 *   - ghaWorkflowPanelStore      → state.gha    + gha* actions
 *   - workflowPreviewStore       → state.preview + preview* actions
 *   - workflowViewStore          → state.view    + selectJob/.../resetView
 *   - workflowEditStore          → state.edit    + queuePatch/.../applyAndSerialize
 *   - workflowApprovalStore      → state.approval + enqueueApproval / dismissApproval
 *
 * Why one store? The five legacy stores all coordinate around a single
 * workflow document; splitting them only spread per-feature state
 * thinly. Keeping state namespaced preserves slice locality without the
 * file-count explosion.
 *
 * @module stores/workflowStore
 */

import { create } from "zustand";
import { stringify as yamlStringify } from "yaml";
import {
  parseAsCst,
  stringifyCst,
  WORKFLOW_YAML_STRINGIFY_OPTIONS,
} from "@/lib/ghaWorkflow/save/cstParser";
import { applyPatch, type IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import { useSettingsStore } from "@/stores/settingsStore";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import type { WorkflowGraph } from "@/lib/workflow/types";
import type { LayoutDirection } from "@/lib/ghaWorkflow/render/layout";

/* ──────────────────────────── re-exported types ───────────────────────── */

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

export interface ApprovalRequestPayload {
  executionId: string;
  stepId: string;
  summary: string;
  preview: string;
  model?: string | null;
}

/* ───────────────────────────── slice shapes ───────────────────────────── */

interface GhaSlice {
  panelOpen: boolean;
  workflow: WorkflowIR | null;
  parseError: string | null;
}

interface PreviewSlice {
  panelOpen: boolean;
  graph: WorkflowGraph | null;
  parseError: string | null;
  activeStepId: string | null;
  executionId: string | null;
  stepStatuses: Record<string, StepStatusEntry>;
}

interface ViewSlice {
  selectedJobId: string | null;
  selectedStepId: string | null;
  expandedMatrices: Set<string>;
  layoutDirection: LayoutDirection;
}

interface EditSlice {
  pendingPatches: IRPatch[];
  preserveYamlFormatting: boolean | null;
  boundDocumentId: string | null;
  patchesByDocument: Record<string, IRPatch[]>;
}

interface ApprovalSlice {
  pending: ApprovalRequestPayload | null;
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
  // gha slice (standalone .yml panel)
  ghaOpenPanel: () => void;
  ghaClosePanel: () => void;
  ghaTogglePanel: () => void;
  setGhaWorkflow: (workflow: WorkflowIR | null, error?: string) => void;
  resetGha: () => void;

  // preview slice (Genie/embedded workflow)
  previewOpenPanel: () => void;
  previewClosePanel: () => void;
  previewTogglePanel: () => void;
  setGraph: (graph: WorkflowGraph | null, error?: string) => void;
  setActiveStepId: (stepId: string | null) => void;
  setExecution: (id: string | null) => void;
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
  setPreserveYamlFormatting: (preserve: boolean | null) => void;
  applyAndSerialize: (originalYaml: string) => string;
  resetEdit: () => void;

  // approval slice
  enqueueApproval: (req: ApprovalRequestPayload) => void;
  dismissApproval: () => void;
  resetApproval: () => void;
}

export type WorkflowStore = WorkflowStoreState & WorkflowStoreActions;

/* ────────────────────────────── initial state ─────────────────────────── */

const initialGha: GhaSlice = {
  panelOpen: false,
  workflow: null,
  parseError: null,
};

const initialPreview: PreviewSlice = {
  panelOpen: false,
  graph: null,
  parseError: null,
  activeStepId: null,
  executionId: null,
  stepStatuses: {},
};

const initialView: ViewSlice = {
  selectedJobId: null,
  selectedStepId: null,
  expandedMatrices: new Set<string>(),
  layoutDirection: "TD",
};

const initialEdit: EditSlice = {
  pendingPatches: [],
  preserveYamlFormatting: null,
  boundDocumentId: null,
  patchesByDocument: {},
};

const initialApproval: ApprovalSlice = {
  pending: null,
};

/* ────────────────────────── edit-slice helpers ────────────────────────── */

function resolvePreserve(override: boolean | null): boolean {
  if (override !== null) return override;
  return (
    useSettingsStore.getState().advanced
      .workflowEditorPreserveYamlFormatting ?? true
  );
}

function patchTarget(patch: IRPatch): string {
  switch (patch.kind) {
    case "workflow.set":
      return `workflow.set:${patch.path}`;
    case "job.set":
      return `job.set:${patch.jobId}:${patch.path}`;
    case "step.set":
      return `step.set:${patch.jobId}:${patch.stepIndex}:${patch.path}`;
    case "with.set":
    case "with.remove":
      return `with:${patch.jobId}:${patch.stepIndex}:${patch.key}`;
    case "needs.add":
    case "needs.remove":
      return `needs:${patch.jobId}:${patch.ref}`;
    case "trigger.setFilters":
      return `trigger.setFilters:${patch.event}:${patch.filter}`;
    case "job.create":
      return `job.create:${patch.jobId}`;
    case "job.delete":
      return `job.delete:${patch.jobId}`;
    case "step.insert":
      return `step.insert:${patch.jobId}:${patch.index}:${JSON.stringify(patch.step)}`;
    case "step.delete":
      return `step.delete:${patch.jobId}:${patch.stepIndex}`;
    case "step.move":
      return `step.move:${patch.jobId}:${patch.fromIndex}:${patch.toIndex}`;
    case "workflow.permissions.set":
      return `workflow.permissions.set`;
    case "workflow.concurrency.set":
      return `workflow.concurrency.set`;
  }
}

function dedupQueue(queue: IRPatch[], next: IRPatch): IRPatch[] {
  const target = patchTarget(next);
  const filtered = queue.filter((p) => patchTarget(p) !== target);
  filtered.push(next);
  return filtered;
}

function mirrorActiveQueue(slice: EditSlice, next: IRPatch[]): EditSlice {
  if (slice.boundDocumentId === null) {
    return { ...slice, pendingPatches: next };
  }
  const stashed = { ...slice.patchesByDocument };
  if (next.length === 0) {
    delete stashed[slice.boundDocumentId];
  } else {
    stashed[slice.boundDocumentId] = next;
  }
  return { ...slice, pendingPatches: next, patchesByDocument: stashed };
}

/* ────────────────────────────── store factory ─────────────────────────── */

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  gha: initialGha,
  preview: initialPreview,
  view: initialView,
  edit: initialEdit,
  approval: initialApproval,

  /* gha slice */
  ghaOpenPanel: () =>
    set((s) => ({ gha: { ...s.gha, panelOpen: true } })),
  ghaClosePanel: () =>
    set((s) => ({ gha: { ...s.gha, panelOpen: false } })),
  ghaTogglePanel: () =>
    set((s) => ({ gha: { ...s.gha, panelOpen: !s.gha.panelOpen } })),
  setGhaWorkflow: (workflow, error) =>
    set((s) => ({
      gha: { ...s.gha, workflow, parseError: error ?? null },
    })),
  resetGha: () => set({ gha: initialGha }),

  /* preview slice */
  previewOpenPanel: () =>
    set((s) => ({ preview: { ...s.preview, panelOpen: true } })),
  previewClosePanel: () =>
    set((s) => ({ preview: { ...s.preview, panelOpen: false } })),
  previewTogglePanel: () =>
    set((s) => ({
      preview: { ...s.preview, panelOpen: !s.preview.panelOpen },
    })),
  setGraph: (graph, error) =>
    set((s) => ({
      preview: {
        ...s.preview,
        graph,
        parseError: error ?? null,
        activeStepId: null,
        stepStatuses: {},
      },
    })),
  setActiveStepId: (stepId) =>
    set((s) => ({ preview: { ...s.preview, activeStepId: stepId } })),
  setExecution: (id) =>
    set((s) => ({
      preview: { ...s.preview, executionId: id, stepStatuses: {} },
    })),
  setStepStatus: (stepId, entry) =>
    set((s) => ({
      preview: {
        ...s.preview,
        stepStatuses: { ...s.preview.stepStatuses, [stepId]: entry },
      },
    })),
  resetPreviewStatuses: () =>
    set((s) => ({ preview: { ...s.preview, stepStatuses: {} } })),
  resetPreview: () => set({ preview: initialPreview }),

  /* view slice */
  selectJob: (jobId) =>
    set((s) => ({
      view: { ...s.view, selectedJobId: jobId, selectedStepId: null },
    })),
  selectStep: (jobId, stepId) =>
    set((s) => ({
      view: { ...s.view, selectedJobId: jobId, selectedStepId: stepId },
    })),
  clearSelection: () =>
    set((s) => ({
      view: { ...s.view, selectedJobId: null, selectedStepId: null },
    })),
  toggleMatrix: (jobId) =>
    set((s) => {
      const next = new Set(s.view.expandedMatrices);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return { view: { ...s.view, expandedMatrices: next } };
    }),
  setLayoutDirection: (dir) =>
    set((s) => ({ view: { ...s.view, layoutDirection: dir } })),
  resetView: () =>
    set({ view: { ...initialView, expandedMatrices: new Set() } }),

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
      if (s.edit.boundDocumentId === documentId) return {};
      const stashed: Record<string, IRPatch[]> = { ...s.edit.patchesByDocument };
      if (s.edit.boundDocumentId !== null) {
        if (s.edit.pendingPatches.length === 0) {
          delete stashed[s.edit.boundDocumentId];
        } else {
          stashed[s.edit.boundDocumentId] = s.edit.pendingPatches;
        }
      }
      const restored =
        documentId !== null ? stashed[documentId] ?? [] : [];
      return {
        edit: {
          ...s.edit,
          boundDocumentId: documentId,
          pendingPatches: restored,
          patchesByDocument: stashed,
        },
      };
    }),
  setPreserveYamlFormatting: (preserve) =>
    set((s) => ({
      edit: { ...s.edit, preserveYamlFormatting: preserve },
    })),
  applyAndSerialize: (originalYaml) => {
    const { pendingPatches, preserveYamlFormatting } = get().edit;
    if (pendingPatches.length === 0) return originalYaml;
    try {
      const doc = parseAsCst(originalYaml);
      if (doc.errors.length > 0) return originalYaml;
      for (const patch of pendingPatches) applyPatch(doc, patch);
      if (resolvePreserve(preserveYamlFormatting)) return stringifyCst(doc);
      return yamlStringify(doc.toJS({ maxAliasCount: -1 }), {
        ...WORKFLOW_YAML_STRINGIFY_OPTIONS,
      });
    } catch {
      return originalYaml;
    }
  },

  resetEdit: () => set({ edit: initialEdit }),

  /* approval slice */
  enqueueApproval: (req) =>
    set({ approval: { pending: req } }),
  dismissApproval: () =>
    set({ approval: { pending: null } }),
  resetApproval: () => set({ approval: initialApproval }),
}));

/* re-export legacy patch type for compat */
export type { IRPatch };
