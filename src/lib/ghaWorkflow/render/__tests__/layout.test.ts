// WI-2.2 — dagre layout tests.
//
// Pure layout function — assigns final x/y to nodes from toGraph().
// We don't pin exact coordinates (dagre may rebalance across versions);
// we test invariants: every node positioned, no overlaps for small
// graphs, parent above child for top-down layouts.

import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import type { JobNodeData } from "../toGraph";
import { applyLayout } from "../layout";

function buildNode(id: string): Node<JobNodeData> {
  return {
    id,
    type: "job",
    position: { x: 0, y: 0 },
    data: {
      job: {
        id,
        needs: [],
        steps: [],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    },
  };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target };
}

describe("applyLayout", () => {
  it("returns the input unchanged for empty graphs", () => {
    const out = applyLayout([], []);
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it("assigns positions to every node", () => {
    const nodes = ["a", "b", "c"].map(buildNode);
    const edges = [edge("a", "b"), edge("b", "c")];
    const out = applyLayout(nodes, edges);
    for (const n of out.nodes) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it("places parent above child in TD layout (b.needs a → a.y < b.y)", () => {
    const nodes = ["a", "b"].map(buildNode);
    const edges = [edge("a", "b")];
    const out = applyLayout(nodes, edges);
    const a = out.nodes.find((n) => n.id === "a")!;
    const b = out.nodes.find((n) => n.id === "b")!;
    expect(a.position.y).toBeLessThan(b.position.y);
  });

  it("avoids node overlap for fan-out graphs", () => {
    const nodes = ["root", "a", "b", "c"].map(buildNode);
    const edges = [
      edge("root", "a"),
      edge("root", "b"),
      edge("root", "c"),
    ];
    const out = applyLayout(nodes, edges);
    // The three children should all be at the same y (one rank below
    // root) but different x.
    const children = out.nodes.filter((n) =>
      ["a", "b", "c"].includes(n.id),
    );
    const xs = children.map((c) => c.position.x);
    expect(new Set(xs).size).toBe(3);
  });

  it("preserves node ids and edges identically", () => {
    const nodes = ["a", "b"].map(buildNode);
    const edges = [edge("a", "b")];
    const out = applyLayout(nodes, edges);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(out.edges).toEqual(edges);
  });

  it("handles disconnected components without throwing", () => {
    const nodes = ["a", "b", "c"].map(buildNode);
    const edges = [edge("a", "b")];
    // c is disconnected.
    const out = applyLayout(nodes, edges);
    expect(out.nodes).toHaveLength(3);
    expect(out.nodes.find((n) => n.id === "c")).toBeDefined();
  });

  it("supports LR direction (parent left of child)", () => {
    const nodes = ["a", "b"].map(buildNode);
    const edges = [edge("a", "b")];
    const out = applyLayout(nodes, edges, { direction: "LR" });
    const a = out.nodes.find((n) => n.id === "a")!;
    const b = out.nodes.find((n) => n.id === "b")!;
    expect(a.position.x).toBeLessThan(b.position.x);
  });

  it("respects nodeSize for spacing", () => {
    const nodes = ["a", "b", "c"].map(buildNode);
    const edges = [edge("a", "b"), edge("b", "c")];
    const small = applyLayout(nodes, edges, { nodeSize: { width: 100, height: 50 } });
    const large = applyLayout(nodes, edges, { nodeSize: { width: 300, height: 150 } });
    // Larger node sizes → larger total layout extent.
    const smallExtent = Math.max(...small.nodes.map((n) => n.position.y));
    const largeExtent = Math.max(...large.nodes.map((n) => n.position.y));
    expect(largeExtent).toBeGreaterThan(smallExtent);
  });
});
