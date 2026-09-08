/**
 * KnowledgeBasePanel (Phase 5) — in-app surface for the content server.
 *
 * Pure presentation: reads lifecycle state from `contentServerStore` via
 * selectors and renders the matching view (empty/provisioning/starting/running/
 * error). When running, it embeds the KB site (served on loopback) in an
 * iframe and offers "open in browser". Actions are injected so the panel stays
 * free of store/service wiring (the `useContentServer` hook supplies them).
 *
 * The one exception is deliberate (WI-FL1.1): on open the panel probes
 * `content_server_runtime` through `useContentServerRuntime` and, while
 * stopped, renders `KnowledgeBaseRuntimeState` — the Start button only when
 * `node` and the content-server CLI are both present, otherwise an alert naming
 * what is missing and what would provide it. No release build ships the CLI
 * today (plan decision D1), so without this every packaged install offered a
 * Start that ended in `not-found`.
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
 * The lifecycle views (provisioning/starting, error, running) are one component
 * each in `KnowledgeBasePanelViews.tsx`; this file dispatches on `status` — as a
 * SWITCH, so every status has exactly one answer and none can fall through to
 * an empty body (audit round 3, #625).
 *
 * @coordinates-with ./KnowledgeBasePanelViews.tsx — the per-state views
 * @coordinates-with ./KnowledgeBaseRuntimeState.tsx — the stopped state
 * @module components/KnowledgeBasePanel/KnowledgeBasePanel
 */

import { useEffect, useRef } from "react";
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
import { KnowledgeBaseRuntimeState } from "./KnowledgeBaseRuntimeState";
import { KnowledgeBaseError, KnowledgeBaseProgress, KnowledgeBaseRunning } from "./KnowledgeBasePanelViews";
import { useContentServerRuntime } from "./useContentServerRuntime";
import "./knowledge-base-panel.css";

export interface KnowledgeBasePanelProps {
  onStart: () => void;
  onStop: () => void;
  onOpenInBrowser: () => void;
  onPreviewSlides: () => void;
  onExportSlides: () => void;
  /**
   * Whether this is a development build (`pnpm tauri dev`). Decides the wording
   * for a missing content-server CLI; defaults to Vite's `import.meta.env.DEV`
   * and exists as a prop so tests can render the packaged wording.
   */
  isDevBuild?: boolean;
}

export function KnowledgeBasePanel({
  onStart,
  onStop,
  onOpenInBrowser,
  onPreviewSlides,
  onExportSlides,
  isDevBuild = import.meta.env.DEV,
}: KnowledgeBasePanelProps) {
  const { t } = useTranslation();
  const { probe, recheck } = useContentServerRuntime();
  const status = useContentServerStore(selectServerStatus);
  const url = useContentServerStore(selectServerUrl);
  const provision = useContentServerStore(selectProvision);
  const error = useContentServerStore(selectError);
  const iframeUrl = useContentServerStore(selectIframeUrl);
  const viewMode = useContentServerStore(selectViewMode);

  // The probe answers "what would a start find on this machine", and a run
  // CHANGES that answer: provisioning installs the very CLI a mount-time probe
  // may have found missing. Returning to the stopped view with that stale
  // answer hides Start behind an alert about a runtime that now exists (audit
  // R2, #626). Re-asked on the way INTO stopped only — the arrival at mount is
  // the hook's own probe, and re-running it there would double every open.
  const previousStatus = useRef(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (status === "stopped" && previous !== "stopped") recheck();
  }, [status, recheck]);

  /**
   * The body for `status` — a SWITCH, so every status has exactly one answer.
   *
   * It was five independent `&&` branches, and two of them carried a second
   * condition: `provisioning && provision` and `running && url`. A status whose
   * companion value had not arrived (or had been cleared) therefore matched
   * NOTHING, and the panel rendered its header over an empty body — a dead
   * surface saying "Running" with no frame, no message and no way out (audit
   * round 3, #625). A missing companion is now a PROGRESS state, which is what
   * "the status says so but the detail has not landed" actually is.
   */
  function renderBody() {
    switch (status) {
      case "stopped":
        return (
          <div className="kb-panel__empty">
            <p>{t("contentServer.empty")}</p>
            <KnowledgeBaseRuntimeState
              probe={probe}
              isDevBuild={isDevBuild}
              onStart={onStart}
              onRecheck={recheck}
            />
          </div>
        );
      case "provisioning":
        return <KnowledgeBaseProgress provision={provision} />;
      case "starting":
        return <KnowledgeBaseProgress provision={null} />;
      case "error":
        return <KnowledgeBaseError error={error} onRetry={onStart} />;
      case "running":
        return url ? (
          <KnowledgeBaseRunning
            url={url}
            iframeUrl={iframeUrl}
            viewMode={viewMode}
            onStop={onStop}
            onOpenInBrowser={onOpenInBrowser}
            onPreviewSlides={onPreviewSlides}
            onExportSlides={onExportSlides}
          />
        ) : (
          <KnowledgeBaseProgress provision={null} />
        );
      default:
        // Unreachable while `status` is the store's union — and if that union
        // grows, this is a visible state rather than a blank pane.
        return <KnowledgeBaseProgress provision={null} />;
    }
  }

  return (
    <section className="kb-panel" aria-label={t("contentServer.title")}>
      <header className="kb-panel__header">
        <span className="kb-panel__title">{t("contentServer.title")}</span>
        <span className="kb-panel__status" data-status={status}>
          {t(`contentServer.status.${status}`)}
        </span>
      </header>

      {renderBody()}
    </section>
  );
}
