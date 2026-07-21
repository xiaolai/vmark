// Workspace open-approval dialog (plan WI-2.1). The human half of the
// open_workspace consent model: renders the pending request and resolves it.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));

import { WorkspaceApprovalDialog } from "./WorkspaceApprovalDialog";
import { useWorkspaceApprovalStore } from "@/stores/workspaceApprovalStore";

function queue(id = "id1", path = "/Users/x/proj") {
  useWorkspaceApprovalStore.getState().requestApproval(id, path, "main", "c1");
}

beforeEach(() => {
  useWorkspaceApprovalStore.setState({ pending: [], oneShots: [] });
});

describe("WorkspaceApprovalDialog", () => {
  it("renders nothing when there is no pending request", () => {
    const { container } = render(<WorkspaceApprovalDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the pending folder path", () => {
    queue("id1", "/Users/x/proj");
    render(<WorkspaceApprovalDialog />);
    expect(screen.getByText(/\/Users\/x\/proj/)).toBeInTheDocument();
  });

  it("Approve mints the one-shot and clears the prompt", async () => {
    const user = userEvent.setup();
    queue();
    render(<WorkspaceApprovalDialog />);
    await user.click(screen.getByRole("button", { name: /approve/i }));

    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(0);
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  it("Deny clears the prompt and mints no one-shot", async () => {
    const user = userEvent.setup();
    queue();
    render(<WorkspaceApprovalDialog />);
    await user.click(screen.getByRole("button", { name: /deny/i }));

    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(0);
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("fails closed: Escape denies (no one-shot)", async () => {
    const user = userEvent.setup();
    queue();
    render(<WorkspaceApprovalDialog />);
    await user.keyboard("{Escape}");

    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(0);
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("fails closed: a backdrop click denies (no one-shot)", async () => {
    const user = userEvent.setup();
    queue();
    render(<WorkspaceApprovalDialog />);
    // Clicking the overlay backdrop (the dialog role element itself) dismisses.
    await user.click(screen.getByRole("dialog"));

    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(0);
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });
});
