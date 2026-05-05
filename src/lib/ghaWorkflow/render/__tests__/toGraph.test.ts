// WI-2.1 — render adapter tests.
//
// IR → @xyflow/react { nodes, edges } shape per plan §6 Phase 2.
// Pure data transformation; no DOM, no React.

import { describe, expect, it } from "vitest";
import type { JobIR, MatrixIR, WorkflowIR } from "../../types";
import { toGraph } from "../toGraph";

function ir(jobs: Partial<JobIR>[], extras: Partial<WorkflowIR> = {}): WorkflowIR {
  return {
    triggers: [],
    permissions: {},
    env: {},
    jobs: jobs.map((j, i) => ({
      id: j.id ?? `job-${i}`,
      needs: j.needs ?? [],
      steps: j.steps ?? [],
      position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      ...j,
    })),
    positions: {},
    diagnostics: [],
    ...extras,
  };
}

describe("toGraph", () => {
  it("returns empty nodes+edges for empty IR", () => {
    const g = toGraph(ir([]));
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("creates one node per job with custom type 'job'", () => {
    const g = toGraph(ir([{ id: "build" }, { id: "test" }]));
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes.every((n) => n.type === "job")).toBe(true);
  });

  it("uses job id as node id", () => {
    const g = toGraph(ir([{ id: "build" }, { id: "deploy" }]));
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["build", "deploy"]);
  });

  it("attaches the JobIR to node.data.job", () => {
    const g = toGraph(
      ir([{ id: "build", name: "Build it", runsOn: ["ubuntu-latest"] }]),
    );
    const data = g.nodes[0].data as { job: JobIR };
    expect(data.job.id).toBe("build");
    expect(data.job.name).toBe("Build it");
  });

  it("emits one edge per needs[] entry", () => {
    const g = toGraph(
      ir([
        { id: "build" },
        { id: "test", needs: ["build"] },
        { id: "deploy", needs: ["test"] },
      ]),
    );
    expect(g.edges).toHaveLength(2);
    expect(g.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "build", target: "test" }),
        expect.objectContaining({ source: "test", target: "deploy" }),
      ]),
    );
  });

  it("produces unique edge ids", () => {
    const g = toGraph(
      ir([
        { id: "a" },
        { id: "b" },
        { id: "c", needs: ["a", "b"] },
      ]),
    );
    const ids = g.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("omits edges to/from unknown jobs (parser surfaces a diagnostic instead)", () => {
    const g = toGraph(
      ir([{ id: "deploy", needs: ["nonexistent"] }]),
    );
    expect(g.edges).toEqual([]);
  });

  it("attaches matrix expansion count to node.data.matrixCount when static", () => {
    const matrix: MatrixIR = {
      dimensions: { os: ["a", "b"], node: [18, 20] },
    };
    const g = toGraph(
      ir([{ id: "build", strategy: { matrix } }]),
    );
    const data = g.nodes[0].data as { matrixCount?: number };
    expect(data.matrixCount).toBe(4);
  });

  it("marks dynamic matrix on node.data.matrixDynamic", () => {
    const matrix: MatrixIR = { dimensions: {}, dynamic: true };
    const g = toGraph(ir([{ id: "build", strategy: { matrix } }]));
    const data = g.nodes[0].data as { matrixDynamic?: boolean };
    expect(data.matrixDynamic).toBe(true);
  });

  it("flags reusable jobs via node.data.reusable", () => {
    const g = toGraph(
      ir([{ id: "call", uses: "./.github/workflows/foo.yml" }]),
    );
    const data = g.nodes[0].data as { reusable?: boolean };
    expect(data.reusable).toBe(true);
  });

  it("places nodes at deterministic initial positions (overridable via layout)", () => {
    const g = toGraph(
      ir([{ id: "a" }, { id: "b" }, { id: "c" }]),
    );
    // Just verify positions are present and are numbers; actual layout
    // values come from the layout step, not toGraph.
    for (const n of g.nodes) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
    }
  });

  it("preserves source range on node.data so click-to-jump works", () => {
    const g = toGraph(
      ir([
        {
          id: "build",
          position: { startLine: 7, startCol: 3, endLine: 12, endCol: 1 },
        },
      ]),
    );
    const data = g.nodes[0].data as { job: JobIR };
    expect(data.job.position.startLine).toBe(7);
  });
});
