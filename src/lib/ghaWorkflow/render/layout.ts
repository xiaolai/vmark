// WI-2.2 — dagre-based layout for the workflow DAG.
//
// Plan §6 Phase 2 + ADR-1. Pure transform: takes the nodes/edges from
// toGraph() and reassigns each node's position based on a dagre
// layered layout. ELK fallback for very large graphs is a follow-up
// (>50 nodes per plan); this file ships dagre only.

import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";
import type { JobNodeData } from "./toGraph";

export type LayoutDirection = "TD" | "LR" | "BT" | "RL";

export interface LayoutOptions {
  /** Layout direction. TD = top-down (default), LR = left-right. */
  direction?: LayoutDirection;
  /** Per-node bounding box used by the layout algorithm. */
  nodeSize?: { width: number; height: number };
  /** Spacing between sibling nodes within the same rank. */
  nodeSep?: number;
  /** Spacing between adjacent ranks. */
  rankSep?: number;
}

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 90;
const DEFAULT_NODE_SEP = 40;
const DEFAULT_RANK_SEP = 80;

export interface LayoutResult {
  nodes: Node<JobNodeData>[];
  edges: Edge[];
}

/**
 * Run dagre over (nodes, edges) and return a new array of nodes with
 * dagre-assigned positions. Edges are passed through unchanged.
 *
 * dagre returns a node's *center* coordinate; @xyflow/react expects
 * top-left, so we shift by half the node size. This matches the
 * convention used in xyflow's official dagre example.
 */
export function applyLayout(
  nodes: Node<JobNodeData>[],
  edges: Edge[],
  options: LayoutOptions = {},
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes, edges };
  }

  const direction = options.direction ?? "TD";
  const size = options.nodeSize ?? {
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
  };
  const nodeSep = options.nodeSep ?? DEFAULT_NODE_SEP;
  const rankSep = options.rankSep ?? DEFAULT_RANK_SEP;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSep,
    ranksep: rankSep,
    marginx: 20,
    marginy: 20,
  });

  for (const node of nodes) {
    g.setNode(node.id, {
      width: size.width,
      height: size.height,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const halfW = size.width / 2;
  const halfH = size.height / 2;
  const positionedNodes = nodes.map((n) => {
    const dn = g.node(n.id);
    if (!dn) return n;
    return {
      ...n,
      position: {
        x: dn.x - halfW,
        y: dn.y - halfH,
      },
    };
  });

  return { nodes: positionedNodes, edges };
}
