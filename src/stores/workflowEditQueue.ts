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

type StepShift = Extract<IRPatch, { kind: "step.insert" | "step.delete" | "step.move" }>;
type StepEdit = Extract<IRPatch, { kind: "step.set" | "with.set" | "with.remove" }>;

/** A patch that renumbers a job's steps: every one is its own operation. */
function shiftsSteps(p: IRPatch): p is StepShift {
  return p.kind === "step.insert" || p.kind === "step.delete" || p.kind === "step.move";
}

/** A patch written against a step INDEX. */
function isStepEdit(p: IRPatch): p is StepEdit {
  return p.kind === "step.set" || p.kind === "with.set" || p.kind === "with.remove";
}

/**
 * Where the step at `index` (in the frame AFTER `shift`) stood before it, or
 * `null` when `shift` is the insert that created it. Indices are taken at face
 * value — the queue does not know the job's length, and the editor only ever
 * emits in-range ones.
 */
function indexBefore(shift: StepShift, index: number): number | null {
  switch (shift.kind) {
    case "step.insert":
      if (index === shift.index) return null;
      return index > shift.index ? index - 1 : index;
    case "step.delete":
      return index >= shift.stepIndex ? index + 1 : index;
    case "step.move": {
      const { fromIndex: from, toIndex: to } = shift;
      if (index === to) return from;
      if (from < to && index >= from && index < to) return index + 1;
      if (from > to && index > to && index <= from) return index - 1;
      return index;
    }
  }
}

/**
 * `queue` without every patch that writes `target`'s field — the ONE
 * target-removal rule `dedupQueue` and `cancelTarget` share.
 * A step edit is matched by step IDENTITY: walking back through
 * the queue, the target's index is carried through each renumbering of its
 * job, so an insert below it (which moves nothing) or a move there and back
 * is crossed, while an edit to a different step that merely shares today's
 * index is not. The walk stops at the insert that created the step.
 */
function withoutTarget(queue: readonly IRPatch[], target: IRPatch): IRPatch[] {
  if (!isStepEdit(target)) {
    const key = patchTarget(target);
    return queue.filter((p) => patchTarget(p) !== key);
  }
  const dropped = new Set<number>();
  let index: number | null = target.stepIndex;
  for (let i = queue.length - 1; i >= 0 && index !== null; i--) {
    const p = queue[i];
    if (shiftsSteps(p)) {
      if (p.jobId === target.jobId) index = indexBefore(p, index);
    } else if (patchTarget(p) === patchTarget({ ...target, stepIndex: index })) {
      dropped.add(i);
    }
  }
  return queue.filter((_, i) => !dropped.has(i));
}

/**
 * Append `next`, dropping any earlier patch that writes the same target
 * (WI-LX2.4). An insert, delete or move is never collapsed: two deletes at
 * index 0 delete two steps. A step edit replaces only an earlier edit to the
 * SAME step, followed through the queue's renumberings (`withoutTarget`).
 */
export function dedupQueue(queue: IRPatch[], next: IRPatch): IRPatch[] {
  if (shiftsSteps(next)) return [...queue, next];
  return [...withoutTarget(queue, next), next];
}

/**
 * Drop the queued edit(s) for `target` — what a field does when its value
 * returns to the original. Same step identity rule as `dedupQueue`. Same
 * array back when nothing matched.
 */
export function cancelTarget(queue: IRPatch[], target: IRPatch): IRPatch[] {
  const next = withoutTarget(queue, target);
  return next.length === queue.length ? queue : next;
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
 * so the edits end up filed under a name nothing will ever save. It works whether or not `from` is bound, because the pane
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
