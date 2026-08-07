// @vitest-environment node
// WI-21 — WorkflowPreview live-status overlay behavior tests.
/**
 * WorkflowPreview — behavior tests for `applyStepStatuses`.
 *
 * `layoutWorkflow` produces the static node data (label, icon, step id, and
 * whatever execution facts the parsed graph already carried). The component
 * then merges `stepStatuses` — the LIVE execution feed — over that data, and
 * marks the active node selected, before handing nodes to React Flow. That
 * merge is the only logic in this file and it had no test; it lived inline in
 * a `useMemo`, where reaching it meant rendering the whole React Flow canvas.
 *
 * What is pinned here:
 * - a live status replaces the layout-time status,
 * - a live entry reporting no duration/error does not leave a stale one behind,
 * - identity fields (label, icon, step id, yamlLine) survive the merge,
 * - a step with no live entry keeps its layout-time data untouched,
 * - the active step is the only one marked selected,
 * - the caller's node array and node data objects are not mutated.
 */
import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";

import { applyStepStatuses } from "../WorkflowPreview";
import type { WorkflowNodeData } from "@/lib/workflow/layout";

function node(
  id: string,
  data: Partial<WorkflowNodeData> = {},
): Node<WorkflowNodeData> {
  return {
    id,
    type: "workflow",
    position: { x: 0, y: 0 },
    data: {
      label: `Step ${id.toUpperCase()}`,
      icon: "🤖",
      stepType: "genie",
      stepId: id,
      ...data,
    },
  };
}

describe("applyStepStatuses", () => {
  it("replaces the layout-time status with the live one", () => {
    const [a] = applyStepStatuses([node("a", { status: "pending" })], null, {
      a: { status: "running" },
    });
    expect(a.data.status).toBe("running");
  });

  it("does not leave a stale duration behind when the live entry reports none", () => {
    const [a] = applyStepStatuses(
      [node("a", { status: "success", duration: 1500 })],
      null,
      { a: { status: "running" } },
    );
    expect(a.data.duration).toBeUndefined();
  });

  it("does not leave a stale error behind when the live entry reports none", () => {
    const [a] = applyStepStatuses(
      [node("a", { status: "error", error: "boom" })],
      null,
      { a: { status: "success" } },
    );
    expect(a.data.error).toBeUndefined();
  });

  it("carries the live duration and error through", () => {
    const [a] = applyStepStatuses([node("a")], null, {
      a: { status: "error", duration: 42, error: "boom" },
    });
    expect(a.data.duration).toBe(42);
    expect(a.data.error).toBe("boom");
  });

  it("keeps identity fields across the merge", () => {
    const [a] = applyStepStatuses(
      [node("a", { yamlLine: 7 })],
      null,
      { a: { status: "success" } },
    );
    expect(a.data.label).toBe("Step A");
    expect(a.data.icon).toBe("🤖");
    expect(a.data.stepId).toBe("a");
    expect(a.data.yamlLine).toBe(7);
  });

  it("leaves a step with no live entry on its layout-time data", () => {
    const [a] = applyStepStatuses(
      [node("a", { status: "success", duration: 250 })],
      null,
      {},
    );
    expect(a.data.status).toBe("success");
    expect(a.data.duration).toBe(250);
  });

  it("leaves every step untouched when no status feed is supplied", () => {
    const [a] = applyStepStatuses(
      [node("a", { status: "success", duration: 250 })],
      null,
      undefined,
    );
    expect(a.data.status).toBe("success");
    expect(a.data.duration).toBe(250);
  });

  it("marks only the active step selected", () => {
    const [a, b] = applyStepStatuses([node("a"), node("b")], "b", undefined);
    expect(a.selected).toBeFalsy();
    expect(b.selected).toBe(true);
  });

  it("selects nothing when there is no active step", () => {
    const [a] = applyStepStatuses([node("a")], null, undefined);
    expect(a.selected).toBeFalsy();
  });

  it("does not mutate the caller's nodes", () => {
    const input = [node("a", { status: "pending", duration: 1500 })];
    const original = input[0].data;
    applyStepStatuses(input, "a", { a: { status: "running" } });
    expect(original.status).toBe("pending");
    expect(original.duration).toBe(1500);
    expect(input[0].selected).toBeUndefined();
  });

  it("returns an empty list for an empty graph", () => {
    expect(applyStepStatuses([], "a", { a: { status: "running" } })).toEqual([]);
  });

  it("ignores a status entry for a step that is not on the canvas", () => {
    const result = applyStepStatuses([node("a")], null, {
      ghost: { status: "error", error: "boom" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].data.error).toBeUndefined();
  });
});
