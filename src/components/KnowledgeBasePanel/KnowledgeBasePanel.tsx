/**
 * KnowledgeBasePanel (Phase 5) — in-app surface for the content server.
 *
 * Pure presentation: reads lifecycle state from `contentServerStore` via
 * selectors and renders the matching view (empty/provisioning/starting/running/
 * error). When running, it embeds the KB site (served on loopback) in an
 * iframe and offers "open in browser". Actions are injected so the panel stays
 * free of store/service wiring (the `useContentServer` hook supplies them).
 *
 * Reached from App.tsx, which passes `<KnowledgeBaseOverlay />` into EditorArea's
 * `sidePanel` prop — an in-flow right dock, not an overlay. ADR-007 describes a
 * slot-registration mechanism; none exists, so this mount is an edit to App.tsx
 * like every other surface, and `scripts/check-shell-slots.mjs` is what keeps
 * that set from growing unnoticed (WI-12).
 *
 * The graph view is behind `React.lazy`: `@xyflow/react` chunks with
 * `@dagrejs/dagre`, and xyflow's d3 dependencies chunk with mermaid, so a static
 * import here put ~3.2 MB on every document window's cold start.
 *
 * The boundary deliberately sits directly around the graph, inside an
 * already-mounted panel — the placement WorkflowCanvas.tsx settled on after the
 * React 19 + xyflow `disappearLayoutEffects` loop, which it attributes to a
 * boundary at the PANEL-MOUNT level rather than at the canvas. Following that
 * placement is what makes lazy safe here; moving the boundary up to
 * KnowledgeBaseOverlay would reproduce the shape that broke.
 *
 * Audit 20260804-F4: it used to be a bare `Suspense`, which handles the
 * PENDING half and nothing else — a rejected 3.2 MB chunk propagated past the
 * panel to the root boundary and took the whole window down over a graph the
 * user could simply have retried. `RetryableLazy` catches it here and mounts a
 * FRESH lazy per attempt, because React.lazy caches its rejection forever.
 *
 * @module components/KnowledgeBasePanel
 */

import { useTranslation } from "react-i18next";
import { RetryableLazy } from "@/components/RetryableLazy";
import {
  useContentServerStore,
  selectServerStatus,
  selectServerUrl,
  selectProvision,
  selectError,
  selectIframeUrl,
  selectViewMode,
} from "@/stores/contentServerStore";
import "./knowledge-base-panel.css";

const loadKbGraphView = () =>
  import("./KbGraphView").then((m) => ({ default: m.KbGraphView }));

export interface KnowledgeBasePanelProps {
  onStart: () => void;
  onStop: () => void;
  onOpenInBrowser: () => void;
  onPreviewSlides: () => void;
  onExportSlides: () => void;
}

export function KnowledgeBasePanel({
  onStart,
  onStop,
  onOpenInBrowser,
  onPreviewSlides,
  onExportSlides,
}: KnowledgeBasePanelProps) {
  const { t } = useTranslation();
  const status = useContentServerStore(selectServerStatus);
  const url = useContentServerStore(selectServerUrl);
  const provision = useContentServerStore(selectProvision);
  const error = useContentServerStore(selectError);
  const iframeUrl = useContentServerStore(selectIframeUrl);
  const viewMode = useContentServerStore(selectViewMode);

  return (
    <section className="kb-panel" aria-label={t("contentServer.title")}>
      <header className="kb-panel__header">
        <span className="kb-panel__title">{t("contentServer.title")}</span>
        <span className="kb-panel__status" data-status={status}>
          {t(`contentServer.status.${status}`)}
        </span>
      </header>

      {status === "stopped" && (
        <div className="kb-panel__empty">
          <p>{t("contentServer.empty")}</p>
          <button type="button" className="vm-btn" onClick={onStart}>
            {t("contentServer.action.start")}
          </button>
        </div>
      )}

      {status === "provisioning" && provision && (
        <div className="kb-panel__progress" role="status">
          {provision.phase === "downloading"
            ? t("contentServer.provision.downloading", {
                percent: provision.total
                  ? Math.floor((100 * (provision.received ?? 0)) / provision.total)
                  : 0,
              })
            : t(`contentServer.provision.${provision.phase}`)}
        </div>
      )}

      {status === "starting" && (
        <div className="kb-panel__progress" role="status">
          {t("contentServer.status.starting")}
        </div>
      )}

      {status === "error" && (
        <div className="kb-panel__error" role="alert">
          <p>{error}</p>
          <button type="button" className="vm-btn" onClick={onStart}>
            {t("contentServer.action.retry")}
          </button>
        </div>
      )}

      {status === "running" && url && (
        <>
          <div className="kb-panel__toolbar">
            <button
              type="button"
              className="vm-btn"
              aria-pressed={viewMode === "site"}
              onClick={() => useContentServerStore.getState().setViewMode("site")}
            >
              {t("contentServer.view.site")}
            </button>
            <button
              type="button"
              className="vm-btn"
              aria-pressed={viewMode === "graph"}
              onClick={() => useContentServerStore.getState().setViewMode("graph")}
            >
              {t("contentServer.view.graph")}
            </button>
            <span className="kb-panel__spacer" />
            <button type="button" className="vm-btn" onClick={onPreviewSlides}>
              {t("contentServer.slidev.preview")}
            </button>
            <button type="button" className="vm-btn" onClick={onExportSlides}>
              {t("contentServer.slidev.export")}
            </button>
            <button type="button" className="vm-btn" onClick={onOpenInBrowser}>
              {t("contentServer.action.openInBrowser")}
            </button>
            <button type="button" className="vm-btn" onClick={onStop}>
              {t("contentServer.action.stop")}
            </button>
          </div>
          {viewMode === "graph" ? (
            <RetryableLazy
              feature="Knowledge base graph"
              load={loadKbGraphView}
              componentProps={{}}
              // Same placeholder the graph itself uses while fetching, so chunk
              // load and data load read as one continuous state.
              pending={<div className="kb-graph__loading" data-testid="kb-graph-pending" />}
              renderError={(retry) => (
                <div className="kb-panel__error" role="alert">
                  <p>{t("contentServer.graph.error")}</p>
                  <button type="button" className="vm-btn" onClick={retry}>
                    {t("contentServer.action.retry")}
                  </button>
                </div>
              )}
            />
          ) : (
            <iframe
              className="kb-panel__frame"
              title={t("contentServer.title")}
              src={iframeUrl ?? url}
              sandbox="allow-scripts allow-same-origin"
            />
          )}
        </>
      )}
    </section>
  );
}
