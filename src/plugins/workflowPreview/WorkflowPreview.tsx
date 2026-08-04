/**
 * Workflow Preview React Flow Canvas
 *
 * Purpose: Self-contained React Flow canvas for rendering a WorkflowGraph.
 * Used inside the WorkflowSidePanel for standalone .yml files.
 *
 * @coordinates-with layout.ts — converts graph to positioned nodes/edges
 * @coordinates-with WorkflowNode.tsx — custom node renderer
 * @module plugins/workflowPreview/WorkflowPreview
 */

import { useMemo, useEffect, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import type { Node, NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WorkflowNode } from "./WorkflowNode";
import { layoutWorkflow, type WorkflowNodeData } from "@/lib/workflow/layout";
import type { WorkflowGraph } from "@/lib/workflow/types";
import "./workflow-preview.css";

const nodeTypes = { workflow: WorkflowNode };

import type { StepStatusEntry } from "@/lib/workflow/types";

interface WorkflowPreviewProps {
  graph: WorkflowGraph;
  activeStepId?: string | null;
  /** Live execution status keyed by step id (WI-4.3). Optional — when omitted,
   * nodes show static layout-time data only. */
  stepStatuses?: Record<string, StepStatusEntry>;
  onNodeClick?: (stepId: string, yamlLine?: number) => void;
}

/**
 * Overlay the LIVE execution feed onto layout-time node data and mark the
 * active node selected. Pure and exported so the merge is testable without
 * standing up a React Flow canvas.
 *
 * `duration` and `error` are spread CONDITIONALLY rather than assigned: a live
 * entry that reports neither means "this step has no duration/error right now",
 * which is the absence of the key, not a stated `undefined`. Writing the keys
 * unconditionally left a step that went `success (1.5s)` → `running` carrying
 * `duration: undefined` — the same thing to a truthiness reader, but a claim
 * the feed never made.
 */
export function applyStepStatuses(
  nodes: readonly Node<WorkflowNodeData>[],
  activeStepId: string | null | undefined,
  stepStatuses: Record<string, StepStatusEntry> | undefined,
): Node<WorkflowNodeData>[] {
  return nodes.map((n) => {
    const next: Node<WorkflowNodeData> = { ...n };
    if (activeStepId && n.id === activeStepId) {
      next.selected = true;
    }
    const status = stepStatuses?.[n.id];
    if (status) {
      // Drop the layout-time duration/error first: the live entry is the whole
      // truth about this step's execution, so a fact it does not report must
      // not survive from the previous one.
      const { duration: _duration, error: _error, ...identity } = n.data;
      next.data = {
        ...identity,
        status: status.status,
        ...(status.duration !== undefined ? { duration: status.duration } : {}),
        ...(status.error !== undefined ? { error: status.error } : {}),
      };
    }
    return next;
  });
}

function WorkflowPreviewInner({
  graph,
  activeStepId,
  stepStatuses,
  onNodeClick,
}: WorkflowPreviewProps) {
  const { fitView } = useReactFlow();

  // Heavy: dagre layout — only re-runs when the graph's topology changes.
  // Status overlays / active highlighting happen in a cheaper second pass.
  const layoutResult = useMemo(() => layoutWorkflow(graph), [graph]);

  const { nodes, edges } = useMemo(
    () => ({
      nodes: applyStepStatuses(layoutResult.nodes, activeStepId, stepStatuses),
      edges: layoutResult.edges,
    }),
    [layoutResult, activeStepId, stepStatuses],
  );

  // Fit view only on graph topology change (not on activeStepId selection changes)
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.1 }), 50);
    return () => clearTimeout(timer);
  }, [graph, fitView]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as WorkflowNodeData;
      onNodeClick?.(data.stepId, data.yamlLine);
    },
    [onNodeClick],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.25}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
    >
      <Background gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function WorkflowPreview(props: WorkflowPreviewProps) {
  return (
    <ReactFlowProvider>
      <WorkflowPreviewInner {...props} />
    </ReactFlowProvider>
  );
}
