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
 * @module components/KnowledgeBasePanel/KnowledgeBaseOverlay
 */

import { useContentServerStore, selectPanelOpen } from "@/stores/contentServerStore";
import { useContentServer } from "@/hooks/useContentServer";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import "./knowledge-base-overlay.css";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";

export function KnowledgeBaseOverlay() {
  const open = useContentServerStore(selectPanelOpen);
  // The native browser view paints over all React DOM in its rect, so freeze every
  // mounted browser tab while this overlay is up (WI-SOC.1).
  useBrowserOccluder(open, "knowledge-base");
  const { start, stop, openInBrowser, previewSlides, exportSlides } = useContentServer();
  if (!open) return null;
  return (
    <div className="kb-dock" data-testid="kb-dock">
      <KnowledgeBasePanel
        onStart={start}
        onStop={stop}
        onOpenInBrowser={openInBrowser}
        onPreviewSlides={previewSlides}
        onExportSlides={exportSlides}
      />
    </div>
  );
}
