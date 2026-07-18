/**
 * ClaimOverlay (WI-2b.6) — app-level mount for the claim panel.
 * Registered in App.tsx's overlay slot (ADR-007 — no shell edits).
 *
 * @module components/ClaimPanel/ClaimOverlay
 */
import { useClaimStore } from "@/stores/claimStore";
import { ClaimPanel } from "./ClaimPanel";
import { useBrowserOccluder } from "@/hooks/useBrowserOccluder";

export function ClaimOverlay() {
  const open = useClaimStore((s) => s.panelOpen);
  useBrowserOccluder(open, "claims");
  if (!open) return null;
  return (
    <div className="claim-overlay" data-testid="claim-overlay">
      <ClaimPanel />
    </div>
  );
}
