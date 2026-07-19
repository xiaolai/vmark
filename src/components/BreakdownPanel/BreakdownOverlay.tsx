/**
 * BreakdownOverlay (WI-1.9b) — app-level mount for the Breakdown panel.
 *
 * Registered in App.tsx's overlay slot (ADR-007 — no shell edits). Renders
 * the panel as a docked surface when `breakdownStore.panelOpen` is set.
 *
 * @module components/BreakdownPanel/BreakdownOverlay
 */
import { useBreakdownStore, selectPanelOpen } from "@/stores/breakdownStore";
import { BreakdownPanel } from "./BreakdownPanel";
import "./breakdown-overlay.css";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";

export function BreakdownOverlay() {
  const open = useBreakdownStore(selectPanelOpen);
  // The native browser view paints over all React DOM in its rect, so freeze every
  // mounted browser tab while this overlay is up (WI-SOC.1).
  useBrowserOccluder(open, "breakdown");
  if (!open) return null;
  return (
    <div className="breakdown-overlay" data-testid="breakdown-overlay">
      <BreakdownPanel />
    </div>
  );
}
