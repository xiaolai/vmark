// WI-1.9b — Breakdown panel: pull-based stale/diverged edge list with actions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRefresh = vi.fn(() => Promise.resolve());
const mockResolve = vi.fn(() => Promise.resolve());
const mockRevise = vi.fn(() => Promise.resolve());
const mockCheck = vi.fn(() => Promise.resolve());
vi.mock("@/services/breakdown/breakdownService", () => ({
  refreshBreakdown: (...a: unknown[]) => mockRefresh(...a),
  resolveEdge: (...a: unknown[]) => mockResolve(...a),
  reviseEdge: (...a: unknown[]) => mockRevise(...a),
  checkEdge: (...a: unknown[]) => mockCheck(...a),
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
