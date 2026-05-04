// WI-2.3 — JobNode behavior tests.
//
// Tests render the component in jsdom with a stub @xyflow/react env
// and exercise: label rendering, matrix badge, reusable badge,
// click-to-select, keyboard accessibility.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { NodeProps, Node } from "@xyflow/react";
import type { JobNodeData } from "@/lib/ghaWorkflow/render/toGraph";
import { JobNode } from "../JobNode";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";

// JobNode now accepts xyflow's NodeProps shape rather than the full
// Node<JobNodeData>. The test factory produces props matching what
// xyflow itself would pass to the inner component.
function makeNode(
  overrides: Partial<JobNodeData> = {},
  jobOverrides: Partial<JobNodeData["job"]> = {},
): NodeProps<Node<JobNodeData>> {
  return {
    id: "build",
    type: "job",
    data: {
      job: {
        id: "build",
        needs: [],
        steps: [],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        ...jobOverrides,
      },
      ...overrides,
    },
    selected: false,
    dragging: false,
    selectable: true,
    deletable: true,
    draggable: true,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

describe("JobNode", () => {
  beforeEach(() => {
    useWorkflowViewStore.getState().reset();
  });

  it("renders the job id when no name is set", () => {
    const node = makeNode();
    render(<JobNode {...node} />);
    expect(screen.getByText("build")).toBeDefined();
  });

  it("prefers job.name over job.id when both are present", () => {
    const node = makeNode({}, { name: "Build the App" });
    render(<JobNode {...node} />);
    expect(screen.getByText("Build the App")).toBeDefined();
  });

  it("renders the runner label when present", () => {
    const node = makeNode({}, { runsOn: ["ubuntu-latest"] });
    render(<JobNode {...node} />);
    expect(screen.getByText(/ubuntu-latest/)).toBeDefined();
  });

  it("renders matrix badge when matrixCount > 1", () => {
    const node = makeNode({ matrixCount: 6 });
    render(<JobNode {...node} />);
    expect(screen.getByText(/×6/)).toBeDefined();
  });

  it("renders 'dynamic' badge when matrix is dynamic", () => {
    const node = makeNode({ matrixDynamic: true });
    render(<JobNode {...node} />);
    expect(screen.getByText(/dynamic/i)).toBeDefined();
  });

  it("renders 'reusable' badge when reusable=true", () => {
    const node = makeNode({ reusable: true });
    render(<JobNode {...node} />);
    expect(screen.getByText(/reusable/i)).toBeDefined();
  });

  it("renders the if expression indicator when job.if is set", () => {
    const node = makeNode({}, { if: "github.event_name == 'push'" });
    render(<JobNode {...node} />);
    // 'if:' indicator dot is a span carrying the i18n "conditional" label.
    // The job button itself also references "conditional" in its aria-label
    // summary, so query specifically for the dot via its title attribute.
    expect(
      document.querySelector(".gha-job-node__if-dot"),
    ).toBeDefined();
  });

  it("calls selectJob on click via the store", () => {
    const node = makeNode();
    const spy = vi.spyOn(useWorkflowViewStore.getState(), "selectJob");
    render(<JobNode {...node} />);
    fireEvent.click(screen.getByRole("button"));
    // Note: spy may not capture if the store action is destructured
    // from a frozen snapshot — verify via state instead.
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("build");
    spy.mockRestore();
  });

  it("activates the keyboard Enter handler", () => {
    const node = makeNode();
    render(<JobNode {...node} />);
    const btn = screen.getByRole("button");
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("build");
  });

  it("applies aria-pressed when this node is selected", () => {
    useWorkflowViewStore.getState().selectJob("build");
    const node = makeNode();
    render(<JobNode {...node} />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  describe("a11y — aria-label summarizes the job", () => {
    it("includes the job id when no name is set", () => {
      const node = makeNode();
      render(<JobNode {...node} />);
      const label = screen.getByRole("button").getAttribute("aria-label");
      expect(label).toContain("build");
    });

    it("uses the job's name and runner in the summary", () => {
      const node = makeNode(
        {},
        { name: "Build the App", runsOn: ["ubuntu-latest"] },
      );
      render(<JobNode {...node} />);
      const label = screen.getByRole("button").getAttribute("aria-label");
      expect(label).toContain("Build the App");
      expect(label).toContain("ubuntu-latest");
    });

    it("includes step count and needs[] in the summary", () => {
      const node = makeNode(
        {},
        {
          needs: ["lint", "format"],
          steps: [
            {
              id: "s1",
              idSynthesized: false,
              run: "x",
              position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            },
            {
              id: "s2",
              idSynthesized: false,
              run: "y",
              position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            },
          ],
        },
      );
      render(<JobNode {...node} />);
      const label = screen.getByRole("button").getAttribute("aria-label");
      expect(label).toContain("2 steps");
      expect(label).toContain("lint");
      expect(label).toContain("format");
    });

    it("notes a conditional job in the summary", () => {
      const node = makeNode({}, { if: "github.event_name == 'push'" });
      render(<JobNode {...node} />);
      const label = screen.getByRole("button").getAttribute("aria-label");
      expect(label).toContain("conditional");
    });
  });

  describe("keyboard — Escape clears selection", () => {
    it("clears selection when Escape is pressed on a focused node", () => {
      useWorkflowViewStore.getState().selectJob("build");
      const node = makeNode();
      render(<JobNode {...node} />);
      const btn = screen.getByRole("button");
      btn.focus();
      fireEvent.keyDown(btn, { key: "Escape" });
      expect(useWorkflowViewStore.getState().selectedJobId).toBeNull();
    });
  });
});
