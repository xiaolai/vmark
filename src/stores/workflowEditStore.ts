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

interface WorkflowEditState {
  /** Pending patches in queue order. Empty = clean. */
  pendingPatches: IRPatch[];
  /** When true, save path runs through the CST mutator (ADR-11 gate). */
  preserveYamlFormatting: boolean;
}

interface WorkflowEditActions {
  queuePatch: (patch: IRPatch) => void;
  clearPatches: () => void;
  setPreserveYamlFormatting: (preserve: boolean) => void;
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
  preserveYamlFormatting: true,
};

export const useWorkflowEditStore = create<
  WorkflowEditState & WorkflowEditActions
>((set, get) => ({
  ...initialState,

  queuePatch: (patch) =>
    set((s) => ({ pendingPatches: [...s.pendingPatches, patch] })),

  clearPatches: () => set({ pendingPatches: [] }),

  setPreserveYamlFormatting: (preserve) =>
    set({ preserveYamlFormatting: preserve }),

  applyAndSerialize: (originalYaml) => {
    const { pendingPatches, preserveYamlFormatting } = get();
    if (pendingPatches.length === 0) return originalYaml;

    const doc = parseAsCst(originalYaml);
    for (const patch of pendingPatches) applyPatch(doc, patch);

    if (preserveYamlFormatting) return stringifyCst(doc);

    // "Reformat" path — round-trip through plain yaml.stringify. Loses
    // comments + custom formatting; intended for users who explicitly
    // want canonical output.
    return yamlStringify(doc.toJS({ maxAliasCount: -1 }), {
      ...WORKFLOW_YAML_STRINGIFY_OPTIONS,
    });
  },
}));

/** Selector: true when there are unsaved edits queued. */
export const selectWorkflowEditDirty = (
  s: WorkflowEditState,
): boolean => s.pendingPatches.length > 0;
