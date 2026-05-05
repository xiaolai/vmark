/**
 * Purpose: Custom @xyflow/react node for one GitHub Actions job.
 *   Renders job id/name, runner label, matrix/reusable badges, an
 *   if-condition indicator dot, and a step count + optional expand
 *   toggle that reveals the per-step list inline.
 *
 * Key decisions:
 *   - Uses VMark CSS tokens — see .claude/rules/31-design-tokens.md.
 *     No hardcoded colors. Token names: --bg-color, --bg-tertiary,
 *     --border-color, --accent-bg, --accent-primary, --text-color,
 *     --text-secondary, --popup-shadow.
 *   - Click handler routes through useWorkflowViewStore.getState() per
 *     AGENTS.md ("prefer useXStore.getState() inside callbacks") so
 *     this component doesn't re-render on every store change.
 *   - Outer container is `<div role="button">` rather than `<button>`
 *     so the expand chevron (a real `<button>`) can nest legally.
 *   - Step expand state is local. The xyflow snapshot captures the
 *     collapsed view (state default false) — visual parity preserved.
 *   - keyboard nav: Enter / Space activate selection; the chevron has
 *     its own focus stop and Enter/Space toggles expand. Escape clears
 *     selection (a11y per .claude/rules/33-focus-indicators.md).
 *
 * @module components/Editor/WorkflowPanel/JobNode
 */

import { useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { JobIR, StepIR } from "@/lib/ghaWorkflow/types";
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

const STEP_PREVIEW_MAX_CHARS = 48;

/**
 * Compose a one-line preview for a step. Order: name > uses > run.
 * Truncates long shell scripts to keep the node bounded.
 */
function stepPreview(step: StepIR): string {
  if (step.name) return truncate(step.name);
  if (step.uses) return `uses: ${truncate(step.uses)}`;
  if (step.run) {
    const firstLine = step.run.split("\n", 1)[0]?.trim() ?? "";
    return `run: ${truncate(firstLine)}`;
  }
  return step.id;
}

function truncate(s: string): string {
  if (s.length <= STEP_PREVIEW_MAX_CHARS) return s;
  return s.slice(0, STEP_PREVIEW_MAX_CHARS - 1) + "…";
}

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

  const [expanded, setExpanded] = useState(false);

  const label = job.name ?? job.id;
  const runner = job.runsOn?.join(" / ");
  const ariaLabel = buildJobAriaLabel(job, t);
  const hasSteps = job.steps.length > 0;

  const onActivate = () => {
    useWorkflowViewStore.getState().selectJob(job.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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

  const onToggleExpand = (e: MouseEvent<HTMLButtonElement>) => {
    // Don't trigger the card's selection click.
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div
      className="gha-job-node"
      role="button"
      tabIndex={0}
      data-selected={isSelected}
      aria-pressed={isSelected}
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={onKeyDown}
    >
      {/* Edge attachment points. Without these, xyflow has nowhere to
          route edges from the toGraph IR, and the dependency arrows
          between jobs disappear. Hidden visually via CSS — they're
          structural only. Layout direction is TD so target is top,
          source is bottom; LR mode re-uses these and just rotates
          edges, which xyflow handles internally. */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="gha-job-node__handle"
      />
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
        {hasSteps && (
          <button
            type="button"
            className="gha-job-node__expand"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? t("panel.steps.collapse", { defaultValue: "Hide steps" })
                : t("panel.steps.expand", {
                    defaultValue: "Show {{count}} steps",
                    count: job.steps.length,
                  })
            }
            title={
              expanded
                ? t("panel.steps.collapse", { defaultValue: "Hide steps" })
                : t("panel.steps.expand", {
                    defaultValue: "Show {{count}} steps",
                    count: job.steps.length,
                  })
            }
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="gha-job-node__steps">
              {t("panel.aria.stepCount", { count: job.steps.length })}
            </span>
          </button>
        )}
      </footer>
      {expanded && hasSteps && (
        <ol className="gha-job-node__steps-list" aria-label={t("panel.steps.listLabel", { defaultValue: "Steps" })}>
          {job.steps.map((step, i) => (
            <li key={step.id || `step-${i}`} className="gha-job-node__step">
              <span className="gha-job-node__step-index">{i + 1}</span>
              <span
                className={
                  step.uses
                    ? "gha-job-node__step-text gha-job-node__step-text--uses"
                    : step.run
                      ? "gha-job-node__step-text gha-job-node__step-text--run"
                      : "gha-job-node__step-text"
                }
                title={step.name ?? step.uses ?? step.run ?? step.id}
              >
                {stepPreview(step)}
              </span>
              {step.if && (
                <span
                  className="gha-job-node__step-if"
                  title={`if: ${step.if}`}
                  aria-label={t("panel.conditional")}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="gha-job-node__handle"
      />
    </div>
  );
}
