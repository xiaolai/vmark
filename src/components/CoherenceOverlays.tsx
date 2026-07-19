/**
 * CoherenceOverlays (WI-2b.6) — bundles the coherence-layer overlay
 * mounts (Breakdown + Claims) into one App-level slot so growing the
 * semantic layer never grows App.tsx (ADR-007 spirit).
 *
 * @module components/CoherenceOverlays
 */
import { BreakdownOverlay } from "@/components/BreakdownPanel/BreakdownOverlay";
import { ClaimOverlay } from "@/components/ClaimPanel/ClaimOverlay";

export function CoherenceOverlays() {
  return (
    <>
      <BreakdownOverlay />
      <ClaimOverlay />
    </>
  );
}
