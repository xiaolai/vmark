// RW-2 (L4) — ApprovalDialog behavior tests
/**
 * ApprovalDialog — behavior tests.
 *
 * Covers the user-visible contract of the workflow approval modal:
 * - Renders nothing when there is no pending approval.
 * - Renders the step summary / model / prompt preview when one is pending.
 * - Approve / Deny buttons call respondApproval with the right verdict and
 *   then dismiss the dialog.
 * - Escape denies (verdict = false) and dismisses.
 * - Exposes dialog ARIA semantics (role=dialog, aria-modal, labelled title).
 *
 * The execution hook is mocked so we assert the dialog wiring, not the
 * Tauri command. The real workflowStore drives `pending`.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { useWorkflowStore } from "@/stores/workflowStore";

const mockRespondApproval = vi.fn(() => Promise.resolve());

vi.mock("@/hooks/useWorkflowExecution", () => ({
  useWorkflowExecution: () => ({
    start: vi.fn(),
    cancel: vi.fn(),
    respondApproval: mockRespondApproval,
  }),
}));

const mockWorkflowError = vi.fn();

vi.mock("@/utils/debug", () => ({
  workflowError: (...args: unknown[]) => mockWorkflowError(...args),
}));

import { ApprovalDialog } from "./ApprovalDialog";

function enqueue(overrides?: Partial<{
  executionId: string;
  stepId: string;
  summary: string;
  preview: string;
  model: string | null;
}>) {
  useWorkflowStore.getState().enqueueApproval({
    executionId: "exec-1",
    stepId: "step-1",
    summary: "genie/translate",
    preview: "Translate the selection to French.",
    model: "claude-opus",
    ...overrides,
  });
}

describe("ApprovalDialog", () => {
  beforeEach(() => {
    useWorkflowStore.getState().resetApproval();
    mockRespondApproval.mockClear();
    mockRespondApproval.mockImplementation(() => Promise.resolve());
    mockWorkflowError.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("visibility", () => {
    it("renders nothing when there is no pending approval", () => {
      render(<ApprovalDialog />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders the dialog when an approval is pending", () => {
      enqueue();
      render(<ApprovalDialog />);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("content", () => {
    it("shows the step summary and prompt preview", () => {
      enqueue({ summary: "genie/summarize", preview: "Summarize this." });
      render(<ApprovalDialog />);
      expect(screen.getByText("genie/summarize")).toBeInTheDocument();
      expect(screen.getByText("Summarize this.")).toBeInTheDocument();
    });

    it("shows the resolved model when provided", () => {
      enqueue({ model: "gpt-5" });
      render(<ApprovalDialog />);
      expect(screen.getByText("gpt-5")).toBeInTheDocument();
    });

    it("omits the model row and shows a placeholder preview when fields are empty", () => {
      enqueue({ model: null, preview: "" });
      render(<ApprovalDialog />);
      // Empty preview falls back to the em-dash placeholder.
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("ARIA semantics", () => {
    it("is a labelled modal dialog", () => {
      enqueue();
      render(<ApprovalDialog />);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "approval-dialog-title");
      // The referenced title element must exist.
      expect(document.getElementById("approval-dialog-title")).toBeInTheDocument();
    });
  });

  describe("approve / deny", () => {
    it("Approve calls respondApproval(approved=true) then dismisses", async () => {
      enqueue({ executionId: "exec-9", stepId: "step-9" });
      render(<ApprovalDialog />);

      fireEvent.click(screen.getByRole("button", { name: /approve/i }));

      await waitFor(() => {
        expect(mockRespondApproval).toHaveBeenCalledWith("exec-9", "step-9", true);
      });
      await waitFor(() => {
        expect(useWorkflowStore.getState().approval.pending).toBeNull();
      });
    });

    it("Deny calls respondApproval(approved=false) then dismisses", async () => {
      enqueue({ executionId: "exec-2", stepId: "step-2" });
      render(<ApprovalDialog />);

      fireEvent.click(screen.getByRole("button", { name: /deny/i }));

      await waitFor(() => {
        expect(mockRespondApproval).toHaveBeenCalledWith("exec-2", "step-2", false);
      });
      await waitFor(() => {
        expect(useWorkflowStore.getState().approval.pending).toBeNull();
      });
    });

    // RW-2 (L4) — a rejecting IPC verdict must be caught and logged (fail
    // loud), not dropped as an unhandled rejection. The dialog still dismisses.
    it("logs and dismisses (no unhandled rejection) when respondApproval rejects", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);

      mockRespondApproval.mockRejectedValueOnce(new Error("IPC dropped"));
      enqueue({ executionId: "exec-fail", stepId: "step-fail" });
      render(<ApprovalDialog />);

      fireEvent.click(screen.getByRole("button", { name: /approve/i }));

      // The rejection is caught and routed through the workflow error logger.
      await waitFor(() => {
        expect(mockWorkflowError).toHaveBeenCalledWith(
          expect.stringContaining("Failed to respond to workflow approval"),
          expect.any(Error),
        );
      });
      // The dialog still dismisses on the failure path.
      await waitFor(() => {
        expect(useWorkflowStore.getState().approval.pending).toBeNull();
      });

      // Give any (mistaken) unhandled rejection a tick to surface.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      process.off("unhandledRejection", unhandled);
    });
  });

  describe("keyboard", () => {
    it("Escape denies (verdict=false) and dismisses", async () => {
      enqueue({ executionId: "exec-esc", stepId: "step-esc" });
      render(<ApprovalDialog />);

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(mockRespondApproval).toHaveBeenCalledWith(
          "exec-esc",
          "step-esc",
          false,
        );
      });
      await waitFor(() => {
        expect(useWorkflowStore.getState().approval.pending).toBeNull();
      });
    });
  });
});
