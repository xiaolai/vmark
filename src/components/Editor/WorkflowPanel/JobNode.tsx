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

import type { NodeProps, Node } from "@xyflow/react";
import type { ReactElement } from "react";
import type { JobIR } from "@/lib/ghaWorkflow/types";
import type { JobNodeData } from "@/lib/ghaWorkflow/render/toGraph";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useTranslation } from "react-i18next";
import "./job-node.css";

// xyflow's NodeProps narrows to the data + minimal id/selected props
// the inner node component receives. The earlier `Node<JobNodeData>`
// shape required `position`, which xyflow doesn't pass through to the
// inner component — that mismatch forced the type-erasure cast in the
// node-types registry. Using NodeProps now makes that cast safe at the
// integration boundary (cross-validator audit round 2 finding).
type JobNodeProps = NodeProps<Node<JobNodeData>>;

/**
 * Build a screen-reader summary of one job. Phase 9 a11y per the plan:
 * "aria-label on every JobNode summarizing job name + needs". Composes
 * the parts that exist; degrades to just the id when nothing else is set.
 */
function buildJobAriaLabel(
  job: JobIR,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  parts.push(t("panel.aria.jobPrefix", { name: job.name ?? job.id }));
  if (job.runsOn && job.runsOn.length > 0) {
    parts.push(
      t("panel.aria.runsOn", { runner: job.runsOn.join(", ") }),
    );
  }
  if (job.steps.length > 0) {
    parts.push(t("panel.aria.stepCount", { count: job.steps.length }));
  }
  if (job.needs.length > 0) {
    parts.push(t("panel.aria.needs", { refs: job.needs.join(", ") }));
  }
  if (job.if) {
    parts.push(t("panel.aria.conditional"));
  }
  return parts.join(". ");
}

export function JobNode(props: JobNodeProps): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const data = props.data;
  const job = data.job;
  const isSelected =
    useWorkflowViewStore((s) => s.selectedJobId) === job.id;

  const label = job.name ?? job.id;
  const runner = job.runsOn?.join(" / ");
  const ariaLabel = buildJobAriaLabel(job, t);

  const onActivate = () => {
    useWorkflowViewStore.getState().selectJob(job.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      useWorkflowViewStore.getState().clearSelection();
      // Hand focus back to the active source CodeMirror via the
      // activeEditorStore — using a global querySelector picked up
      // the first .cm-editor in the DOM, which in multi-window /
      // multi-editor layouts could be the wrong editor (Codex audit
      // round 5 finding).
      const view = useActiveEditorStore.getState().activeSourceView;
      if (view?.dom?.isConnected) {
        view.focus();
      }
    }
  };

  return (
    <button
      type="button"
      className="gha-job-node"
      data-selected={isSelected}
      aria-pressed={isSelected}
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={onKeyDown}
    >
      <header className="gha-job-node__header">
        <span className="gha-job-node__title">{label}</span>
        {job.if && (
          <span
            className="gha-job-node__if-dot"
            aria-label={t("panel.conditional")}
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
            {t("panel.reusableWorkflow.badge")}
          </span>
        )}
        {data.matrixDynamic && (
          <span className="gha-job-node__badge gha-job-node__badge--matrix">
            {t("panel.matrix.dynamic")}
          </span>
        )}
        {data.matrixCount && data.matrixCount > 1 && (
          <span className="gha-job-node__badge gha-job-node__badge--matrix">
            ×{data.matrixCount}
          </span>
        )}
        {job.steps.length > 0 && (
          <span className="gha-job-node__steps">
            {t("panel.aria.stepCount", { count: job.steps.length })}
          </span>
        )}
      </footer>
    </button>
  );
}
