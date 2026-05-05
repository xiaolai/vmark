/**
 * Workflow Approval Store
 *
 * Purpose: Holds the queue of pending approval requests emitted by the
 * Rust workflow runner via `workflow:approval-request`. The
 * ApprovalDialog component reads from this store; user's verdict goes
 * back to Rust via `respond_workflow_approval` and then `dismiss()`.
 *
 * @coordinates-with useWorkflowExecution.ts — writes via enqueue()
 * @coordinates-with components/WorkflowApproval/ApprovalDialog.tsx — reads
 * @module stores/workflowApprovalStore
 */

import { create } from "zustand";

export interface ApprovalRequestPayload {
  executionId: string;
  stepId: string;
  /** Short summary, typically `genie/<name>`. */
  summary: string;
  /** First 500 chars of the filled prompt. */
  preview: string;
  /** Effective model name resolved by ADR-6 precedence. */
  model?: string | null;
}

interface WorkflowApprovalState {
  pending: ApprovalRequestPayload | null;
  enqueue: (req: ApprovalRequestPayload) => void;
  dismiss: () => void;
}

export const useWorkflowApprovalStore = create<WorkflowApprovalState>((set) => ({
  pending: null,
  enqueue: (req) => set({ pending: req }),
  dismiss: () => set({ pending: null }),
}));
