/**
 * graphToFlow (Phase 5; grill H5) — convert the content server's relationship
 * graph JSON into `@xyflow/react` nodes + edges with a dagre layout. Pure +
 * testable; the KbGraphView renders the result.
 *
 * @module components/KnowledgeBasePanel/graphToFlow
 */

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

type KbEdgeKind = "link" | "wikiLink" | "tag" | "relation";

interface KbGraphNode {
  id: string;
  type: "doc" | "tag";
  label: string;
  title?: string;
  unresolved?: boolean;
}
interface KbGraphEdge {
  from: string;
  to: string;
  kind: KbEdgeKind;
  relationKey?: string;
  unresolved?: boolean;
}
export interface KbGraph {
  nodes: KbGraphNode[];
  edges: KbGraphEdge[];
}

const NODE_W = 160;
const NODE_H = 36;

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

/** Lay out the KB graph left-to-right with dagre; tag nodes get a distinct class. */
export function graphToFlow(graph: KbGraph): FlowGraph {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 60 });

  for (const n of graph.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  // Only edges between known nodes participate in layout.
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    if (ids.has(e.from) && ids.has(e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const nodes: Node[] = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    const className = [
      "kb-graph-node",
      `kb-graph-node--${n.type}`,
      n.unresolved ? "kb-graph-node--unresolved" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      id: n.id,
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
      data: { label: n.title ?? n.label },
      className,
    };
  });

  const edges: Edge[] = graph.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e, i) => ({
      id: `e${i}-${e.from}-${e.to}-${e.kind}`,
      source: e.from,
      target: e.to,
      className: `kb-graph-edge kb-graph-edge--${e.kind}`,
      animated: e.kind === "relation",
    }));

  return { nodes, edges };
}
