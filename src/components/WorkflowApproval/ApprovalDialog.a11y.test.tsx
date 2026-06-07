// RW-15 (L11) — a11y landmark + axe coverage
//
// ApprovalDialog is a modal: it must carry role="dialog", aria-modal, and an
// accessible name via aria-labelledby, and pass axe with no violations. This
// covers the "interactive dialog" surface called for by the a11y track.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { axe } from "vitest-axe";

const AXE_OPTS = { rules: { "color-contrast": { enabled: false } } };

const pending = {
  executionId: "exec-1",
  stepId: "step-1",
  summary: "claude:reviewer",
  model: "claude-opus",
  preview: "Review the diff for regressions.",
};

vi.mock("@/stores/workflowStore", () => {
  const useWorkflowStore = (selector?: (s: unknown) => unknown) => {
    const state = {
      approval: { pending },
      dismissApproval: vi.fn(),
    };
    return selector ? selector(state) : state;
  };
  useWorkflowStore.getState = () => ({
    approval: { pending },
    dismissApproval: vi.fn(),
  });
  return { useWorkflowStore };
});

vi.mock("@/hooks/useWorkflowExecution", () => ({
  useWorkflowExecution: () => ({ respondApproval: vi.fn() }),
}));

import { ApprovalDialog } from "./ApprovalDialog";

describe("ApprovalDialog — modal dialog a11y (RW-15 / L11)", () => {
  it("exposes a dialog with an accessible name", () => {
    render(<ApprovalDialog />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ApprovalDialog />);
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });
});
