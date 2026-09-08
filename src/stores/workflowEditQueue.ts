/**
 * The edit slice's queue algebra — pure functions over `EditSlice`.
 *
 * Purpose: `workflowStore.ts` is the store's WIRING; deciding what a patch
 * queue looks like after an operation is a separate concern with no Zustand in
 * it, and it had grown to the point of pushing that file past its size cap.
 * Everything here is a pure transformation: same input, same output, no reads
 * of any other store.
 *
 * The model: ONE document is bound at a time, its queue is `pendingPatches`,
 * and `patchesByDocument` mirrors it plus every other document's stash. The
 * mirror is the invariant the rest depends on — `patchesByDocument[bound]`
 * equals `pendingPatches` whenever that queue is non-empty, and the key is
 * absent when it is empty.
 *
 * @coordinates-with src/stores/workflowStore.ts — the only consumer
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — IRPatch
 * @module stores/workflowEditQueue
 */

import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";

/** The structured editor's patch queue: one bound document, the rest stashed. */
export interface EditSlice {
  pendingPatches: IRPatch[];
  preserveYamlFormatting: boolean | null;
  boundDocumentId: string | null;
  patchesByDocument: Record<string, IRPatch[]>;
}

/**
 * The identity a patch WRITES — two patches with the same target are the same
 * edit made twice, and only the later one survives the queue.
 */
export function patchTarget(patch: IRPatch): string {
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

/** Append `next`, dropping any earlier patch that writes the same target. */
export function dedupQueue(queue: IRPatch[], next: IRPatch): IRPatch[] {
  const target = patchTarget(next);
  const filtered = queue.filter((p) => patchTarget(p) !== target);
  filtered.push(next);
  return filtered;
}

/** Set the bound document's queue, keeping `patchesByDocument` in step with it. */
export function mirrorActiveQueue(slice: EditSlice, next: IRPatch[]): EditSlice {
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

/**
 * Bind `documentId`: stash the outgoing document's queue and restore the
 * incoming one. `null` when nothing changes, so the caller can no-op.
 *
 * The invariant this maintains is the module's: `patchesByDocument[bound]`
 * equals `pendingPatches` while that queue is non-empty, and the key is absent
 * when it is empty.
 */
export function bindEditDocument(slice: EditSlice, documentId: string | null): EditSlice | null {
  if (slice.boundDocumentId === documentId) return null;
  const stashed: Record<string, IRPatch[]> = { ...slice.patchesByDocument };
  if (slice.boundDocumentId !== null) {
    if (slice.pendingPatches.length === 0) delete stashed[slice.boundDocumentId];
    else stashed[slice.boundDocumentId] = slice.pendingPatches;
  }
  return {
    ...slice,
    boundDocumentId: documentId,
    pendingPatches: documentId !== null ? (stashed[documentId] ?? []) : [],
    patchesByDocument: stashed,
  };
}

/**
 * Carry `from`'s queue — and the binding, if it is `from`'s — to `to`.
 *
 * A Save As renames the document its patches belong to, and rebinding cannot
 * express that: binding STASHES the old id's queue and RESTORES the new id's,
 * so the edits end up filed under a name nothing will ever save (audit
 * 20260907, #292). It works whether or not `from` is bound, because the pane
 * whose file was renamed need not be the pane the user is typing in.
 *
 * `to`'s own queue keeps precedence and the moved patches follow it: a second
 * pane may already hold edits for that file, and dropping them would be the
 * same defect one document further along.
 *
 * Returns `null` when there is nothing to do, so the caller can no-op.
 */
export function renameEditDocument(slice: EditSlice, from: string, to: string): EditSlice | null {
  if (from === to) return null;
  const moving = slice.patchesByDocument[from];
  // Nothing to carry AND not the binding: no rename to perform.
  if (moving === undefined && slice.boundDocumentId !== from) return null;

  const stashed: Record<string, IRPatch[]> = { ...slice.patchesByDocument };
  delete stashed[from];
  const merged = [...(stashed[to] ?? []), ...(moving ?? [])];
  if (merged.length === 0) delete stashed[to];
  else stashed[to] = merged;

  const boundDocumentId = slice.boundDocumentId === from ? to : slice.boundDocumentId;
  return {
    ...slice,
    boundDocumentId,
    // `patchesByDocument[bound]` mirrors `pendingPatches`, so the bound
    // document's queue is read back rather than reconstructed.
    pendingPatches:
      boundDocumentId === null ? slice.pendingPatches : (stashed[boundDocumentId] ?? []),
    patchesByDocument: stashed,
  };
}
