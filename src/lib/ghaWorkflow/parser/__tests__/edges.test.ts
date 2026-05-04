// WI-1.3 — edge-derivation tests for the GHA workflow IR.
//
// Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §4.1
//
// Edges are derived from JobIR.needs[]. Conventions:
//   - needs: [a, b]                  → edges a→this, b→this
//   - no needs                       → no incoming edges (NOT sequential)
//   - needs unknown id               → diagnostic GHA-NEEDS-001, edge omitted
//   - cycle                          → diagnostic GHA-NEEDS-002, edges retained,
//                                       cycle nodes flagged

import { describe, expect, it } from "vitest";
import type { JobIR } from "../../types";
import { deriveEdges, detectCycles } from "../edges";

function jobs(...ids: { id: string; needs?: string[] }[]): JobIR[] {
  return ids.map((j) => ({
    id: j.id,
    needs: j.needs ?? [],
    steps: [],
    position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
  }));
}

describe("deriveEdges", () => {
  it("returns no edges for a single job", () => {
    const result = deriveEdges(jobs({ id: "build" }));
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns no edges when no job has needs (parallel jobs)", () => {
    const result = deriveEdges(jobs({ id: "a" }, { id: "b" }, { id: "c" }));
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("derives a single edge from needs", () => {
    const result = deriveEdges(
      jobs({ id: "build" }, { id: "deploy", needs: ["build"] }),
    );
    expect(result.edges).toEqual([{ from: "build", to: "deploy" }]);
    expect(result.diagnostics).toEqual([]);
  });

  it("derives fan-in (multiple needs into one job)", () => {
    const result = deriveEdges(
      jobs(
        { id: "frontend" },
        { id: "backend" },
        { id: "deploy", needs: ["frontend", "backend"] },
      ),
    );
    expect(result.edges).toEqual([
      { from: "frontend", to: "deploy" },
      { from: "backend", to: "deploy" },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("derives fan-out (one job feeds many)", () => {
    const result = deriveEdges(
      jobs(
        { id: "build" },
        { id: "test", needs: ["build"] },
        { id: "lint", needs: ["build"] },
        { id: "deploy", needs: ["build"] },
      ),
    );
    expect(result.edges).toHaveLength(3);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { from: "build", to: "test" },
        { from: "build", to: "lint" },
        { from: "build", to: "deploy" },
      ]),
    );
  });

  it("derives a diamond (fan-out + fan-in)", () => {
    const result = deriveEdges(
      jobs(
        { id: "setup" },
        { id: "test", needs: ["setup"] },
        { id: "lint", needs: ["setup"] },
        { id: "deploy", needs: ["test", "lint"] },
      ),
    );
    expect(result.edges).toHaveLength(4);
  });

  it("flags an unknown needs reference and omits the edge", () => {
    const result = deriveEdges(
      jobs({ id: "deploy", needs: ["missing-job"] }),
    );
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("GHA-NEEDS-001");
    expect(result.diagnostics[0].context).toMatchObject({
      jobId: "deploy",
      ref: "missing-job",
    });
  });

  it("flags multiple unknown refs in the same needs list independently", () => {
    const result = deriveEdges(
      jobs({ id: "deploy", needs: ["missing1", "missing2"] }),
    );
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((d) => d.code === "GHA-NEEDS-001")).toBe(
      true,
    );
  });

  it("flags an unknown ref but keeps the valid one", () => {
    const result = deriveEdges(
      jobs(
        { id: "build" },
        { id: "deploy", needs: ["build", "missing-job"] },
      ),
    );
    expect(result.edges).toEqual([{ from: "build", to: "deploy" }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("GHA-NEEDS-001");
  });

  it("preserves edges from cycles and emits GHA-NEEDS-002", () => {
    // a → b → a
    const result = deriveEdges(
      jobs(
        { id: "a", needs: ["b"] },
        { id: "b", needs: ["a"] },
      ),
    );
    expect(result.edges).toHaveLength(2);
    const cycleDiags = result.diagnostics.filter(
      (d) => d.code === "GHA-NEEDS-002",
    );
    expect(cycleDiags.length).toBeGreaterThan(0);
  });

  it("detects a 3-node cycle", () => {
    const result = deriveEdges(
      jobs(
        { id: "a", needs: ["c"] },
        { id: "b", needs: ["a"] },
        { id: "c", needs: ["b"] },
      ),
    );
    expect(
      result.diagnostics.filter((d) => d.code === "GHA-NEEDS-002").length,
    ).toBeGreaterThan(0);
  });

  it("does not falsely flag a diamond as a cycle", () => {
    const result = deriveEdges(
      jobs(
        { id: "setup" },
        { id: "test", needs: ["setup"] },
        { id: "lint", needs: ["setup"] },
        { id: "deploy", needs: ["test", "lint"] },
      ),
    );
    expect(
      result.diagnostics.filter((d) => d.code === "GHA-NEEDS-002"),
    ).toEqual([]);
  });

  it("treats self-referential needs as a cycle", () => {
    const result = deriveEdges(
      jobs({ id: "a", needs: ["a"] }),
    );
    expect(
      result.diagnostics.some((d) => d.code === "GHA-NEEDS-002"),
    ).toBe(true);
  });
});

describe("detectCycles", () => {
  it("returns empty array for an acyclic graph", () => {
    const cycles = detectCycles([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
    expect(cycles).toEqual([]);
  });

  it("returns nodes involved in a 2-node cycle", () => {
    const cycles = detectCycles([
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ]);
    expect(new Set(cycles[0])).toEqual(new Set(["a", "b"]));
  });

  it("handles disjoint subgraphs (one cyclic, one not)", () => {
    const cycles = detectCycles([
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "x", to: "y" },
    ]);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(["a", "b"]));
    expect(cycles[0]).not.toContain("x");
  });
});
