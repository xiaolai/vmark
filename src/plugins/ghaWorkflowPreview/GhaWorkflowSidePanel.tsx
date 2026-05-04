/**
 * Purpose: Persistent side panel for standalone GitHub Actions workflow
 *   `.yml` files. Reads from `useGhaWorkflowPanelStore` (populated by the
 *   sourceGhaWorkflowPreview CodeMirror plugin) and mounts the
 *   interactive @xyflow/react canvas.
 *
 *   Mirrors src/plugins/workflowPreview/WorkflowSidePanel.tsx (Genie
 *   workflow). Both panels coexist; only one fires per file because the
 *   shape detectors are mutually exclusive.
 *
 * Key decisions:
 *   - The canvas component is the same @/components/Editor/WorkflowPanel/
 *     WorkflowCanvas that Phase 2 built; this file is just the "panel
 *     wrapper" — store binding + resize handle + chrome.
 *   - Panel width is local state; persistence (LocalStorage / per-tab) is
 *     a follow-up.
 *
 * @coordinates-with src/stores/ghaWorkflowPanelStore.ts — read state
 * @coordinates-with src/components/Editor/WorkflowPanel/WorkflowCanvas.tsx
 * @coordinates-with src/plugins/codemirror/sourceGhaWorkflowPreview.ts — writes the store
 * @module plugins/ghaWorkflowPreview/GhaWorkflowSidePanel
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";
import { WorkflowCanvas } from "@/components/Editor/WorkflowPanel/WorkflowCanvas";
import { useTranslation } from "react-i18next";
import "./gha-workflow-side-panel.css";

const MIN_PANEL_WIDTH = 240;
const MAX_PANEL_WIDTH_RATIO = 0.8;
const DEFAULT_PANEL_WIDTH = 480;

export function GhaWorkflowSidePanel(): ReactElement | null {
  const { t } = useTranslation();
  const panelOpen = useGhaWorkflowPanelStore((s) => s.panelOpen);
  const workflow = useGhaWorkflowPanelStore((s) => s.workflow);
  const parseError = useGhaWorkflowPanelStore((s) => s.parseError);

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const panelRef = useRef<HTMLElement>(null);

  // Publish the current panel width as a CSS variable on the editor
  // container so .editor-content can shrink itself via calc() and
  // CodeMirror reflows correctly. Without this, the source editor
  // draws under the absolute-positioned panel.
  useEffect(() => {
    if (!panelOpen) return;
    const container = panelRef.current?.parentElement;
    if (!container) return;
    container.style.setProperty("--gha-panel-width", `${panelWidth}px`);
    return () => {
      container.style.removeProperty("--gha-panel-width");
    };
  }, [panelOpen, panelWidth]);

  // Resize handler refs (project convention: rules/50 §2 — always store
  // listener references so cleanup can remove the exact functions).
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: (() => void) | null;
  }>({ move: null, up: null });

  const cleanup = useCallback(() => {
    if (handlersRef.current.move) {
      document.removeEventListener("mousemove", handlersRef.current.move);
    }
    if (handlersRef.current.up) {
      document.removeEventListener("mouseup", handlersRef.current.up);
    }
    handlersRef.current = { move: null, up: null };
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      cleanup();

      const startX = e.clientX;
      const startWidth = panelWidth;
      const containerWidth =
        panelRef.current?.parentElement?.clientWidth ?? window.innerWidth;
      const maxWidth = containerWidth * MAX_PANEL_WIDTH_RATIO;

      const onMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        setPanelWidth(
          Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, startWidth + delta)),
        );
      };

      const onUp = () => cleanup();

      handlersRef.current = { move: onMove, up: onUp };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelWidth, cleanup],
  );

  if (!panelOpen) return null;

  return (
    <aside
      className="gha-workflow-side-panel"
      style={{ width: panelWidth }}
      ref={panelRef}
      aria-label={t("workflowEditor:panel.title", "Workflow")}
    >
      <div
        className="gha-workflow-side-panel__resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("common:resize", "Resize")}
      />
      <div className="gha-workflow-side-panel__content">
        {parseError ? (
          <div className="gha-workflow-side-panel__error">
            <span className="gha-workflow-side-panel__error-icon">&#x26A0;</span>
            <span className="gha-workflow-side-panel__error-text">
              {parseError}
            </span>
          </div>
        ) : workflow ? (
          <div className="gha-workflow-side-panel__canvas">
            <WorkflowCanvas workflow={workflow} />
          </div>
        ) : (
          <div className="gha-workflow-side-panel__empty">
            {t("workflowEditor:panel.noWorkflow", "No workflow detected")}
          </div>
        )}
      </div>
    </aside>
  );
}
