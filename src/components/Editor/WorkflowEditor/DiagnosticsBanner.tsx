/**
 * Purpose: Renders the workflow IR's diagnostic list above the canvas.
 *   The lint pipeline (Phase 5 + actionlint forwarding) writes into
 *   `workflow.diagnostics[]` but nothing else surfaces them, so users
 *   never see why a workflow flagged. This banner makes them visible.
 *
 *   Each row shows a collapse/expand chevron, the severity icon, the
 *   GHA-* stable code, and the message. The chevron toggles the
 *   message visibility per-row (default expanded). Click on the row
 *   message routes by what context the diagnostic carries (priority
 *   order):
 *
 *     1. `position` → scroll the active CodeMirror Source view to the
 *        offending line, place the caret at the start of that line.
 *     2. `context.jobId` → select that job in `workflowViewStore` so
 *        the form below the canvas opens to the offending entity.
 *     3. Neither → render as a static row (no jump action).
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

import { useState, type MouseEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  /**
   * Per-row collapse state. Stored as the SET of collapsed row keys
   * (default Set is empty → every row starts expanded). Keyed on
   * `${code}::${index}` so re-orderings don't accidentally re-collapse
   * an unrelated row.
   */
  const [collapsedRows, setCollapsedRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  if (diagnostics.length === 0) return null;

  const sorted = [...diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const visible =
    expanded || sorted.length <= COLLAPSE_THRESHOLD
      ? sorted
      : sorted.slice(0, COLLAPSE_THRESHOLD);

  const toggleRow = (key: string) => {
    setCollapsedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const collapseAll = () => {
    const all = new Set<string>();
    visible.forEach((d, i) => all.add(`${d.code}::${i}`));
    setCollapsedRows(all);
  };
  const expandAll = () => setCollapsedRows(new Set());

  const allCollapsed =
    visible.length > 0 &&
    visible.every((d, i) => collapsedRows.has(`${d.code}::${i}`));

  return (
    <section
      className="workflow-diagnostics-banner"
      aria-label={t("diagnosticsBanner.title")}
    >
      <header className="workflow-diagnostics-banner__header">
        <span className="workflow-diagnostics-banner__title">
          {t("diagnosticsBanner.title", { defaultValue: "Diagnostics" })}{" "}
          <span className="workflow-diagnostics-banner__count">
            ({sorted.length})
          </span>
        </span>
        <button
          type="button"
          className="workflow-diagnostics-banner__bulk"
          onClick={allCollapsed ? expandAll : collapseAll}
          aria-label={
            allCollapsed
              ? t("diagnosticsBanner.expandAll", {
                  defaultValue: "Expand all",
                })
              : t("diagnosticsBanner.collapseAll", {
                  defaultValue: "Collapse all",
                })
          }
        >
          {allCollapsed
            ? t("diagnosticsBanner.expandAll", { defaultValue: "Expand all" })
            : t("diagnosticsBanner.collapseAll", {
                defaultValue: "Collapse all",
              })}
        </button>
      </header>
      <ul className="workflow-diagnostics-banner__list">
        {visible.map((diag, idx) => {
          const rowKey = `${diag.code}::${idx}`;
          const rowCollapsed = collapsedRows.has(rowKey);
          const jobId =
            typeof diag.context?.jobId === "string"
              ? diag.context.jobId
              : null;
          const hasPosition = !!diag.position;
          const isInteractive = hasPosition || jobId !== null;

          const onMessageClick = (): void => {
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

          const onChevronClick = (e: MouseEvent<HTMLButtonElement>): void => {
            e.stopPropagation();
            toggleRow(rowKey);
          };

          const messageNode = (
            <span className="workflow-diagnostics-banner__message">
              {diag.message}
            </span>
          );

          return (
            <li
              key={rowKey}
              className={`workflow-diagnostics-banner__row workflow-diagnostics-banner__row--${diag.severity}`}
            >
              <button
                type="button"
                className="workflow-diagnostics-banner__chevron"
                onClick={onChevronClick}
                aria-expanded={!rowCollapsed}
                aria-label={
                  rowCollapsed
                    ? t("diagnosticsBanner.expandRow", {
                        defaultValue: "Show details",
                      })
                    : t("diagnosticsBanner.collapseRow", {
                        defaultValue: "Hide details",
                      })
                }
                title={
                  rowCollapsed
                    ? t("diagnosticsBanner.expandRow", {
                        defaultValue: "Show details",
                      })
                    : t("diagnosticsBanner.collapseRow", {
                        defaultValue: "Hide details",
                      })
                }
              >
                {rowCollapsed ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
              </button>
              <span
                className={`workflow-diagnostics-banner__icon workflow-diagnostics-banner__icon--${diag.severity}`}
                aria-hidden
              >
                {SEVERITY_ICON[diag.severity]}
              </span>
              <code className="workflow-diagnostics-banner__code">
                {diag.code}
              </code>
              {!rowCollapsed &&
                (isInteractive ? (
                  <button
                    type="button"
                    className="workflow-diagnostics-banner__row-button"
                    onClick={onMessageClick}
                    title={
                      hasPosition
                        ? t("diagnosticsBanner.jumpToLine", {
                            line: diag.position!.startLine,
                          })
                        : undefined
                    }
                  >
                    {messageNode}
                  </button>
                ) : (
                  <span className="workflow-diagnostics-banner__row-static">
                    {messageNode}
                  </span>
                ))}
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
