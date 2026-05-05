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
import type { NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WorkflowNode } from "./WorkflowNode";
import { layoutWorkflow, type WorkflowNodeData } from "@/lib/workflow/layout";
import type { WorkflowGraph } from "@/lib/workflow/types";
import "./workflow-preview.css";

const nodeTypes = { workflow: WorkflowNode };

import type { StepStatusEntry } from "@/stores/workflowPreviewStore";

interface WorkflowPreviewProps {
  graph: WorkflowGraph;
  activeStepId?: string | null;
  /** Live execution status keyed by step id (WI-4.3). Optional — when omitted,
   * nodes show static layout-time data only. */
  stepStatuses?: Record<string, StepStatusEntry>;
  onNodeClick?: (stepId: string, yamlLine?: number) => void;
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

  const { nodes, edges } = useMemo(() => {
    const layoutNodes = layoutResult.nodes.map((n) => ({ ...n }));
    for (const node of layoutNodes) {
      if (activeStepId && node.id === activeStepId) {
        node.selected = true;
      }
      if (stepStatuses) {
        const status = stepStatuses[node.id];
        if (status) {
          const data = node.data as WorkflowNodeData;
          node.data = {
            ...data,
            status: status.status,
            duration: status.duration,
            error: status.error,
          };
        }
      }
    }
    return { nodes: layoutNodes, edges: layoutResult.edges };
  }, [layoutResult, activeStepId, stepStatuses]);

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
