/**
 * Workflow Auto-Layout Engine
 *
 * Purpose: Convert a WorkflowGraph into positioned React Flow nodes and edges
 * using dagre for automatic DAG layout.
 *
 * @coordinates-with types.ts — consumes WorkflowGraph
 * @coordinates-with WorkflowPreview.tsx — produces React Flow nodes/edges
 * @module lib/workflow/layout
 */

import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { WorkflowGraph } from "./types";

export interface WorkflowNodeData {
  label: string;
  icon: string;
  stepType: "genie" | "action" | "webhook";
  stepId: string;
  status?: "pending" | "running" | "success" | "error" | "skipped";
  duration?: number;
  error?: string;
  yamlLine?: number;
  [key: string]: unknown;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const HORIZONTAL_GAP = 60;
const VERTICAL_GAP = 40;

/**
 * Convert WorkflowGraph into React Flow nodes + edges with dagre layout.
 * Returns positioned nodes (x, y computed) and typed edges.
 */
export function layoutWorkflow(graph: WorkflowGraph): {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
} {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: VERTICAL_GAP,
    ranksep: HORIZONTAL_GAP,
    marginx: 20,
    marginy: 20,
  });

  // Add nodes
  for (const step of graph.steps) {
    g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Add edges
  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run layout
  dagre.layout(g);

  // Build React Flow nodes
  const nodes: Node<WorkflowNodeData>[] = graph.steps.map((step) => {
    const nodeData = g.node(step.id);
    return {
      id: step.id,
      type: "workflow",
      position: {
        x: nodeData.x - NODE_WIDTH / 2,
        y: nodeData.y - NODE_HEIGHT / 2,
      },
      data: {
        label: step.label,
        icon: step.icon,
        stepType: step.type,
        stepId: step.id,
        status: step.status,
        duration: step.duration,
        error: step.error,
        yamlLine: step.sourceRange?.startLine,
      },
    };
  });

  // Build React Flow edges
  const edges: Edge[] = graph.edges.map((edge, i) => ({
    id: `e-${edge.source}-${edge.target}-${i}`,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
  }));

  return { nodes, edges };
}
