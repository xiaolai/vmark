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

import {
  Suspense,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";
import { WorkflowCanvas } from "@/components/Editor/WorkflowPanel/WorkflowCanvas";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { WindowContext } from "@/contexts/WindowContext";
import { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/utils/imeToast";
import "./gha-workflow-side-panel.css";

// Lazy-loaded so the yaml package + mutators + workflowEditStore
// don't land in the eager App bundle. The forms editor + save
// pipeline only matters once a workflow file is being viewed; the
// canvas itself doesn't need them. Suspense fallback is null because
// the panel above it (the canvas) renders synchronously.
const WorkflowEditorPanel = lazy(() =>
  import("@/components/Editor/WorkflowEditor/WorkflowEditorPanel").then(
    (m) => ({ default: m.WorkflowEditorPanel }),
  ),
);

const MIN_PANEL_WIDTH = 240;
const MAX_PANEL_WIDTH_RATIO = 0.8;
const DEFAULT_PANEL_WIDTH_RATIO = 0.5;
/** Fallback for SSR / pre-mount when the editor container hasn't measured. */
const FALLBACK_PANEL_WIDTH = 480;

export function GhaWorkflowSidePanel(): ReactElement | null {
  const { t } = useTranslation();
  const panelOpen = useGhaWorkflowPanelStore((s) => s.panelOpen);
  const workflow = useGhaWorkflowPanelStore((s) => s.workflow);
  const parseError = useGhaWorkflowPanelStore((s) => s.parseError);

  const [panelWidth, setPanelWidth] = useState(FALLBACK_PANEL_WIDTH);
  /**
   * Tracks whether the user has manually resized the panel. Once they
   * have, we never auto-resize again — even on container width changes
   * — so their preference sticks until the next session.
   */
  const userResizedRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);

  // On first open, set the panel width to half of the editor container,
  // bounded by MIN_PANEL_WIDTH. Yields a sensible split-view default for
  // YAML workflow files where the source + diagram are equally important.
  useEffect(() => {
    if (!panelOpen) return;
    if (userResizedRef.current) return;
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const containerWidth = container.clientWidth || window.innerWidth;
    const next = Math.max(
      MIN_PANEL_WIDTH,
      Math.round(containerWidth * DEFAULT_PANEL_WIDTH_RATIO),
    );
    setPanelWidth(next);
  }, [panelOpen]);

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
  // listener references so cleanup can remove the exact functions, and
  // clean up on `mouseup`, `blur`, AND component unmount).
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: (() => void) | null;
    blur: (() => void) | null;
  }>({ move: null, up: null, blur: null });

  const cleanup = useCallback(() => {
    if (handlersRef.current.move) {
      document.removeEventListener("mousemove", handlersRef.current.move);
    }
    if (handlersRef.current.up) {
      document.removeEventListener("mouseup", handlersRef.current.up);
    }
    if (handlersRef.current.blur) {
      window.removeEventListener("blur", handlersRef.current.blur);
    }
    handlersRef.current = { move: null, up: null, blur: null };
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
        // Mark as user-resized on the first delta — locks out the
        // auto-50% default for the rest of the session.
        userResizedRef.current = true;
        const delta = startX - moveEvent.clientX;
        setPanelWidth(
          Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, startWidth + delta)),
        );
      };

      const onUp = () => cleanup();
      const onBlur = () => cleanup();

      handlersRef.current = { move: onMove, up: onUp, blur: onBlur };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      // Clean up if the user Cmd-Tabs away mid-drag — without this the
      // mousemove listener stays attached and the next mousedown over
      // the document briefly resumes the drag.
      window.addEventListener("blur", onBlur);
    },
    [panelWidth, cleanup],
  );

  // Look up the active tab inside the callback (and optionally) so the
  // panel renders even when no WindowProvider is present (e.g. in
  // standalone unit tests). The panel works the same in production —
  // it sits inside an Editor whose WindowContext is established.
  const windowCtx = useContext(WindowContext);

  // Bind the workflowEditStore patch queue to the active document's
  // real filePath (or untitled tab id). Without this the source plugin
  // used a content-derived id that collided on common shapes like
  // "(unnamed)::build" (Codex round 5: cross-document corruption).
  useEffect(() => {
    if (!panelOpen) return;
    const windowLabel = windowCtx?.windowLabel;
    if (!windowLabel) return;
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    if (!tabId) return;
    const doc = useDocumentStore.getState().documents[tabId];
    const docId = doc?.filePath ?? `untitled:${tabId}`;
    void import("@/stores/workflowEditStore")
      .then(({ useWorkflowEditStore }) => {
        const editStore = useWorkflowEditStore.getState();
        const previousId = editStore.boundDocumentId;
        editStore.bindToDocument(docId);
        // When the bound document changes, reset the view-store
        // selection too so common ids like "build"/"test" don't carry
        // selection from the previous workflow into the new one
        // (Codex round 5: workflowViewStore globals leak across docs).
        if (previousId !== docId) {
          useWorkflowViewStore.getState().reset();
        }
      })
      .catch(() => {
        // Chunk load failed (offline cache eviction, hash drift after
        // deploy). The panel still works for read; bind retries on
        // next render (footgun audit: unhandled rejection risk).
      });
  }, [panelOpen, workflow, windowCtx]);

  const handleSave = useCallback(async (): Promise<void> => {
    const windowLabel = windowCtx?.windowLabel;
    if (!windowLabel) return;
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    if (!tabId) return;
    const docState = useDocumentStore.getState();
    const tabDoc = docState.documents[tabId];
    if (!tabDoc) return;
    // Lazy-imports keep the yaml package + mutators + saveToPath out of
    // the eager App bundle. Forms-editor users pay the cost; viewers
    // never load these modules.
    const [{ useWorkflowEditStore }, { saveToPath }] = await Promise.all([
      import("@/stores/workflowEditStore"),
      import("@/utils/saveToPath"),
    ]);
    const editStore = useWorkflowEditStore.getState();
    if (editStore.pendingPatches.length === 0) return;
    try {
      const next = editStore.applyAndSerialize(tabDoc.content);
      if (tabDoc.filePath) {
        // Disk write FIRST. If saveToPath fails, the patch queue stays
        // intact so the user can retry — clearing the queue and
        // mutating the doc state pre-write loses the user's work on a
        // disk-full / permission-denied / parent-missing failure
        // (auditor finding: data-loss risk).
        const ok = await saveToPath(tabId, tabDoc.filePath, next, "manual");
        if (!ok) return;
        docState.setContent(tabId, next);
        editStore.clearPatches();
        toast.success(t("workflowEditor:save.savedToast"));
      } else {
        // Untitled workflows have no path. Reflect the change in the
        // editor so the user can Cmd+Shift+S to save; the queue clears
        // because the IR-side change is already applied to the doc.
        docState.setContent(tabId, next);
        editStore.clearPatches();
        toast.success(t("workflowEditor:save.updatedNoPathToast"));
      }
    } catch (error) {
      toast.error(
        `${t("workflowEditor:save.errorTitle")}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [windowCtx, t]);

  const handleDiscard = useCallback((): void => {
    // Patch queue is cleared inside SaveControls before this fires;
    // there's no source-of-truth reload to do because the editor's
    // YAML content is unchanged (forms only buffer patches). Once
    // clearPatches() runs, the next render rebuilds form state from
    // the IR — which is regenerated from the unchanged source by the
    // CodeMirror plugin.
  }, []);

  if (!panelOpen) return null;

  return (
    <aside
      className="gha-workflow-side-panel"
      style={{ width: panelWidth }}
      ref={panelRef}
      aria-label={t("workflowEditor:panel.title")}
    >
      <div
        className="gha-workflow-side-panel__resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("common:resize")}
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
          <>
            <div className="gha-workflow-side-panel__canvas">
              <WorkflowCanvas workflow={workflow} />
            </div>
            <Suspense fallback={null}>
              <WorkflowEditorPanel
                workflow={workflow}
                onSave={handleSave}
                onDiscard={handleDiscard}
              />
            </Suspense>
          </>
        ) : (
          <div className="gha-workflow-side-panel__empty">
            {t("workflowEditor:panel.noWorkflow")}
          </div>
        )}
      </div>
    </aside>
  );
}
