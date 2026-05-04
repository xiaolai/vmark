/**
 * Purpose: Renders the workflow IR's diagnostic list above the canvas.
 *   The lint pipeline (Phase 5 + actionlint forwarding) writes into
 *   `workflow.diagnostics[]` but nothing else surfaces them, so users
 *   never see why a workflow flagged. This banner makes them visible.
 *
 *   Each row shows the severity icon, the GHA-* stable code, and the
 *   message. Click handling routes by what context the diagnostic
 *   carries (priority order):
 *
 *     1. `position` → scroll the active CodeMirror Source view to the
 *        offending line, place the caret at the start of that line.
 *     2. `context.jobId` → select that job in `workflowViewStore` so
 *        the form below the canvas opens to the offending entity.
 *     3. Neither → render as a static row (no button).
 *
 *   Position-based jumps win because they're more precise; selection
 *   surfaces only the job, but position drops the caret on the exact
 *   failing line. Diagnostics often carry both — the jump still wins.
 *
 *   When there are >5 diagnostics, the banner collapses to the first 5
 *   plus a "show all N" toggle. This keeps the panel compact when a
 *   workflow is actively in progress (many synthesized-id warnings,
 *   for example).
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6
 *   Phase 9 follow-up.
 *
 * @coordinates-with src/lib/ghaWorkflow/types.ts — Diagnostic shape
 * @coordinates-with src/stores/workflowViewStore.ts — selectJob target
 * @coordinates-with src/stores/activeEditorStore.ts — activeSourceView (CodeMirror)
 * @module components/Editor/WorkflowEditor/DiagnosticsBanner
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { EditorView as CMEditorView } from "@codemirror/view";
import type { Diagnostic, Severity } from "@/lib/ghaWorkflow/types";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
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

/**
 * Scroll the active source-mode CodeMirror view to a 1-based (line, col)
 * position. Drops the caret at the start of the targeted line so the
 * user lands precisely on the offending row even if the column is off.
 *
 * Returns true when a scroll dispatched, false when no source view is
 * active (caller can fall back to selection-based navigation).
 */
function scrollSourceToPosition(line: number, col: number): boolean {
  const { activeSourceView } = useActiveEditorStore.getState();
  if (!activeSourceView || !activeSourceView.dom?.isConnected) return false;
  const doc = activeSourceView.state.doc;
  const targetLine = Math.max(1, Math.min(line, doc.lines));
  const lineInfo = doc.line(targetLine);
  // Column is informational; place the caret at line start so the user
  // sees the whole line in context. Clamping to lineInfo.to handles
  // CRLF / unusually short lines without throwing.
  const caretOffset = Math.min(
    lineInfo.from + Math.max(0, col - 1),
    lineInfo.to,
  );
  activeSourceView.dispatch({
    selection: { anchor: caretOffset },
    effects: CMEditorView.scrollIntoView(lineInfo.from),
  });
  activeSourceView.focus();
  return true;
}

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
          const hasPosition = !!diag.position;
          const isInteractive = hasPosition || jobId !== null;
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

          const onClick = (): void => {
            // Position takes priority — it's more precise than job-level
            // selection. Falls through to selection if no source view
            // is active (e.g. WYSIWYG mode with the panel open).
            if (
              diag.position &&
              scrollSourceToPosition(
                diag.position.startLine,
                diag.position.startCol,
              )
            ) {
              return;
            }
            if (jobId) {
              useWorkflowViewStore.getState().selectJob(jobId);
            }
          };

          return (
            <li
              key={idx}
              className={`workflow-diagnostics-banner__row workflow-diagnostics-banner__row--${diag.severity}`}
            >
              {isInteractive ? (
                <button
                  type="button"
                  className="workflow-diagnostics-banner__row-button"
                  onClick={onClick}
                  title={
                    hasPosition
                      ? t("diagnosticsBanner.jumpToLine", {
                          line: diag.position!.startLine,
                        })
                      : undefined
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
