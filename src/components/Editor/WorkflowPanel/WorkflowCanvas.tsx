/**
 * Purpose: Interactive @xyflow/react canvas hosting the GHA workflow
 *   DAG. Mounts the JobNode custom node type, runs dagre layout on
 *   IR change, and exposes the canvas for export (.react-flow__viewport
 *   element is what html-to-image targets).
 *
 * Key decisions:
 *   - Pure presentation: takes a parsed WorkflowIR; layout + node/edge
 *     construction is delegated to render/toGraph.ts + render/layout.ts.
 *   - useMemo on the IR identity so layout doesn't re-run on every
 *     unrelated render.
 *   - fitView on first mount; subsequent IR changes preserve user pan/zoom.
 *
 * Interactive verification: this component mounts React Flow inside the
 * Tauri webview. Behavior is verified end-to-end only at app runtime;
 * this file's compile-time + type-check correctness is covered by the
 * surrounding store/render unit tests.
 *
 * @module components/Editor/WorkflowPanel/WorkflowCanvas
 */

import { useMemo, type ReactElement } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { toGraph } from "@/lib/ghaWorkflow/render/toGraph";
import { applyLayout } from "@/lib/ghaWorkflow/render/layout";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { JobNode } from "./JobNode";
import "./workflow-canvas.css";

const nodeTypes = { job: JobNode };

interface WorkflowCanvasProps {
  workflow: WorkflowIR;
}

function CanvasInner({ workflow }: WorkflowCanvasProps): ReactElement {
  const direction = useWorkflowViewStore((s) => s.layoutDirection);

  const { nodes, edges } = useMemo(() => {
    const graph = toGraph(workflow);
    return applyLayout(graph.nodes, graph.edges, { direction });
  }, [workflow, direction]);

  return (
    <ReactFlow
      nodes={nodes as never}
      edges={edges}
      nodeTypes={nodeTypes as never}
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onPaneClick={() => useWorkflowViewStore.getState().clearSelection()}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps): ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
