/**
 * KnowledgeBasePanel (Phase 5) — in-app surface for the content server.
 *
 * Pure presentation: reads lifecycle state from `contentServerStore` via
 * selectors and renders the matching view (empty/provisioning/starting/running/
 * error). When running, it embeds the KB site (served on loopback) in an
 * iframe and offers "open in browser". Actions are injected so the panel stays
 * free of store/service wiring (the `useContentServer` hook supplies them).
 *
 * Registered into AppShell as a slot (ADR-007); never edits App.tsx.
 *
 * @module components/KnowledgeBasePanel
 */

import { useTranslation } from "react-i18next";
import {
  useContentServerStore,
  selectServerStatus,
  selectServerUrl,
  selectProvision,
  selectError,
  selectIframeUrl,
  selectViewMode,
} from "@/stores/contentServerStore";
import { KbGraphView } from "./KbGraphView";
import "./knowledge-base-panel.css";

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
          <button type="button" className="kb-panel__btn" onClick={onStart}>
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
          <button type="button" className="kb-panel__btn" onClick={onStart}>
            {t("contentServer.action.retry")}
          </button>
        </div>
      )}

      {status === "running" && url && (
        <>
          <div className="kb-panel__toolbar">
            <button
              type="button"
              className="kb-panel__btn"
              aria-pressed={viewMode === "site"}
              onClick={() => useContentServerStore.getState().setViewMode("site")}
            >
              {t("contentServer.view.site")}
            </button>
            <button
              type="button"
              className="kb-panel__btn"
              aria-pressed={viewMode === "graph"}
              onClick={() => useContentServerStore.getState().setViewMode("graph")}
            >
              {t("contentServer.view.graph")}
            </button>
            <span className="kb-panel__spacer" />
            <button type="button" className="kb-panel__btn" onClick={onPreviewSlides}>
              {t("contentServer.slidev.preview")}
            </button>
            <button type="button" className="kb-panel__btn" onClick={onExportSlides}>
              {t("contentServer.slidev.export")}
            </button>
            <button type="button" className="kb-panel__btn" onClick={onOpenInBrowser}>
              {t("contentServer.action.openInBrowser")}
            </button>
            <button type="button" className="kb-panel__btn" onClick={onStop}>
              {t("contentServer.action.stop")}
            </button>
          </div>
          {viewMode === "graph" ? (
            <KbGraphView />
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
