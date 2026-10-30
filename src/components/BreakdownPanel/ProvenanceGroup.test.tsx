/**
 * ProvenanceGroup — the pull-only "provenance unknown" section: it renders only
 * with candidates and a workspace, Suggest fetches a proposal whose inputs start
 * checked, and Confirm records exactly the inputs left checked — never none.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { ProvenanceGroup } from "./ProvenanceGroup";
import { useBreakdownStore } from "@/stores/breakdownStore";

const PROPOSAL = {
  head: "h1",
  inputs: [
    { path: "notes/a.md", role: "direct" },
    { path: "notes/b.md", role: "contextual" },
  ],
};

const callsTo = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) =>
    cmd === "coherence_propose_inputs" ? Promise.resolve(PROPOSAL) : Promise.resolve([]),
  );
  useBreakdownStore.getState().reset();
  useBreakdownStore.getState().setProvenance([{ path: "out/report.md", proposed: 2 }]);
});

describe("ProvenanceGroup", () => {
  it("renders nothing without candidates", () => {
    useBreakdownStore.getState().setProvenance([]);
    const { container } = render(<ProvenanceGroup workspaceRoot="/w" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a workspace", () => {
    const { container } = render(<ProvenanceGroup workspaceRoot={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each candidate with its recoverable-input hint and nothing proposed yet", () => {
    render(<ProvenanceGroup workspaceRoot="/w" />);
    expect(screen.getByText("Provenance unknown")).toBeInTheDocument();
    expect(screen.getByText("out/report.md")).toBeInTheDocument();
    expect(screen.getByText("2 prior input(s) recoverable")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(callsTo("coherence_propose_inputs")).toHaveLength(0);
  });

  it("Suggest proposes inputs for that artifact, all checked", async () => {
    const user = userEvent.setup();
    render(<ProvenanceGroup workspaceRoot="/w" />);
    await user.click(screen.getByRole("button", { name: "Suggest inputs" }));
    expect(callsTo("coherence_propose_inputs")).toEqual([
      ["coherence_propose_inputs", { workspaceRoot: "/w", path: "out/report.md" }],
    ]);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Suggest inputs" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Confirm records only the inputs left checked, then closes the proposal", async () => {
    const user = userEvent.setup();
    render(<ProvenanceGroup workspaceRoot="/w" />);
    await user.click(screen.getByRole("button", { name: "Suggest inputs" }));
    await user.click(screen.getAllByRole("checkbox")[1]);
    await user.click(screen.getByRole("button", { name: "Confirm provenance" }));
    await act(async () => {});
    const [[, args]] = callsTo("coherence_confirm_inputs");
    expect(args).toMatchObject({
      workspaceRoot: "/w",
      request: { path: "out/report.md", head: "h1", inputs: [{ path: "notes/a.md", role: "direct" }] },
    });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("Confirm is disabled once every input is unchecked", async () => {
    const user = userEvent.setup();
    render(<ProvenanceGroup workspaceRoot="/w" />);
    await user.click(screen.getByRole("button", { name: "Suggest inputs" }));
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    expect(screen.getByRole("button", { name: "Confirm provenance" })).toBeDisabled();
    expect(callsTo("coherence_confirm_inputs")).toHaveLength(0);
  });

  it("a failed proposal opens nothing and reports the error to the store", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "coherence_propose_inputs" ? Promise.reject(new Error("no head")) : Promise.resolve([]),
    );
    const user = userEvent.setup();
    render(<ProvenanceGroup workspaceRoot="/w" />);
    await user.click(screen.getByRole("button", { name: "Suggest inputs" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(useBreakdownStore.getState().error).toBeTruthy();
  });
});
