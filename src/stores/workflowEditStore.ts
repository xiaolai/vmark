/**
 * Purpose: Accumulates IRPatches produced by the structured workflow
 *   editor (Phase 7 forms) and provides the save pipeline that applies
 *   them to the on-disk YAML through the CST-preserving mutator path
 *   (Phase 8 ADR-11 gate).
 *
 *   Edit lifecycle:
 *     1. Phase 7 forms call `queuePatch()` for each user edit.
 *     2. UI reflects pending changes via `pendingPatches` / `dirty`.
 *     3. "Save" calls `applyAndSerialize(originalYaml)` to produce the
 *        new YAML; the caller writes it back to disk and then calls
 *        `clearPatches()`.
 *     4. "Discard" calls `clearPatches()` directly.
 *
 *   The store does NOT own the source YAML — that's `documentStore`
 *   for standalone files and Tiptap doc text for code-fence preview.
 *   This keeps the edit pipeline orthogonal to file I/O and makes the
 *   pipeline trivially testable.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 8 / WI-8.3.
 *
 * Key decisions:
 *   - `preserveYamlFormatting` is a per-store flag (default true). Off
 *     path uses plain `yaml.stringify` for users who want reformatted
 *     output. Lifting to persistent settings is a Phase 9 polish item.
 *   - Patch queue is FIFO and replayed in order — last-write-wins for
 *     the same path, which matches how the forms editor accumulates
 *     edits during a session.
 *   - `applyAndSerialize()` is pure and synchronous — no fs I/O — so it
 *     can be unit-tested without mocks.
 *
 * @coordinates-with src/lib/ghaWorkflow/save/cstParser.ts — parse + stringify
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — applyPatch
 * @coordinates-with src/components/Editor/WorkflowEditor/* (Phase 7) — patch source
 * @module stores/workflowEditStore
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

interface WorkflowEditState {
  /**
   * Pending patches for the currently-bound document. Mirror of
   * `patchesByDocument[boundDocumentId]` so existing consumers
   * (selectors, save flow) keep working without API change.
   */
  pendingPatches: IRPatch[];
  /**
   * Per-session override. When non-null, takes precedence over the
   * persisted `advanced.workflowEditorPreserveYamlFormatting` setting.
   * `null` = follow the persistent setting (the default).
   */
  preserveYamlFormatting: boolean | null;
  /**
   * Stable identity of the workflow document the queue is bound to
   * (typically the file path; `null` for untitled). Switching the
   * binding swaps `pendingPatches` to that document's stash —
   * unsaved work is preserved per document, NOT silently dropped.
   */
  boundDocumentId: string | null;
  /**
   * Per-document patch stash. Bounded by the number of workflow tabs
   * the user has open in a session — small in practice. Cleared by
   * `clearPatches()` for the active document only; full reset on app
   * exit since this state is in-memory only.
   */
  patchesByDocument: Record<string, IRPatch[]>;
}

interface WorkflowEditActions {
  queuePatch: (patch: IRPatch) => void;
  /**
   * Drop the queued patch (if any) that targets the same node + path
   * as `target`. Used by the form layer when a field is reverted to
   * its original IR value: the form returns early instead of queueing,
   * so an earlier stale patch would survive without this call
   * (cross-validator audit round 2 finding).
   */
  cancelPatchForTarget: (target: IRPatch) => void;
  clearPatches: () => void;
  /**
   * Bind the queue to a specific document (path / untitled-tab id).
   * If the new id differs from the current binding, any pending
   * patches are dropped — they were authored against the previous
   * document. Idempotent: rebinding to the same id is a no-op.
   */
  bindToDocument: (documentId: string | null) => void;
  /**
   * Set the per-session override. Pass `null` to revert to the
   * persistent setting (the default).
   */
  setPreserveYamlFormatting: (preserve: boolean | null) => void;
  /**
   * Apply all pending patches to `originalYaml` and serialize. Pure —
   * does not mutate the queue and does not touch disk. The caller is
   * responsible for writing the result and then calling clearPatches().
   *
   * Rationale for split: the only async dependency on the save side is
   * the disk write itself, which lives in the caller (e.g., Phase 7's
   * "Save" handler that uses Tauri fs). Keeping this synchronous makes
   * the pipeline testable as a pure function over (yaml, patches).
   */
  applyAndSerialize: (originalYaml: string) => string;
}

const initialState: WorkflowEditState = {
  pendingPatches: [],
  // null = follow the persistent advanced.workflowEditorPreserveYamlFormatting
  // setting (default true). Tests that need a deterministic value override
  // this directly via `useWorkflowEditStore.setState({...})`.
  preserveYamlFormatting: null,
  boundDocumentId: null,
  patchesByDocument: {},
};

/**
 * Resolve the effective preserve-formatting flag. Per-session override
 * (workflowEditStore.preserveYamlFormatting) takes precedence; when null,
 * fall through to the persistent settings store. Default is true if
 * neither source has spoken.
 */
function resolvePreserve(override: boolean | null): boolean {
  if (override !== null) return override;
  return (
    useSettingsStore.getState().advanced
      .workflowEditorPreserveYamlFormatting ?? true
  );
}

/**
 * Stable string identity for "what does this patch target". Two
 * patches with the same target are considered redundant: the latest
 * one wins. Used by `queuePatch` to keep the queue from accumulating
 * stale entries when the user reverts a field to its original value.
 */
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
    // New patch kinds (WI-C.1/C.2/C.3). Each instance has a distinct
    // target so we don't dedupe — using a unique-per-call identifier.
    case "job.create":
      return `job.create:${patch.jobId}`;
    case "job.delete":
      return `job.delete:${patch.jobId}`;
    case "step.insert":
      // index + step content uniquely identify the insert operation.
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

/**
 * Replace any earlier patch with the same target before appending the
 * new one. Preserves order for unrelated patches.
 */
function dedupQueue(queue: IRPatch[], next: IRPatch): IRPatch[] {
  const target = patchTarget(next);
  const filtered = queue.filter((p) => patchTarget(p) !== target);
  filtered.push(next);
  return filtered;
}

/**
 * Update both the live `pendingPatches` slice and the keyed stash
 * entry for the active document. Bound-null documents (untitled tabs)
 * still get their queue tracked but never persist into the stash.
 */
function mirrorActiveQueue(
  s: WorkflowEditState,
  next: IRPatch[],
): Partial<WorkflowEditState> {
  if (s.boundDocumentId === null) {
    return { pendingPatches: next };
  }
  const stashed = { ...s.patchesByDocument };
  if (next.length === 0) {
    delete stashed[s.boundDocumentId];
  } else {
    stashed[s.boundDocumentId] = next;
  }
  return { pendingPatches: next, patchesByDocument: stashed };
}

export const useWorkflowEditStore = create<
  WorkflowEditState & WorkflowEditActions
>((set, get) => ({
  ...initialState,

  queuePatch: (patch) =>
    set((s) => {
      // Dedup patches that target the same node + path / key. Without
      // this, queueing patch A → B → A leaves the original A→B patch
      // in the queue, so Save persists the stale B even though the
      // user reverted to A in the UI (cross-validator audit: append-
      // only queue defeats revert). Replace any earlier patch with the
      // same target rather than appending another one.
      const next = dedupQueue(s.pendingPatches, patch);
      return mirrorActiveQueue(s, next);
    }),

  cancelPatchForTarget: (target) =>
    set((s) => {
      const t = patchTarget(target);
      const next = s.pendingPatches.filter((p) => patchTarget(p) !== t);
      if (next.length === s.pendingPatches.length) return {};
      return mirrorActiveQueue(s, next);
    }),

  clearPatches: () => set((s) => mirrorActiveQueue(s, [])),

  bindToDocument: (documentId) =>
    set((s) => {
      if (s.boundDocumentId === documentId) return {};
      // Stash the previous document's queue so the user's unsaved work
      // is preserved across tab switches. Restore the target document's
      // queue if we've seen it before; otherwise start fresh.
      const stashed: Record<string, IRPatch[]> = { ...s.patchesByDocument };
      if (s.boundDocumentId !== null) {
        if (s.pendingPatches.length === 0) {
          delete stashed[s.boundDocumentId];
        } else {
          stashed[s.boundDocumentId] = s.pendingPatches;
        }
      }
      const restored =
        documentId !== null ? stashed[documentId] ?? [] : [];
      return {
        boundDocumentId: documentId,
        pendingPatches: restored,
        patchesByDocument: stashed,
      };
    }),

  setPreserveYamlFormatting: (preserve) =>
    set({ preserveYamlFormatting: preserve }),

  applyAndSerialize: (originalYaml) => {
    const { pendingPatches, preserveYamlFormatting } = get();
    if (pendingPatches.length === 0) return originalYaml;

    // Defensive against malformed input: parseDocument tolerates most
    // YAML and surfaces problems via doc.errors[], but doc.toString()
    // throws on a doc with parse errors. The save path is user-facing —
    // surface the original verbatim instead of crashing the panel
    // (audit follow-up). Mutator no-ops on non-mapping shapes already
    // handle the next layer of robustness.
    try {
      const doc = parseAsCst(originalYaml);
      if (doc.errors.length > 0) return originalYaml;
      for (const patch of pendingPatches) applyPatch(doc, patch);

      if (resolvePreserve(preserveYamlFormatting)) return stringifyCst(doc);

      // "Reformat" path — round-trip through plain yaml.stringify. Loses
      // comments + custom formatting; intended for users who explicitly
      // want canonical output.
      return yamlStringify(doc.toJS({ maxAliasCount: -1 }), {
        ...WORKFLOW_YAML_STRINGIFY_OPTIONS,
      });
    } catch {
      return originalYaml;
    }
  },
}));

/** Selector: true when there are unsaved edits queued. */
export const selectWorkflowEditDirty = (
  s: WorkflowEditState,
): boolean => s.pendingPatches.length > 0;
