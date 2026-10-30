/**
 * KnowledgeBasePanel lifecycle views (audit 20260907, #318) — one component
 * per server state, so the panel itself is a dispatcher over `status` and
 * each view owns its own markup:
 *
 *   - `KnowledgeBaseProgress` — starting (and any status whose detail has
 *     not landed yet);
 *   - `KnowledgeBaseError` — the failure line and its Retry;
 *   - `KnowledgeBaseRunning` — the toolbar (site/graph, slides, open in
 *     browser, stop) over the graph view or the served iframe.
 *
 * The stopped state lives in `KnowledgeBaseRuntimeState`. The graph
 * view stays behind `RetryableLazy` here for the reason the panel's header
 * gives: React.lazy caches a chunk-load rejection forever.
 *
 * @coordinates-with ./KnowledgeBasePanel.tsx — the dispatcher
 * @coordinates-with src/stores/contentServerStore.ts — status, url, view mode
 * @module components/KnowledgeBasePanel/KnowledgeBasePanelViews
 */
import { useEffect, useRef, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { RetryableLazy } from "@/components/RetryableLazy";
import { useContentServerStore, type KbViewMode } from "@/stores/contentServerStore";

/** Loads the graph chunk; each call is a fresh attempt. */
export type KbGraphLoader = () => Promise<{ default: ComponentType }>;

const loadKbGraphView: KbGraphLoader = () =>
  import("./KbGraphView").then((m) => ({ default: m.KbGraphView }));

/** The in-progress line: the server is starting, or its detail has not landed. */
export function KnowledgeBaseProgress() {
  const { t } = useTranslation();
  return (
    <div className="kb-panel__progress" role="status">
      {t("contentServer.status.starting")}
    </div>
  );
}

/**
 * The failure line and its Retry.
 *
 * `error` is nullable because the store's is, and a null one rendered an alert
 * holding nothing but a button — an announced "alert" with no message in it.
 * A localized fallback is the honest floor: something
 * failed, the panel just was not told what.
 */
export function KnowledgeBaseError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="kb-panel__error" role="alert">
      <p>{error ?? t("contentServer.error.unknown")}</p>
      <button type="button" className="vm-btn" onClick={onRetry}>
        {t("contentServer.action.retry")}
      </button>
    </div>
  );
}

export interface KnowledgeBaseRunningProps {
  url: string;
  iframeUrl: string | null;
  viewMode: KbViewMode;
  onStop: () => void;
  onOpenInBrowser: () => void;
  onPreviewSlides: () => void;
  onExportSlides: () => void;
  /**
   * The graph chunk's loader. Defaults to the real dynamic import; a parameter
   * because a module registry never re-fails a module that resolved once, and
   * the failed-then-retried load is behaviour that has to be testable.
   */
  loadGraph?: KbGraphLoader;
}

/** One toolbar control: a label key, what it does, and whether it reads pressed. */
interface ToolbarButton {
  key: string;
  labelKey: string;
  onClick: () => void;
  pressed?: boolean;
}

/** A toolbar entry — a control, or the gap that pushes the rest to the end. */
type ToolbarEntry = ToolbarButton | "spacer";

/**
 * The toolbar, from descriptors rather than six hand-written buttons.
 *
 * All six were the same `type`/`className`/`onClick`/label shape, and the two
 * view-mode ones differed only by which `aria-pressed` they carried — so the
 * markup that makes a control a control lived in six places, and a change to
 * any of it (the button primitive, the pressed state, a focus rule) had six
 * chances to be applied five times.
 */
function KnowledgeBaseToolbar({ entries }: { entries: ToolbarEntry[] }) {
  const { t } = useTranslation();
  return (
    <div className="kb-panel__toolbar">
      {entries.map((entry) =>
        entry === "spacer" ? (
          <span key="spacer" className="kb-panel__spacer" />
        ) : (
          <button
            key={entry.key}
            type="button"
            className="vm-btn"
            {...(entry.pressed === undefined ? {} : { "aria-pressed": entry.pressed })}
            onClick={entry.onClick}
          >
            {t(entry.labelKey)}
          </button>
        ),
      )}
    </div>
  );
}

export function KnowledgeBaseRunning({
  url,
  iframeUrl,
  viewMode,
  onStop,
  onOpenInBrowser,
  onPreviewSlides,
  onExportSlides,
  loadGraph = loadKbGraphView,
}: KnowledgeBaseRunningProps) {
  const { t } = useTranslation();
  const setViewMode = (mode: KbViewMode) =>
    useContentServerStore.getState().setViewMode(mode);
  const entries: ToolbarEntry[] = [
    { key: "site", labelKey: "contentServer.view.site", onClick: () => setViewMode("site"), pressed: viewMode === "site" },
    { key: "graph", labelKey: "contentServer.view.graph", onClick: () => setViewMode("graph"), pressed: viewMode === "graph" },
    "spacer",
    { key: "preview", labelKey: "contentServer.slidev.preview", onClick: onPreviewSlides },
    { key: "export", labelKey: "contentServer.slidev.export", onClick: onExportSlides },
    { key: "browser", labelKey: "contentServer.action.openInBrowser", onClick: onOpenInBrowser },
    { key: "stop", labelKey: "contentServer.action.stop", onClick: onStop },
  ];
  return (
    <>
      <KnowledgeBaseToolbar entries={entries} />
      {viewMode === "graph" ? (
        <RetryableLazy
          feature="Knowledge base graph"
          load={loadGraph}
          componentProps={{}}
          // Same placeholder the graph itself uses while fetching, so chunk
          // load and data load read as one continuous state.
          pending={<div className="kb-graph__loading" data-testid="kb-graph-pending" />}
          renderError={(retry) => <KnowledgeBaseError error={t("contentServer.graph.error")} onRetry={retry} />}
        />
      ) : (
        <KbSiteFrame url={url} iframeUrl={iframeUrl} />
      )}
    </>
  );
}

/**
 * The served site in an iframe.
 *
 * `iframeUrl` is the ONE-TIME `/__auth?t=<nonce>` link (grill M2): the first
 * navigation trades it for the session cookie and BURNS the nonce. Switching to
 * the graph unmounts this frame, so coming back used to mount a fresh one on
 * the same spent link. It is therefore cleared once this frame
 * has actually loaded — the only evidence the handshake happened — and a later
 * mount loads `url`, which the cookie now authenticates. Cleared on UNMOUNT
 * rather than on load, so the frame that just authenticated is not re-rendered
 * with a different `src` and reloaded for nothing.
 */
function KbSiteFrame({ url, iframeUrl }: { url: string; iframeUrl: string | null }) {
  const { t } = useTranslation();
  const loadedRef = useRef(false);
  useEffect(
    () => () => {
      if (loadedRef.current && useContentServerStore.getState().iframeUrl !== null) {
        useContentServerStore.getState().setIframeUrl(null);
      }
    },
    [],
  );
  return (
    <iframe
      className="kb-panel__frame"
      title={t("contentServer.title")}
      src={iframeUrl ?? url}
      onLoad={() => {
        loadedRef.current = true;
      }}
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
