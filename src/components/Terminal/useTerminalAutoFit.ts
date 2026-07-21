/**
 * useTerminalAutoFit
 *
 * Purpose: Keep the active xterm fitted to whatever box its container actually
 * has, by observing the container instead of guessing when it changed.
 *
 * Why an observer rather than a state-change effect: `.terminal-panel` animates
 * its width/height (`transition: width var(--duration-medium)`). A fit scheduled
 * one frame after the React state change measures the container mid-animation —
 * roughly its pre-resize size — and nothing refits once the transition lands, so
 * the shell keeps wrapping at the old column count. The observer also covers the
 * cross-axis case the state effect structurally misses: a right/left panel's
 * width is unchanged by a window *height* resize (and a top/bottom panel's
 * height by a *width* resize), so no state updates and no refit fires, even
 * though the panel's other dimension moved.
 *
 * Key decisions:
 *   - Fits are coalesced onto one animation frame. ResizeObserver can fire
 *     several times per frame during a live window drag, and each fit that
 *     changes cols costs an xterm buffer reflow.
 *   - The fit callback is read through a ref, so a new callback identity never
 *     tears down and re-creates the observer mid-resize.
 *   - Absent ResizeObserver (jsdom without a shim) the hook is a no-op; the
 *     panel's own show/resize effect remains the fallback path.
 *
 * @coordinates-with TerminalPanel.tsx — owns the container ref and the fit callback
 * @coordinates-with useTerminalSessions.ts — supplies fit() (xterm fit + PTY resize)
 * @module components/Terminal/useTerminalAutoFit
 */
import { useEffect, useRef, type RefObject } from "react";

/**
 * Refit the terminal whenever `containerRef`'s box changes.
 *
 * @param containerRef Element xterm renders into.
 * @param fit          Fits the active session and propagates dims to its PTY.
 * @param active       Whether the container is mounted. The panel defers xterm
 *                     activation until first shown, so this doubles as the
 *                     dependency that (re)attaches the observer once it exists.
 */
export function useTerminalAutoFit(
  containerRef: RefObject<HTMLElement | null>,
  fit: () => void,
  active = true
): void {
  const fitRef = useRef(fit);
  // Synced after commit — the observer only reads it from a frame callback.
  useEffect(() => {
    fitRef.current = fit;
  });

  useEffect(() => {
    const el = active ? containerRef.current : null;
    if (!el || typeof ResizeObserver === "undefined") return;

    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        fitRef.current();
      });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [containerRef, active]);
}
