/**
 * KnowledgeBaseOverlay (Phase 5; grill H7) — app-level mount for the KB panel.
 *
 * Registered in App.tsx's `overlays` slot (ADR-007 — no edits to the shell).
 * Renders the panel as a right-docked surface when the store's `panelOpen` is
 * set, wiring the `useContentServer` controls into the presentational panel.
 *
 * @module components/KnowledgeBasePanel/KnowledgeBaseOverlay
 */

import { useContentServerStore, selectPanelOpen } from "@/stores/contentServerStore";
import { useContentServer } from "@/hooks/useContentServer";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import "./knowledge-base-overlay.css";

export function KnowledgeBaseOverlay() {
  const open = useContentServerStore(selectPanelOpen);
  const { start, stop, openInBrowser, previewSlides, exportSlides } = useContentServer();
  if (!open) return null;
  return (
    <div className="kb-overlay" data-testid="kb-overlay">
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
