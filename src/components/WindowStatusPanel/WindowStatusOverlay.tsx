/**
 * WindowStatusOverlay (#1057) — app-level mount for the Window-Status panel.
 *
 * Registered in App.tsx's overlay slot (ADR-007 — no shell edits). Renders the
 * panel as a docked surface when `windowStatusStore.panelOpen` is set.
 *
 * @module components/WindowStatusPanel/WindowStatusOverlay
 */
import { useWindowStatusStore, selectPanelOpen } from "@/stores/windowStatusStore";
import { WindowStatusPanel } from "./WindowStatusPanel";
import "./window-status-overlay.css";

export function WindowStatusOverlay() {
  const open = useWindowStatusStore(selectPanelOpen);
  if (!open) return null;
  return (
    <div className="window-status-overlay" data-testid="window-status-overlay">
      <WindowStatusPanel />
    </div>
  );
}
