// WI-2.1 — IR → @xyflow/react graph adapter.
//
// Plan §6 Phase 2. Pure function — no React, no DOM. The actual layout
// step (assigning final x/y coordinates) lives in ./layout.ts and runs
// AFTER toGraph(). toGraph() seeds initial positions to a simple grid
// so a missing layout call still produces a non-overlapping render.

import type { Edge, Node } from "@xyflow/react";
import type { JobIR, WorkflowIR } from "../types";
import { expandMatrix } from "../parser/matrix";

/** Node `data` payload for the custom 'job' node type. */
export interface JobNodeData extends Record<string, unknown> {
  /** Full JobIR — drives label, click-to-jump, and tooltips. */
  job: JobIR;
  /** Combination count when the matrix is statically expandable. */
  matrixCount?: number;
  /** True if the matrix uses an expression (cannot statically expand). */
  matrixDynamic?: boolean;
  /** True for reusable-workflow jobs (`uses:` at job level). */
  reusable?: boolean;
}

export interface WorkflowGraph {
  nodes: Node<JobNodeData>[];
  edges: Edge[];
}

const COLS = 3;
const COL_GAP = 240;
const ROW_GAP = 140;

/**
 * Convert a parsed WorkflowIR into the `{ nodes, edges }` shape that
 * `<ReactFlow>` consumes. One node per job, edges from `needs[]`.
 *
 * Edges referencing unknown jobs are silently dropped — the parser
 * already surfaced a `GHA-NEEDS-001` diagnostic when those refs were
 * encountered, and rendering a phantom edge would just confuse users.
 */
export function toGraph(workflow: WorkflowIR): WorkflowGraph {
  const known = new Set(workflow.jobs.map((j) => j.id));
  const nodes: Node<JobNodeData>[] = workflow.jobs.map((job, i) => ({
    id: job.id,
    type: "job",
    position: initialPosition(i),
    data: buildData(job),
  }));

  const edges: Edge[] = [];
  for (const job of workflow.jobs) {
    for (const ref of job.needs) {
      if (!known.has(ref)) continue;
      edges.push({
        id: `${ref}->${job.id}`,
        source: ref,
        target: job.id,
        type: "smoothstep",
      });
    }
  }

  return { nodes, edges };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function initialPosition(index: number): { x: number; y: number } {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return { x: col * COL_GAP, y: row * ROW_GAP };
}

function buildData(job: JobIR): JobNodeData {
  const data: JobNodeData = { job };
  if (job.uses) data.reusable = true;
  if (job.strategy?.matrix) {
    const expansion = expandMatrix(job.strategy.matrix);
    if (expansion.dynamic) data.matrixDynamic = true;
    else if (expansion.combinations.length > 1) {
      data.matrixCount = expansion.combinations.length;
    }
  }
  return data;
}
