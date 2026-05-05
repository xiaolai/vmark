/**
 * Purpose: The xyflow + dagre subtree of the workflow canvas. Split out
 *   so its 90 kB of dependencies (xyflow + xyflow CSS, both pulled
 *   transitively) can be lazy-loaded by `WorkflowCanvas`. Without this
 *   split the eager App bundle absorbs xyflow on every cold start, even
 *   for users who never open a workflow.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md
 *   Phase 9 audit follow-up — judgment-agent finding.
 *
 * Key decisions:
 *   - The inner component is the entire xyflow surface. The outer
 *     WorkflowCanvas keeps the ReactFlowProvider + Suspense boundary so
 *     consumers (GhaWorkflowSidePanel, GhaWorkflowPanel) keep their
 *     existing import shape.
 *   - Module-scope NODE_TYPES + PRO_OPTIONS keep React 19's effect
 *     unmount path from feeding xyflow's internal setState a new
 *     identity on every render (the "Maximum update depth exceeded"
 *     loop documented in the size-limit comment for the eager App
 *     entry). This file holds those constants now.
 *
 * @coordinates-with src/components/Editor/WorkflowPanel/WorkflowCanvas.tsx
 *   — lazy-loads this module.
 * @module components/Editor/WorkflowPanel/WorkflowCanvasInner
 */

import { useCallback, useMemo, type ReactElement } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { toGraph, type JobNodeData } from "@/lib/ghaWorkflow/render/toGraph";
import { applyLayout } from "@/lib/ghaWorkflow/render/layout";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { JobNode } from "./JobNode";

// Cross-validator audit round 2 fix: with JobNode now typed as
// `NodeProps<Node<JobNodeData>>` instead of `Node<JobNodeData>`, the
// node-types registry no longer needs an `as` cast. Drift in
// JobNodeData or the node-type contract is now a compile error.
const NODE_TYPES: NodeTypes = { job: JobNode };
const PRO_OPTIONS = { hideAttribution: true } as const;

interface WorkflowCanvasInnerProps {
  workflow: WorkflowIR;
}

function CanvasInner({ workflow }: WorkflowCanvasInnerProps): ReactElement {
  const direction = useWorkflowViewStore((s) => s.layoutDirection);

  const { nodes, edges } = useMemo(() => {
    const graph = toGraph(workflow);
    return applyLayout(graph.nodes, graph.edges, { direction });
  }, [workflow, direction]);

  const onPaneClick = useCallback(() => {
    useWorkflowViewStore.getState().clearSelection();
  }, []);

  return (
    <ReactFlow<Node<JobNodeData>>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={PRO_OPTIONS}
      onPaneClick={onPaneClick}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}

export function WorkflowCanvasInner(
  props: WorkflowCanvasInnerProps,
): ReactElement {
  // ReactFlowProvider sits inside the lazy chunk too — keeping it in
  // the eager outer file would defeat the bundle-split goal because
  // it pulls all of xyflow with it.
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// Default export — required by React.lazy at the call site.
export default WorkflowCanvasInner;
