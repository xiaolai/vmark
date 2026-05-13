import { describe, it, expect, beforeEach } from "vitest";
import {
  useWorkflowApprovalStore,
  type ApprovalRequestPayload,
} from "./workflowApprovalStore";

const sample: ApprovalRequestPayload = {
  executionId: "exec-1",
  stepId: "step-1",
  summary: "genie/translate",
  preview: "Translate this paragraph...",
  model: "claude-sonnet-4-6",
};

beforeEach(() => {
  useWorkflowApprovalStore.setState({ pending: null });
});

describe("workflowApprovalStore", () => {
  it("starts with pending=null", () => {
    expect(useWorkflowApprovalStore.getState().pending).toBeNull();
  });

  it("enqueue stores the payload", () => {
    useWorkflowApprovalStore.getState().enqueue(sample);
    expect(useWorkflowApprovalStore.getState().pending).toEqual(sample);
  });

  it("dismiss clears the pending request", () => {
    useWorkflowApprovalStore.getState().enqueue(sample);
    useWorkflowApprovalStore.getState().dismiss();
    expect(useWorkflowApprovalStore.getState().pending).toBeNull();
  });

  it("sequential enqueue replaces the previous pending request (latest wins)", () => {
    useWorkflowApprovalStore.getState().enqueue(sample);
    const second: ApprovalRequestPayload = {
      ...sample,
      executionId: "exec-2",
      stepId: "step-2",
      summary: "genie/audit",
    };
    useWorkflowApprovalStore.getState().enqueue(second);
    expect(useWorkflowApprovalStore.getState().pending).toEqual(second);
  });

  it("dismiss after dismiss is idempotent (no error, still null)", () => {
    useWorkflowApprovalStore.getState().dismiss();
    useWorkflowApprovalStore.getState().dismiss();
    expect(useWorkflowApprovalStore.getState().pending).toBeNull();
  });

  it("preserves model=null exactly as enqueued", () => {
    const withNullModel: ApprovalRequestPayload = { ...sample, model: null };
    useWorkflowApprovalStore.getState().enqueue(withNullModel);
    expect(useWorkflowApprovalStore.getState().pending?.model).toBeNull();
  });

  it("preserves model=undefined (omitted field) as undefined", () => {
    const withoutModel: ApprovalRequestPayload = {
      executionId: "exec-x",
      stepId: "step-x",
      summary: "summary",
      preview: "preview",
    };
    useWorkflowApprovalStore.getState().enqueue(withoutModel);
    expect(useWorkflowApprovalStore.getState().pending?.model).toBeUndefined();
  });
});
