/**
 * Purpose: Renders the workflow IR's diagnostic list above the canvas.
 *   Currently the lint pipeline (Phase 5 + actionlint forwarding) writes
 *   into `workflow.diagnostics[]` but nothing surfaces them, so users
 *   never see why a workflow flagged. This banner makes them visible.
 *
 *   Each row shows the severity icon, the GHA-* stable code, and the
 *   message. Diagnostics that carry a jobId in their context are
 *   click-able — clicking selects that job in the workflow view store
 *   so the form below the canvas opens to the offending entity.
 *
 *   When there are >5 diagnostics, the banner collapses to the first 5
 *   plus a "show all N" toggle. This keeps the panel compact when a
 *   workflow is actively in progress (many synthesized-id warnings,
 *   for example).
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 9 follow-up.
 *
 * Key decisions:
 *   - No "jump to source position" yet. That requires plumbing into the
 *     CodeMirror view (see SourceEditor.tsx scrollIntoView pattern); the
 *     selection-side action via workflowViewStore is the load-bearing
 *     piece — making diagnostics visible at all — and it does not
 *     require a global view handle.
 *   - Severity ordering is fixed (error → warning → info) since users
 *     scan errors first. Within a severity group we preserve the
 *     parser's emission order — re-sorting by code would scramble
 *     "first failure point" debugging.
 *
 * @coordinates-with src/lib/ghaWorkflow/types.ts — Diagnostic shape
 * @coordinates-with src/stores/workflowViewStore.ts — selectJob target
 * @module components/Editor/WorkflowEditor/DiagnosticsBanner
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { Diagnostic, Severity } from "@/lib/ghaWorkflow/types";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import "./workflow-editor.css";

interface DiagnosticsBannerProps {
  diagnostics: readonly Diagnostic[];
}

const COLLAPSE_THRESHOLD = 5;

const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_ICON: Record<Severity, string> = {
  error: "✗",
  warning: "⚠",
  info: "ⓘ",
};

export function DiagnosticsBanner({
  diagnostics,
}: DiagnosticsBannerProps): ReactElement | null {
  const { t } = useTranslation("workflowEditor");
  const [expanded, setExpanded] = useState(false);

  if (diagnostics.length === 0) return null;

  const sorted = [...diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const visible =
    expanded || sorted.length <= COLLAPSE_THRESHOLD
      ? sorted
      : sorted.slice(0, COLLAPSE_THRESHOLD);

  return (
    <section
      className="workflow-diagnostics-banner"
      aria-label={t("diagnosticsBanner.title")}
    >
      <ul className="workflow-diagnostics-banner__list">
        {visible.map((diag, idx) => {
          const jobId =
            typeof diag.context?.jobId === "string"
              ? diag.context.jobId
              : null;
          const content = (
            <>
              <span
                className={`workflow-diagnostics-banner__icon workflow-diagnostics-banner__icon--${diag.severity}`}
                aria-hidden
              >
                {SEVERITY_ICON[diag.severity]}
              </span>
              <code className="workflow-diagnostics-banner__code">
                {diag.code}
              </code>
              <span className="workflow-diagnostics-banner__message">
                {diag.message}
              </span>
            </>
          );
          return (
            <li
              key={idx}
              className={`workflow-diagnostics-banner__row workflow-diagnostics-banner__row--${diag.severity}`}
            >
              {jobId ? (
                <button
                  type="button"
                  className="workflow-diagnostics-banner__row-button"
                  onClick={() =>
                    useWorkflowViewStore.getState().selectJob(jobId)
                  }
                >
                  {content}
                </button>
              ) : (
                <span className="workflow-diagnostics-banner__row-static">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {sorted.length > COLLAPSE_THRESHOLD && !expanded && (
        <button
          type="button"
          className="workflow-diagnostics-banner__toggle"
          onClick={() => setExpanded(true)}
        >
          {t("diagnosticsBanner.showAll", { count: sorted.length })}
        </button>
      )}
    </section>
  );
}
