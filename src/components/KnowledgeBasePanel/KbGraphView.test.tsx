// Coverage for the native KB relationship graph view (content-server Phase 5).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getKbGraph = vi.fn();
vi.mock("@/services/contentServer", () => ({
  getKbGraph: (...a: unknown[]) => getKbGraph(...a),
}));

// @xyflow/react is heavy + canvas-based; stub it to a marker that echoes counts.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) => (
    <div data-testid="react-flow" data-nodes={nodes.length} data-edges={edges.length} />
  ),
  Background: () => <div data-testid="rf-bg" />,
  Controls: () => <div data-testid="rf-controls" />,
}));
vi.mock("@xyflow/react/dist/style.css", () => ({}));

import { KbGraphView } from "./KbGraphView";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  getKbGraph.mockReset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

describe("KbGraphView", () => {
  it("shows the no-workspace message when there is no root", () => {
    useWorkspaceStore.setState({ rootPath: null });
    render(<KbGraphView />);
    expect(screen.getByText(/workspace/i)).toBeInTheDocument();
    expect(getKbGraph).not.toHaveBeenCalled();
  });

  it("renders the graph (nodes + edges) after a successful fetch", async () => {
    getKbGraph.mockResolvedValue({
      nodes: [
        { id: "a.md", type: "doc", label: "A" },
        { id: "b.md", type: "doc", label: "B" },
      ],
      edges: [{ from: "a.md", to: "b.md", kind: "wikiLink" }],
    });
    render(<KbGraphView />);
    const flow = await screen.findByTestId("react-flow");
    expect(getKbGraph).toHaveBeenCalledWith("/ws");
    expect(flow).toHaveAttribute("data-nodes", "2");
    expect(flow).toHaveAttribute("data-edges", "1");
  });

  it("shows an error when the fetch fails", async () => {
    getKbGraph.mockRejectedValue(new Error("boom"));
    render(<KbGraphView />);
    await waitFor(() => expect(screen.getByText(/couldn't load|error/i)).toBeInTheDocument());
  });

  it("shows a loading placeholder before the graph resolves", () => {
    getKbGraph.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<KbGraphView />);
    expect(container.querySelector(".kb-graph__loading")).not.toBeNull();
  });
});
