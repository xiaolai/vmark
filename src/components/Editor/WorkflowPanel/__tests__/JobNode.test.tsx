// WI-2.3 — JobNode behavior tests.
//
// Tests render the component in jsdom with a stub @xyflow/react env
// and exercise: label rendering, matrix badge, reusable badge,
// click-to-select, keyboard accessibility.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import type { JobNodeData } from "@/lib/ghaWorkflow/render/toGraph";
import { JobNode } from "../JobNode";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";

function makeNode(
  overrides: Partial<JobNodeData> = {},
  jobOverrides: Partial<JobNodeData["job"]> = {},
): Node<JobNodeData> {
  return {
    id: "build",
    type: "job",
    position: { x: 0, y: 0 },
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
    // 'if:' indicator dot has aria-label "conditional".
    expect(screen.getByLabelText(/conditional/i)).toBeDefined();
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
});
