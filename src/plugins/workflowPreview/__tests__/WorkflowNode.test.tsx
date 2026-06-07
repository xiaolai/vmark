// RW-2 (L4) — WorkflowNode behavior tests
/**
 * WorkflowNode — behavior tests.
 *
 * Covers the per-status rendering contract of a single workflow graph node:
 * - Always renders the icon + label and an accessible button role/label.
 * - status="running" shows a spinner; success/error show the right glyph.
 * - error status carries the error text as a tooltip (title).
 * - duration formats as ms below 1s and as seconds at/above 1s.
 * - the per-status CSS class is applied so the canvas can style it.
 *
 * The node uses React Flow's <Handle>, so it must render inside a
 * ReactFlowProvider context.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import { WorkflowNode, type WorkflowNodeType } from "../WorkflowNode";
import type { WorkflowNodeData } from "@/lib/workflow/layout";

function makeProps(
  data: Partial<WorkflowNodeData>,
  selected = false,
): NodeProps<WorkflowNodeType> {
  const fullData: WorkflowNodeData = {
    label: "Step A",
    icon: "🤖",
    stepType: "genie",
    stepId: "a",
    ...data,
  };
  // React Flow injects many props; the component only reads `data` + `selected`.
  return {
    id: fullData.stepId,
    data: fullData,
    selected,
    type: "workflow",
    dragging: false,
    zIndex: 0,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  } as unknown as NodeProps<WorkflowNodeType>;
}

function renderNode(
  data: Partial<WorkflowNodeData>,
  selected = false,
): HTMLElement {
  render(
    <ReactFlowProvider>
      <WorkflowNode {...makeProps(data, selected)} />
    </ReactFlowProvider>,
  );
  return screen.getByRole("button");
}

describe("WorkflowNode", () => {
  describe("base rendering", () => {
    it("renders icon and label", () => {
      renderNode({ label: "Translate", icon: "🌐" });
      expect(screen.getByText("Translate")).toBeInTheDocument();
      expect(screen.getByText("🌐")).toBeInTheDocument();
    });

    it("exposes an accessible button label combining label and step type", () => {
      const node = renderNode({ label: "Translate", stepType: "genie" });
      expect(node).toHaveAttribute("aria-label", "Translate (genie)");
    });

    it("applies the selected class when selected", () => {
      const node = renderNode({ label: "Pick me" }, true);
      expect(node).toHaveClass("workflow-node--selected");
    });
  });

  describe("status indicators", () => {
    it("running status renders a spinner and the running status class", () => {
      const node = renderNode({ status: "running" });
      expect(node).toHaveClass("workflow-node--running");
      expect(node.querySelector(".workflow-node__spinner")).toBeInTheDocument();
    });

    it("success status renders the check glyph", () => {
      const node = renderNode({ status: "success" });
      expect(node).toHaveClass("workflow-node--success");
      expect(screen.getByText("✓")).toBeInTheDocument();
    });

    it("error status renders the cross glyph with the error as a tooltip", () => {
      const node = renderNode({ status: "error", error: "boom" });
      expect(node).toHaveClass("workflow-node--error");
      const glyph = screen.getByText("✗");
      expect(glyph).toBeInTheDocument();
      expect(glyph).toHaveAttribute("title", "boom");
    });

    it("renders no status glyph when status is absent", () => {
      const node = renderNode({});
      expect(node.querySelector(".workflow-node__spinner")).not.toBeInTheDocument();
      expect(node.querySelector(".workflow-node__status-icon")).not.toBeInTheDocument();
    });
  });

  describe("duration formatting", () => {
    it("formats sub-second durations in milliseconds", () => {
      renderNode({ duration: 250 });
      expect(screen.getByText("250ms")).toBeInTheDocument();
    });

    it("formats durations at or above 1s in seconds with one decimal", () => {
      renderNode({ duration: 1500 });
      expect(screen.getByText("1.5s")).toBeInTheDocument();
    });

    it("renders a zero-ms duration (0 is a real value, not absent)", () => {
      renderNode({ duration: 0 });
      expect(screen.getByText("0ms")).toBeInTheDocument();
    });

    it("renders no duration element when duration is absent", () => {
      const node = renderNode({});
      expect(node.querySelector(".workflow-node__duration")).not.toBeInTheDocument();
    });
  });
});
