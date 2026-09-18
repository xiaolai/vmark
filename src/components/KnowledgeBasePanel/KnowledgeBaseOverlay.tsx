/**
 * KnowledgeBaseOverlay (Phase 5; grill H7) — app-level mount for the KB panel.
 *
 * Rendered into EditorArea's `sidePanel` slot, so it is an IN-FLOW right dock:
 * opening it displaces the editor. It was previously a `position: fixed`
 * overlay in App.tsx's `overlays` slot, which occluded the document — text
 * vanished behind a 420px panel and the editor never reflowed.
 *
 * Wires the `useContentServer` controls into the presentational panel and
 * renders nothing when the store's `panelOpen` is unset.
 *
 * It also CLOSES itself when the feature stops being available (#1425). The
 * panel carries no close button: it is opened and closed by the View menu item,
 * the palette command and `Ctrl + Shift + 4`, and all three are gated by
 * `knowledgeBaseAvailableHere`. Turning Developer Mode off with the dock open
 * would therefore leave a panel nothing could close. The running server is left
 * alone — turning Developer Mode back on reaches its Stop button again, and
 * `quit.rs` kills content servers at exit either way.
 *
 * @coordinates-with services/contentServer/availability — the shared predicate
 * @module components/KnowledgeBasePanel/KnowledgeBaseOverlay
 */

import { useEffect } from "react";
import { useContentServerStore, selectPanelOpen } from "@/stores/contentServerStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { selectKnowledgeBaseAvailable } from "@/services/contentServer/availability";
import { useContentServer } from "@/hooks/useContentServer";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import "./knowledge-base-overlay.css";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";

export function KnowledgeBaseOverlay() {
  const open = useContentServerStore(selectPanelOpen);
  const available = useSettingsStore(selectKnowledgeBaseAvailable);
  useEffect(() => {
    if (open && !available) useContentServerStore.getState().setPanelOpen(false);
  }, [open, available]);
  // The native browser view paints over all React DOM in its rect, so freeze every
  // mounted browser tab while this overlay is up (WI-SOC.1).
  useBrowserOccluder(open, "knowledge-base");
  const { start, stop, openInBrowser, previewSlides, exportSlides } = useContentServer();
  if (!open) return null;
  return (
    <div className="kb-dock" data-testid="kb-dock">
      {/* `void` is honest here, not a silencer: every one of these controls
          resolves — `useContentServer` catches its own failures and routes them
          to the store's `error`, which the panel renders. The panel's props are
          `() => void` because it hands them straight to `onClick`, which cannot
          await. */}
      <KnowledgeBasePanel
        onStart={() => void start()}
        onStop={() => void stop()}
        onOpenInBrowser={() => void openInBrowser()}
        onPreviewSlides={() => void previewSlides()}
        onExportSlides={() => void exportSlides()}
      />
    </div>
  );
}
