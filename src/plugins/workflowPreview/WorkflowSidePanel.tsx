/**
 * Workflow Side Panel
 *
 * Purpose: Persistent side panel for standalone .yml workflow files.
 * Shows the React Flow graph alongside the CodeMirror YAML editor and
 * exposes Run / Cancel controls for the runner (WI-4.2).
 *
 * @coordinates-with workflowPreviewStore.ts — reads panel + execution state
 * @coordinates-with WorkflowPreview.tsx — renders the React Flow canvas
 * @coordinates-with useWorkflowExecution.ts — start / cancel
 * @coordinates-with Editor.tsx — mounted alongside editor-content
 * @module plugins/workflowPreview/WorkflowSidePanel
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useWorkflowPreviewStore } from "@/stores/workflowPreviewStore";
import { useWorkflowExecution } from "@/hooks/useWorkflowExecution";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { genieError } from "@/utils/debug";
import { WorkflowPreview } from "./WorkflowPreview";
import "./workflow-side-panel.css";

const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH_RATIO = 0.8; // max 80% of container
const DEFAULT_PANEL_WIDTH = 400;

export function WorkflowSidePanel() {
  const { t } = useTranslation();
  const panelOpen = useWorkflowPreviewStore((s) => s.panelOpen);
  const graph = useWorkflowPreviewStore((s) => s.graph);
  const parseError = useWorkflowPreviewStore((s) => s.parseError);
  const activeStepId = useWorkflowPreviewStore((s) => s.activeStepId);
  const stepStatuses = useWorkflowPreviewStore((s) => s.stepStatuses);
  const executionId = useWorkflowPreviewStore((s) => s.executionId);
  const { start, cancel } = useWorkflowExecution();

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);

  // Resize handler refs for cleanup (project convention: rules/50 section 2)
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

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const handleNodeClick = useCallback((stepId: string, _yamlLine?: number) => {
    useWorkflowPreviewStore.getState().setActiveStepId(stepId);
  }, []);

  const handleRun = useCallback(async () => {
    // Read the YAML body from the active tab's document and the workspace
    // root from the workspace store so action-step path validation works.
    const windowLabel = "main";
    const tab = useTabStore.getState().getActiveTab(windowLabel);
    if (!tab) return;
    const doc = useDocumentStore.getState().getDocument(tab.id);
    const yaml = doc?.content;
    const workspaceRoot = useWorkspaceStore.getState().rootPath;
    if (!yaml || !workspaceRoot) return;
    try {
      await start({ yaml, workspaceRoot });
    } catch (err) {
      // The runner reports step failures as workflow:complete events;
      // synchronous invoke errors (parse error, missing workspace,
      // already-running guard) bubble up here.
      genieError("Workflow run failed to start:", err);
    }
  }, [start]);

  const handleCancel = useCallback(() => {
    void cancel();
  }, [cancel]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    cleanup(); // Clean up any previous handlers

    const startX = e.clientX;
    const startWidth = panelWidth;
    const containerWidth = panelRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    const maxWidth = containerWidth * MAX_PANEL_WIDTH_RATIO;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, startWidth + delta)));
    };

    const onUp = () => {
      cleanup();
    };

    handlersRef.current = { move: onMove, up: onUp };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth, cleanup]);

  if (!panelOpen) return null;

  const isRunning = executionId !== null;
  const canRun = !!graph && !parseError && !isRunning;

  return (
    <div
      className="workflow-side-panel"
      style={{ width: panelWidth }}
      ref={panelRef}
    >
      <div
        className="workflow-side-panel__resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-label={t("common:resize")}
      />
      <div className="workflow-side-panel__content">
        <div className="workflow-side-panel__toolbar" role="toolbar">
          {isRunning ? (
            <button
              type="button"
              className="workflow-side-panel__btn workflow-side-panel__btn--cancel"
              onClick={handleCancel}
              aria-label={t("workflow:run.cancel", "Cancel workflow")}
              title={t("workflow:run.cancel", "Cancel workflow")}
            >
              ◼
            </button>
          ) : (
            <button
              type="button"
              className="workflow-side-panel__btn workflow-side-panel__btn--run"
              onClick={handleRun}
              disabled={!canRun}
              aria-label={t("workflow:run.start", "Run workflow")}
              title={t("workflow:run.start", "Run workflow")}
            >
              ▶
            </button>
          )}
        </div>
        {parseError ? (
          <div className="workflow-side-panel__error">
            <span className="workflow-side-panel__error-icon">&#x26A0;</span>
            <span className="workflow-side-panel__error-text">{parseError}</span>
          </div>
        ) : graph ? (
          <div className="workflow-preview-canvas">
            <WorkflowPreview
              graph={graph}
              activeStepId={activeStepId}
              stepStatuses={stepStatuses}
              onNodeClick={handleNodeClick}
            />
          </div>
        ) : (
          <div className="workflow-side-panel__empty">
            {t("editor:workflow.noPreview")}
          </div>
        )}
      </div>
    </div>
  );
}
