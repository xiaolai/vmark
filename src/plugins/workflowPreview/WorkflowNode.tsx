/**
 * Custom Workflow Node Component
 *
 * Purpose: Renders a single workflow step as a React Flow node with
 * status indicators, icon, and label.
 *
 * @coordinates-with layout.ts — receives WorkflowNodeData
 * @coordinates-with workflow-node.css — co-located styles
 * @module plugins/workflowPreview/WorkflowNode
 */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import type { WorkflowNodeData } from "@/lib/workflow/layout";
import "./workflow-node.css";

export type WorkflowNodeType = Node<WorkflowNodeData, "workflow">;

function WorkflowNodeInner({ data, selected }: NodeProps<WorkflowNodeType>) {
  const { t } = useTranslation("common");
  const statusClass = data.status ? `workflow-node--${data.status}` : "";
  const selectedClass = selected ? "workflow-node--selected" : "";

  return (
    <div
      className={`workflow-node ${statusClass} ${selectedClass}`}
      role="button"
      aria-label={`${data.label} (${data.stepType})`}
    >
      <Handle type="target" position={Position.Left} className="workflow-node__handle" />
      <div className="workflow-node__content">
        <span className="workflow-node__icon">{data.icon}</span>
        <span className="workflow-node__label">{data.label}</span>
        {data.status === "running" && (
          <span className="workflow-node__spinner" aria-label={t("running")} />
        )}
        {data.status === "success" && (
          <span className="workflow-node__status-icon">✓</span>
        )}
        {data.status === "error" && (
          <span className="workflow-node__status-icon workflow-node__status-icon--error" title={data.error}>✗</span>
        )}
      </div>
      {data.duration != null && (
        <span className="workflow-node__duration">
          {data.duration < 1000 ? `${data.duration}ms` : `${(data.duration / 1000).toFixed(1)}s`}
        </span>
      )}
      <Handle type="source" position={Position.Right} className="workflow-node__handle" />
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeInner);
