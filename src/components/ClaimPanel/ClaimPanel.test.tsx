// WI-2b.6 — claim panel: lifecycle acts with explicit confirmations,
// the extraction-driven create flow, and visibility toggling.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRefresh = vi.fn(() => Promise.resolve());
const mockAct = vi.fn(() => Promise.resolve(true));
const mockScope = vi.fn(() => Promise.resolve());
vi.mock("@/services/claims/claimService", () => ({
  refreshClaims: (...a: unknown[]) => mockRefresh(...a),
  performClaimAction: (...a: unknown[]) => mockAct(...a),
  scopeClaim: (...a: unknown[]) => mockScope(...a),
}));

import { ClaimPanel } from "./ClaimPanel";
import { useClaimStore, type ClaimRow } from "@/stores/claimStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function row(p: Partial<ClaimRow> & { claim: string }): ClaimRow {
  return {
    entryId: "e1",
    statement: "Elena is left-handed",
    maturity: "draft",
    invalidAt: null,
    visible: true,
    ...p,
  };
}

beforeEach(() => {
  mockRefresh.mockClear();
  mockAct.mockClear();
  mockScope.mockClear();
  useClaimStore.getState().reset();
  useWorkspaceStore.getState().openWorkspace("/ws");
});

describe("ClaimPanel", () => {
  it("refreshes on mount and shows the empty state", () => {
    render(<ClaimPanel />);
    expect(mockRefresh).toHaveBeenCalledWith("/ws");
    expect(screen.getByText(/no claims yet/i)).toBeInTheDocument();
  });

  it("Promote appears only on drafts and appends the act", async () => {
    const user = userEvent.setup();
    useClaimStore.getState().setRows([
      row({ claim: "c1" }),
      row({ claim: "c2", statement: "The harbor is open", maturity: "established" }),
    ]);
    render(<ClaimPanel />);
    const promotes = screen.getAllByRole("button", { name: /^promote$/i });
    expect(promotes).toHaveLength(1);
    await user.click(promotes[0]);
    expect(mockAct).toHaveBeenCalledWith("/ws", { action: "promote", claim: "c1" });
  });

  it("Correct requires a non-empty statement through the inline input", async () => {
    const user = userEvent.setup();
    useClaimStore.getState().setRows([row({ claim: "c1" })]);
    render(<ClaimPanel />);
    await user.click(screen.getByRole("button", { name: /^correct$/i }));
    const confirm = screen.getByRole("button", { name: /confirm correction/i });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/corrected statement/i), "Elena is ambidextrous");
    await user.click(confirm);
    expect(mockAct).toHaveBeenCalledWith("/ws", {
      action: "correct",
      claim: "c1",
      statement: "Elena is ambidextrous",
    });
  });

  it("Retire is disabled for already-ended claims", () => {
    useClaimStore.getState().setRows([
      row({ claim: "c1", invalidAt: "2026-07-10T00:00:00Z" }),
    ]);
    render(<ClaimPanel />);
    expect(screen.getByRole("button", { name: /^retire$/i })).toBeDisabled();
    expect(screen.getByText(/^ended$/i)).toBeInTheDocument();
  });

  it("visibility toggle scopes out and back (D2.4 reversible)", async () => {
    const user = userEvent.setup();
    useClaimStore.getState().setRows([row({ claim: "c1", visible: false })]);
    render(<ClaimPanel />);
    expect(screen.getByText(/hidden in this context/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^show$/i }));
    expect(mockScope).toHaveBeenCalledWith("/ws", "c1", true);
  });

  it("the extraction draft creates with provenance after the explicit accept", async () => {
    const user = userEvent.setup();
    useClaimStore.getState().setDraft("Her eyes were green", "notes/elena.md");
    render(<ClaimPanel />);
    expect(screen.getByText(/notes\/elena\.md/)).toBeInTheDocument();
    const input = screen.getByLabelText(/claim statement/i);
    expect(input).toHaveValue("Her eyes were green");
    await user.clear(input);
    await user.type(input, "Elena's eyes are green");
    await user.click(screen.getByRole("button", { name: /create draft claim/i }));
    expect(mockAct).toHaveBeenCalledWith("/ws", {
      action: "create",
      statement: "Elena's eyes are green",
      source_path: "notes/elena.md",
    });
  });
});
