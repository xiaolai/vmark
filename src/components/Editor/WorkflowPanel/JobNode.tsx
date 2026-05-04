/**
 * Purpose: Custom @xyflow/react node for one GitHub Actions job.
 *   Renders job id/name, runner label, matrix badge, reusable badge,
 *   and an if-condition indicator dot. Click selects via the
 *   workflowViewStore (drives click-to-jump in the host panel).
 *
 * Key decisions:
 *   - Uses VMark CSS tokens — see .claude/rules/31-design-tokens.md.
 *     No hardcoded colors. Token names: --bg-color, --bg-tertiary,
 *     --border-color, --accent-bg, --accent-primary, --text-color,
 *     --text-secondary, --popup-shadow.
 *   - Click handler routes through useWorkflowViewStore.getState() per
 *     AGENTS.md ("prefer useXStore.getState() inside callbacks") so
 *     this component doesn't re-render on every store change.
 *   - keyboard nav: Enter / Space activate selection so the canvas is
 *     reachable without a mouse (a11y per .claude/rules/33-focus-indicators.md).
 *
 * @module components/Editor/WorkflowPanel/JobNode
 */

import type { Node } from "@xyflow/react";
import type { ReactElement } from "react";
import type { JobNodeData } from "@/lib/ghaWorkflow/render/toGraph";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { useTranslation } from "react-i18next";
import "./job-node.css";

type JobNodeProps = Node<JobNodeData>;

export function JobNode(props: JobNodeProps): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const data = props.data;
  const job = data.job;
  const isSelected =
    useWorkflowViewStore((s) => s.selectedJobId) === job.id;

  const label = job.name ?? job.id;
  const runner = job.runsOn?.join(" / ");

  const onActivate = () => {
    useWorkflowViewStore.getState().selectJob(job.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <button
      type="button"
      className="gha-job-node"
      data-selected={isSelected}
      aria-pressed={isSelected}
      onClick={onActivate}
      onKeyDown={onKeyDown}
    >
      <header className="gha-job-node__header">
        <span className="gha-job-node__title">{label}</span>
        {job.if && (
          <span
            className="gha-job-node__if-dot"
            aria-label={t("panel.conditional", "conditional")}
            title={`if: ${job.if}`}
          />
        )}
      </header>
      {runner && (
        <div className="gha-job-node__runner" title={runner}>
          {runner}
        </div>
      )}
      <footer className="gha-job-node__footer">
        {data.reusable && (
          <span className="gha-job-node__badge gha-job-node__badge--reusable">
            {t("panel.reusableWorkflow.badge", "reusable")}
          </span>
        )}
        {data.matrixDynamic && (
          <span className="gha-job-node__badge gha-job-node__badge--matrix">
            {t("panel.matrix.dynamic", "dynamic")}
          </span>
        )}
        {data.matrixCount && data.matrixCount > 1 && (
          <span className="gha-job-node__badge gha-job-node__badge--matrix">
            ×{data.matrixCount}
          </span>
        )}
        {job.steps.length > 0 && (
          <span className="gha-job-node__steps">
            {job.steps.length} step{job.steps.length === 1 ? "" : "s"}
          </span>
        )}
      </footer>
    </button>
  );
}
