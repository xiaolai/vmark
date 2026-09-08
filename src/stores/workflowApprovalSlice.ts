/**
 * The approval slice's transitions — pure functions over `ApprovalSlice`.
 *
 * Split from `workflowStore.ts` alongside the preview and view slices
 * (audit #1001), which took that file back under the ~300-line rule.
 *
 * @coordinates-with src/stores/workflowStore.ts — the only consumer
 * @module stores/workflowApprovalSlice
 */

/** One step's approval request, as the runner emits it. */
export interface ApprovalRequestPayload {
  executionId: string;
  stepId: string;
  summary: string;
  preview: string;
  model?: string | null;
}

export interface ApprovalSlice {
  pending: ApprovalRequestPayload | null;
}

export const initialApproval: ApprovalSlice = {
  pending: null,
};

export function enqueue(req: ApprovalRequestPayload): ApprovalSlice {
  return { pending: req };
}

/**
 * Clear the pending approval; `only` scopes it to that request (audit #1009).
 *
 * The runner emits the NEXT step's approval-request while
 * `respond_workflow_approval` is still resolving — a different channel with no
 * ordering against the reply — so an unscoped dismiss after a verdict can wipe
 * a request the user never saw. Returns the slice unchanged when the scope does
 * not match, so the store can skip the write.
 */
export function dismiss(
  slice: ApprovalSlice,
  only?: { executionId: string; stepId: string },
): ApprovalSlice {
  const pending = slice.pending;
  if (only && (pending?.executionId !== only.executionId || pending.stepId !== only.stepId)) {
    return slice;
  }
  return { pending: null };
}
