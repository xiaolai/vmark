// WI-1.3 — edge derivation for the GHA workflow IR.
//
// Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §4.1
//
// Pure-function module — no parser dependency, just operates on already-
// parsed JobIR[]. Lifted out so the renderer-side can also call detectCycles
// on a hypothetical edge set without re-running parse.

import type { Diagnostic, JobIR } from "../types";

export interface JobEdge {
  from: string;
  to: string;
}

export interface DeriveEdgesResult {
  edges: JobEdge[];
  diagnostics: Diagnostic[];
}

/**
 * Derive the workflow's job-level DAG from JobIR.needs[].
 *
 * Returns:
 *   - `edges`: every (from, to) pair where `to.needs` includes `from.id`
 *     and `from.id` resolves to a known job. Cycle edges are *retained* so
 *     the renderer can still draw them (typically marked red).
 *   - `diagnostics`:
 *     - GHA-NEEDS-001 (error) for each `needs:` reference to an unknown id.
 *     - GHA-NEEDS-002 (error) for each cycle detected. One diagnostic per
 *       cycle, attached to the first lexicographic node in the cycle.
 */
export function deriveEdges(jobs: JobIR[]): DeriveEdgesResult {
  const ids = new Set(jobs.map((j) => j.id));
  const edges: JobEdge[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const job of jobs) {
    for (const ref of job.needs) {
      if (!ids.has(ref)) {
        diagnostics.push({
          severity: "error",
          code: "GHA-NEEDS-001",
          message: `Job "${job.id}" references unknown job "${ref}" in needs:`,
          position: job.position,
          context: { jobId: job.id, ref },
        });
        continue;
      }
      edges.push({ from: ref, to: job.id });
    }
  }

  // Cycle detection runs on the surviving edge set.
  const cycles = detectCycles(edges);
  for (const cycle of cycles) {
    // Pin diagnostic to the first node lexicographically — stable for tests.
    const anchor = [...cycle].sort()[0];
    const anchorJob = jobs.find((j) => j.id === anchor);
    diagnostics.push({
      severity: "error",
      code: "GHA-NEEDS-002",
      message: `Cycle in job dependency graph: ${cycle.join(" → ")} → ${cycle[0]}`,
      position: anchorJob?.position,
      context: { jobId: anchor, cycle: cycle.join(" → ") },
    });
  }

  return { edges, diagnostics };
}

/**
 * Find all simple cycles in a directed graph given as an edge list.
 * Returns one array of node ids per cycle (in traversal order).
 *
 * Implementation: Tarjan-style DFS with a path stack. Self-loops are
 * detected as 1-node cycles. Disjoint components are handled by starting
 * DFS from every unvisited node.
 */
export function detectCycles(edges: JobEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const cycles: string[][] = [];
  const cycleSig = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  function recordCycle(cycle: string[]): void {
    // Normalize to start at lexicographic min so identical cycles dedupe.
    const min = [...cycle].sort()[0];
    const idx = cycle.indexOf(min);
    const norm = [...cycle.slice(idx), ...cycle.slice(0, idx)];
    const sig = norm.join("→");
    if (!cycleSig.has(sig)) {
      cycleSig.add(sig);
      cycles.push(norm);
    }
  }

  function dfs(node: string): void {
    visiting.add(node);
    path.push(node);
    for (const next of adj.get(node) ?? []) {
      if (visiting.has(next)) {
        // Found cycle: extract path from `next` to current node.
        const start = path.indexOf(next);
        if (start >= 0) recordCycle(path.slice(start));
      } else if (!visited.has(next)) {
        dfs(next);
      }
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const n of nodes) {
    if (!visited.has(n)) dfs(n);
  }

  return cycles;
}
