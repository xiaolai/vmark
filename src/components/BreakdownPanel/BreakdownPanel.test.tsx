// WI-1.9b — Breakdown panel: pull-based stale/diverged edge list with actions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRefresh = vi.fn(() => Promise.resolve());
const mockResolve = vi.fn(() => Promise.resolve());
const mockRevise = vi.fn(() => Promise.resolve());
const mockCheck = vi.fn(() => Promise.resolve());
const mockRefreshContexts = vi.fn(() => Promise.resolve());
const mockCreateContext = vi.fn(() => Promise.resolve());
const mockSetEnforcement = vi.fn(() => Promise.resolve());
const mockRefreshBranch = vi.fn(() => Promise.resolve());
const mockCreateFromBranch = vi.fn(() => Promise.resolve());
const mockRefreshMerge = vi.fn(() => Promise.resolve());
const mockRefreshProvenance = vi.fn(() => Promise.resolve());
const mockPropose = vi.fn(() =>
  Promise.resolve({
    head: "rev1:" + "c".repeat(64),
    inputs: [
      { path: "notes/elena.md", role: "direct" },
      { path: "notes/style.md", role: "contextual" },
    ],
  }),
);
const mockConfirm = vi.fn(() => Promise.resolve());
const mockRefreshDelegations = vi.fn(() => Promise.resolve());
const mockDelegate = vi.fn(() => Promise.resolve());
vi.mock("@/services/breakdown/breakdownService", () => ({
  refreshBreakdown: (...a: unknown[]) => mockRefresh(...a),
  resolveEdge: (...a: unknown[]) => mockResolve(...a),
  reviseEdge: (...a: unknown[]) => mockRevise(...a),
  checkEdge: (...a: unknown[]) => mockCheck(...a),
  refreshContexts: (...a: unknown[]) => mockRefreshContexts(...a),
  createContext: (...a: unknown[]) => mockCreateContext(...a),
  setContextEnforcement: (...a: unknown[]) => mockSetEnforcement(...a),
  refreshBranchCandidate: (...a: unknown[]) => mockRefreshBranch(...a),
  createContextFromBranch: (...a: unknown[]) => mockCreateFromBranch(...a),
  refreshMergeNotice: (...a: unknown[]) => mockRefreshMerge(...a),
}));
vi.mock("@/services/breakdown/semanticActs", () => ({
  refreshProvenance: (...a: unknown[]) => mockRefreshProvenance(...a),
  proposeInputs: (...a: unknown[]) => mockPropose(...a),
  confirmInputs: (...a: unknown[]) => mockConfirm(...a),
  refreshDelegations: (...a: unknown[]) => mockRefreshDelegations(...a),
  delegate: (...a: unknown[]) => mockDelegate(...a),
}));
const mockAsk = vi.fn(() => Promise.resolve(true));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...a: unknown[]) => mockAsk(...a),
}));

import { BreakdownPanel, RESULT_CAP } from "./BreakdownPanel";
import { useBreakdownStore, type EdgeRow } from "@/stores/breakdownStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function row(p: Partial<EdgeRow> & { txf: string }): EdgeRow {
  return {
    input: 0,
    upstream: "up-obj",
    upstream_path: "notes/source.md",
    pinned: "rev1:" + "a".repeat(64),
    downstream: "down-obj",
    downstream_path: "essays/derived.md",
    downstream_rev: "rev1:" + "b".repeat(64),
    state: "version-stale",
    prior_waivers: 0,
    ...p,
  };
}

beforeEach(() => {
  mockRefresh.mockClear();
  mockResolve.mockClear();
  mockRevise.mockClear();
  mockCheck.mockClear();
  mockRefreshContexts.mockClear();
  mockCreateContext.mockClear();
  mockSetEnforcement.mockClear();
  mockAsk.mockClear().mockResolvedValue(true);
  mockRefreshBranch.mockClear();
  mockCreateFromBranch.mockClear();
  mockRefreshMerge.mockClear();
  mockRefreshProvenance.mockClear();
  mockPropose.mockClear();
  mockConfirm.mockClear();
  mockRefreshDelegations.mockClear();
  mockDelegate.mockClear();
  localStorage.clear();
  useBreakdownStore.getState().reset();
  useBreakdownStore.getState().setPanelOpen(true);
  useWorkspaceStore.getState().openWorkspace("/ws");
});

describe("BreakdownPanel — refresh (pull-based)", () => {
  it("refreshes on mount with the workspace root", () => {
    render(<BreakdownPanel />);
    expect(mockRefresh).toHaveBeenCalledWith("/ws");
  });

  it("does not refresh when no workspace is open", () => {
    useWorkspaceStore.getState().closeWorkspace();
    render(<BreakdownPanel />);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("the refresh button pulls again", async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel />);
    mockRefresh.mockClear();
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(mockRefresh).toHaveBeenCalledWith("/ws");
  });

  it("the close button closes the panel", async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(useBreakdownStore.getState().panelOpen).toBe(false);
  });
});

describe("BreakdownPanel — states", () => {
  it("shows the loading state while a first fetch is in flight", () => {
    useBreakdownStore.getState().setLoading(true);
    render(<BreakdownPanel />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows the empty state when everything is coherent", () => {
    render(<BreakdownPanel />);
    expect(screen.getByText(/everything coherent/i)).toBeInTheDocument();
  });

  it("shows the error state with the failure detail, keeping old rows listed", () => {
    useBreakdownStore.getState().setRows([row({ txf: "t1" })]);
    useBreakdownStore.getState().setError("kernel poisoned");
    render(<BreakdownPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i);
    expect(screen.getByRole("alert")).toHaveTextContent("kernel poisoned");
    expect(screen.getByText("notes/source.md")).toBeInTheDocument();
    expect(screen.queryByText(/everything coherent/i)).toBeNull();
  });
});

describe("BreakdownPanel — grouped list", () => {
  it("groups edges under their downstream artifact with upstream + state badge", () => {
    useBreakdownStore.getState().setRows([
      row({ txf: "t1", input: 0, downstream_path: "essays/a.md" }),
      row({
        txf: "t1",
        input: 1,
        downstream_path: "essays/a.md",
        upstream_path: "notes/other.md",
        state: "diverged",
      }),
      row({ txf: "t2", downstream_path: "essays/b.md", state: "waived" }),
    ]);
    render(<BreakdownPanel />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["essays/a.md", "essays/b.md"]);
    expect(screen.getByText("notes/other.md")).toBeInTheDocument();
    expect(screen.getByText("Version stale")).toBeInTheDocument();
    expect(screen.getByText("Diverged")).toBeInTheDocument();
    expect(screen.getByText("Waived")).toBeInTheDocument();
  });

  it("falls back to the downstream object id when the path is unknown", () => {
    useBreakdownStore.getState().setRows([
      row({ txf: "t1", downstream: "0198-obj", downstream_path: null }),
    ]);
    render(<BreakdownPanel />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("0198-obj");
  });

  it("caps the listed rows and reports the shown/total count", () => {
    const many = Array.from({ length: RESULT_CAP + 5 }, (_, i) =>
      row({ txf: `t${i}`, downstream_path: `d/${i}.md` }),
    );
    useBreakdownStore.getState().setRows(many);
    render(<BreakdownPanel />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(RESULT_CAP);
    expect(
      screen.getByText(`Showing ${RESULT_CAP} of ${RESULT_CAP + 5} edges`),
    ).toBeInTheDocument();
  });
});

describe("BreakdownPanel — actions", () => {
  it("Accept newer appends a ratification for exactly that edge", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setRows([row({ txf: "t1", input: 3 })]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: "Accept newer" }));
    expect(mockResolve).toHaveBeenCalledWith("/ws", {
      action: "accept-newer",
      txf: "t1",
      input: 3,
    });
  });

  it("Revise opens the downstream artifact in the editor", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setRows([row({ txf: "t1" })]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: "Revise" }));
    expect(mockRevise).toHaveBeenCalledWith("/ws", "essays/derived.md");
  });

  it("Revise is disabled with an explanation when no downstream path is known", () => {
    useBreakdownStore.getState().setRows([row({ txf: "t1", downstream_path: null })]);
    render(<BreakdownPanel />);
    const revise = screen.getByRole("button", { name: "Revise" });
    expect(revise).toBeDisabled();
    expect(revise).toHaveAttribute("title", "No file path known for this artifact");
  });
});

describe("BreakdownPanel — waive flow", () => {
  it("opens an inline reason input; confirm stays disabled until a reason is typed", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setRows([row({ txf: "t1" })]);
    render(<BreakdownPanel />);
    expect(screen.queryByPlaceholderText(/reason/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Waive" }));
    const input = screen.getByPlaceholderText(/reason/i);
    const confirm = screen.getByRole("button", { name: /confirm waiver/i });
    expect(confirm).toBeDisabled();
    await user.type(input, "   ");
    expect(confirm).toBeDisabled(); // whitespace-only is not a reason
    await user.type(input, "intentionally stale");
    expect(confirm).toBeEnabled();
  });

  it("confirm appends a waiver with the trimmed reason and closes the input", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setRows([row({ txf: "t1", input: 1 })]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: "Waive" }));
    await user.type(screen.getByPlaceholderText(/reason/i), "  superseded by v2  ");
    await user.click(screen.getByRole("button", { name: /confirm waiver/i }));
    expect(mockResolve).toHaveBeenCalledWith("/ws", {
      action: "waive",
      txf: "t1",
      input: 1,
      reason: "superseded by v2",
    });
    expect(screen.queryByPlaceholderText(/reason/i)).toBeNull();
  });

  it("Enter in the reason input confirms the waiver", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setRows([row({ txf: "t1" })]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: "Waive" }));
    await user.type(screen.getByPlaceholderText(/reason/i), "known drift{Enter}");
    expect(mockResolve).toHaveBeenCalledWith("/ws", {
      action: "waive",
      txf: "t1",
      input: 0,
      reason: "known drift",
    });
  });
});

describe("BreakdownPanel — spec §9.2 disabled states", () => {
  it.each([
    {
      state: "diverged-multi-head" as const,
      tooltip: "Upstream has multiple live heads — revise or pin a head first",
    },
    {
      state: "unpinnable" as const,
      tooltip: "Upstream is not resolvable in this context",
    },
  ])("disables Accept newer and Waive for $state with a tooltip", ({ state, tooltip }) => {
    useBreakdownStore.getState().setRows([row({ txf: "t1", state })]);
    render(<BreakdownPanel />);
    const accept = screen.getByRole("button", { name: "Accept newer" });
    const waive = screen.getByRole("button", { name: "Waive" });
    expect(accept).toBeDisabled();
    expect(waive).toBeDisabled();
    expect(accept).toHaveAttribute("title", tooltip);
    expect(waive).toHaveAttribute("title", tooltip);
    // Revise stays available — it is the way OUT of a multi-head state.
    expect(screen.getByRole("button", { name: "Revise" })).toBeEnabled();
  });
});

describe("BreakdownRow — WI-2b.5 semantic-layer surface", () => {
  it("renders the previously-waived badge only when count > 0", () => {
    useBreakdownStore.getState().setRows([
      row({ txf: "t1", prior_waivers: 2 }),
      row({ txf: "t2", upstream_path: "notes/other.md" }),
    ]);
    render(<BreakdownPanel />);
    expect(screen.getByText(/previously waived ×2/i)).toBeInTheDocument();
    expect(screen.queryAllByText(/previously waived/i)).toHaveLength(1);
  });

  it("Check runs the pull-only semantic check for the edge", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setRows([row({ txf: "t1" })]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: /^check$/i }));
    expect(mockCheck).toHaveBeenCalledWith("/ws", "t1", 0);
  });

  it("Check is disabled for diverged-multi-head edges", () => {
    useBreakdownStore.getState().setRows([
      row({ txf: "t1", state: "diverged-multi-head" }),
    ]);
    render(<BreakdownPanel />);
    expect(screen.getByRole("button", { name: /^check$/i })).toBeDisabled();
  });

  it("waive without expiry omits the field; a date expiry becomes end-of-day UTC", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setRows([row({ txf: "t1" })]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: /^waive$/i }));
    await user.type(screen.getByLabelText(/reason/i), "narrow waiver");
    await user.click(screen.getByRole("button", { name: /confirm waiver/i }));
    expect(mockResolve).toHaveBeenCalledWith("/ws", {
      action: "waive",
      txf: "t1",
      input: 0,
      reason: "narrow waiver",
    });

    mockResolve.mockClear();
    await user.click(screen.getByRole("button", { name: /^waive$/i }));
    await user.type(screen.getByLabelText(/reason/i), "era-bound");
    await user.type(screen.getByLabelText(/expires/i), "2026-08-01");
    await user.click(screen.getByRole("button", { name: /confirm waiver/i }));
    expect(mockResolve).toHaveBeenCalledWith("/ws", {
      action: "waive",
      txf: "t1",
      input: 0,
      reason: "era-bound",
      expires: "2026-08-01T23:59:59Z",
    });
  });

  it("axis-2 states render their badges", () => {
    useBreakdownStore.getState().setRows([
      row({ txf: "t1", state: "stale-contradicted" }),
      row({ txf: "t2", upstream_path: "notes/b.md", state: "stale-valid" }),
      row({ txf: "t3", upstream_path: "notes/c.md", state: "stale-unknown" }),
    ]);
    render(<BreakdownPanel />);
    expect(screen.getByText("Stale — contradicted")).toBeInTheDocument();
    expect(screen.getByText("Stale — checked valid")).toBeInTheDocument();
    expect(screen.getByText("Stale — unchecked")).toBeInTheDocument();
  });
});

describe("BreakdownPanel — WI-2b.7 context bar", () => {
  const DEFAULT_ID = "00000000-0000-0000-0000-000000000000";
  const ctx = (p: Partial<import("@/stores/breakdownStore").ContextRow> & { id: string; name: string }) => ({
    parent: null,
    enforcement: "greenhouse" as const,
    visibleClaims: 0,
    errors: [],
    ...p,
  });

  it("loads contexts on mount and lists them in the picker", () => {
    useBreakdownStore.getState().setContexts([
      ctx({ id: DEFAULT_ID, name: "default" }),
      ctx({ id: "c-1", name: "night-arc" }),
    ]);
    render(<BreakdownPanel />);
    expect(mockRefreshContexts).toHaveBeenCalledWith("/ws");
    expect(screen.getByRole("option", { name: /night-arc/i })).toBeInTheDocument();
  });

  it("switching context re-pulls the breakdown", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setContexts([
      ctx({ id: DEFAULT_ID, name: "default" }),
      ctx({ id: "c-1", name: "night-arc" }),
    ]);
    render(<BreakdownPanel />);
    mockRefresh.mockClear();
    await user.selectOptions(screen.getByRole("combobox"), "c-1");
    expect(useBreakdownStore.getState().selectedContext).toBe("c-1");
    expect(mockRefresh).toHaveBeenCalledWith("/ws");
  });

  it("creating a context calls the service with the trimmed name", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setContexts([ctx({ id: DEFAULT_ID, name: "default" })]);
    render(<BreakdownPanel />);
    await user.type(screen.getByLabelText(/new context name/i), "  canon  {Enter}");
    expect(mockCreateContext).toHaveBeenCalledWith("/ws", "canon");
  });

  it("enforcing asks for explicit confirmation first (D4.3)", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setContexts([
      ctx({ id: DEFAULT_ID, name: "default" }),
      ctx({ id: "c-1", name: "canon" }),
    ]);
    useBreakdownStore.getState().setSelectedContext("c-1");
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: /^enforce$/i }));
    expect(mockAsk).toHaveBeenCalled();
    expect(mockSetEnforcement).toHaveBeenCalledWith("/ws", "c-1", true);

    // Declining the dialog must not record anything.
    mockSetEnforcement.mockClear();
    mockAsk.mockResolvedValueOnce(false);
    await user.click(screen.getByRole("button", { name: /^enforce$/i }));
    expect(mockSetEnforcement).not.toHaveBeenCalled();
  });

  it("no enforce button on the implicit default", () => {
    useBreakdownStore.getState().setContexts([ctx({ id: DEFAULT_ID, name: "default" })]);
    render(<BreakdownPanel />);
    expect(screen.queryByRole("button", { name: /^enforce$/i })).not.toBeInTheDocument();
  });
});

describe("BreakdownPanel — WI-3.2 provenance recovery", () => {
  it("renders candidates and the suggest→confirm flow", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setProvenance([
      { path: "essays/derived.md", proposed: 2 },
    ]);
    render(<BreakdownPanel />);
    expect(mockRefreshProvenance).toHaveBeenCalledWith("/ws");
    expect(screen.getByText(/provenance unknown/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /suggest inputs/i }));
    expect(mockPropose).toHaveBeenCalledWith("/ws", "essays/derived.md");
    // Both proposed inputs pre-checked; uncheck the contextual one.
    const group = screen.getByText(/provenance unknown/i).closest("section");
    const checkboxes = within(group as HTMLElement).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /confirm provenance/i }));
    expect(mockConfirm).toHaveBeenCalledWith(
      "/ws",
      "essays/derived.md",
      "rev1:" + "c".repeat(64),
      [{ path: "notes/elena.md", role: "direct" }],
    );
  });

  it("confirm is disabled when nothing is checked", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setProvenance([
      { path: "essays/derived.md", proposed: 2 },
    ]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: /suggest inputs/i }));
    const group2 = screen.getByText(/provenance unknown/i).closest("section");
    for (const box of within(group2 as HTMLElement).getAllByRole("checkbox")) {
      if ((box as HTMLInputElement).checked) await user.click(box);
    }
    expect(
      screen.getByRole("button", { name: /confirm provenance/i }),
    ).toBeDisabled();
  });

  it("no group renders without candidates", () => {
    render(<BreakdownPanel />);
    expect(screen.queryByText(/provenance unknown/i)).not.toBeInTheDocument();
  });
});

describe("BreakdownPanel — WI-3.4 delegations", () => {
  it("granting asks for explicit confirmation naming the terms", async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel />);
    expect(mockRefreshDelegations).toHaveBeenCalledWith("/ws");
    await user.type(screen.getByLabelText(/agent principal/i), "codex-cli");
    await user.click(screen.getByRole("button", { name: /^grant$/i }));
    expect(mockAsk).toHaveBeenCalled();
    expect(mockDelegate).toHaveBeenCalledWith(
      "/ws",
      expect.objectContaining({
        delegate: "codex-cli",
        scope: ["resolve.accept-newer"],
      }),
    );

    // Declining records nothing.
    mockDelegate.mockClear();
    mockAsk.mockResolvedValueOnce(false);
    await user.type(screen.getByLabelText(/agent principal/i), "another");
    await user.click(screen.getByRole("button", { name: /^grant$/i }));
    expect(mockDelegate).not.toHaveBeenCalled();
  });

  it("revoke targets the grant id", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setDelegations([
      {
        grant: "g-1",
        delegate: "codex-cli",
        scope: ["resolve.waive"],
        expires: "2026-07-26T00:00:00Z",
      },
    ]);
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: /^revoke$/i }));
    expect(mockDelegate).toHaveBeenCalledWith(
      "/ws",
      expect.objectContaining({ revoke: "g-1", scope: [] }),
    );
  });

  it("grant is disabled without a principal or scope", async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel />);
    expect(screen.getByRole("button", { name: /^grant$/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/agent principal/i), "codex-cli");
    await user.click(screen.getByRole("checkbox", { name: /accept newer/i }));
    expect(screen.getByRole("button", { name: /^grant$/i })).toBeDisabled();
  });

  it.each(["abc", "7days", "0", "-3", "999999", "1.5", ""])(
    "invalid days %j records nothing (audit D11)",
    async (bad) => {
      const user = userEvent.setup();
      render(<BreakdownPanel />);
      await user.type(screen.getByLabelText(/agent principal/i), "codex-cli");
      const daysInput = screen.getByLabelText(/^days$/i);
      await user.clear(daysInput);
      if (bad !== "") await user.type(daysInput, bad);
      await user.click(screen.getByRole("button", { name: /^grant$/i }));
      expect(mockDelegate).not.toHaveBeenCalled();
    },
  );

  it("a valid days value grants with the computed expiry (audit D11)", async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel />);
    await user.type(screen.getByLabelText(/agent principal/i), "codex-cli");
    const daysInput = screen.getByLabelText(/^days$/i);
    await user.clear(daysInput);
    await user.type(daysInput, "30");
    await user.click(screen.getByRole("button", { name: /^grant$/i }));
    expect(mockDelegate).toHaveBeenCalledWith(
      "/ws",
      expect.objectContaining({
        delegate: "codex-cli",
        expires: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });
});

describe("BreakdownPanel — WI-3.6 branch-context chip (pull-only)", () => {
  const DEFAULT_ID = "00000000-0000-0000-0000-000000000000";
  const ctx = (p: Partial<import("@/stores/breakdownStore").ContextRow> & { id: string; name: string }) => ({
    parent: null,
    enforcement: "greenhouse" as const,
    visibleClaims: 0,
    errors: [],
    ...p,
  });

  it("loads the candidate on mount", () => {
    render(<BreakdownPanel />);
    expect(mockRefreshBranch).toHaveBeenCalledWith("/ws");
  });

  it("offers switch (never auto-selects) for a mapped, unselected context", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setContexts([
      ctx({ id: DEFAULT_ID, name: "default" }),
      ctx({ id: "c-1", name: "night-arc" }),
    ]);
    useBreakdownStore.getState().setBranchCandidate({
      branch: "night-arc",
      context: "c-1",
      contextName: "night-arc",
      ambiguous: false,
    });
    render(<BreakdownPanel />);
    // Not auto-selected — still on the default.
    expect(useBreakdownStore.getState().selectedContext).toBeNull();
    mockRefresh.mockClear();
    await user.click(screen.getByRole("button", { name: /branch context available/i }));
    expect(useBreakdownStore.getState().selectedContext).toBe("c-1");
    expect(mockRefresh).toHaveBeenCalledWith("/ws");
  });

  it("offers create when the branch has no mapped context", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setBranchCandidate({
      branch: "night-arc",
      context: null,
      contextName: null,
      ambiguous: false,
    });
    render(<BreakdownPanel />);
    await user.click(screen.getByRole("button", { name: /create context for branch/i }));
    expect(mockCreateFromBranch).toHaveBeenCalledWith("/ws");
  });

  it("shows an ambiguity notice, no switch button", () => {
    useBreakdownStore.getState().setBranchCandidate({
      branch: "night-arc",
      context: null,
      contextName: null,
      ambiguous: true,
    });
    render(<BreakdownPanel />);
    expect(screen.getByText(/multiple contexts map branch/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /branch context available/i })).not.toBeInTheDocument();
  });

  it("no chip when there is no candidate", () => {
    render(<BreakdownPanel />);
    expect(screen.queryByText(/branch context/i)).not.toBeInTheDocument();
  });
});
