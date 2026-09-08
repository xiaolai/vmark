/**
 * KnowledgeBasePanel lifecycle views (audit 20260907, #318) — one component
 * per server state, so the panel itself is a dispatcher over `status` and
 * each view owns its own markup:
 *
 *   - `KnowledgeBaseProgress` — provisioning (with the download percentage)
 *     and starting;
 *   - `KnowledgeBaseError` — the failure line and its Retry;
 *   - `KnowledgeBaseRunning` — the toolbar (site/graph, slides, open in
 *     browser, stop) over the graph view or the served iframe.
 *
 * The stopped state lives in `KnowledgeBaseRuntimeState` (WI-FL1.1). The graph
 * view stays behind `RetryableLazy` here for the reason the panel's header
 * gives: React.lazy caches a chunk-load rejection forever.
 *
 * @coordinates-with ./KnowledgeBasePanel.tsx — the dispatcher
 * @coordinates-with src/stores/contentServerStore.ts — status, provision, url, view mode
 * @module components/KnowledgeBasePanel/KnowledgeBasePanelViews
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RetryableLazy } from "@/components/RetryableLazy";
import {
  useContentServerStore,
  type ProvisionProgress,
  type KbViewMode,
} from "@/stores/contentServerStore";

const loadKbGraphView = () =>
  import("./KbGraphView").then((m) => ({ default: m.KbGraphView }));

/**
 * 0–100 from an untrusted byte-count pair (audit #319): a non-positive or
 * non-finite total is 0%, and a stream that over-reports never shows >100%.
 */
function downloadPercent({ received, total }: ProvisionProgress): number {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return 0;
  const done = typeof received === "number" && Number.isFinite(received) ? received : 0;
  return Math.min(100, Math.max(0, Math.floor((100 * done) / total)));
}

export function KnowledgeBaseProgress({ provision }: { provision: ProvisionProgress | null }) {
  const { t } = useTranslation();
  let label: string;
  if (!provision) {
    label = t("contentServer.status.starting");
  } else if (provision.phase === "downloading") {
    label = t("contentServer.provision.downloading", { percent: downloadPercent(provision) });
  } else {
    label = t(`contentServer.provision.${provision.phase}`);
  }
  return (
    <div className="kb-panel__progress" role="status">
      {label}
    </div>
  );
}

/**
 * The failure line and its Retry.
 *
 * `error` is nullable because the store's is, and a null one rendered an alert
 * holding nothing but a button — an announced "alert" with no message in it
 * (audit round 3, #628). A localized fallback is the honest floor: something
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
 * chances to be applied five times (audit round 3, #630).
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
          load={loadKbGraphView}
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
 * the same spent link (audit R2, #631). It is therefore cleared once this frame
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
