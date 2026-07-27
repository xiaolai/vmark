/**
 * useTerminalResize
 *
 * Purpose: Hook for drag-to-resize on the terminal panel's edge. Works for all
 * four panel positions (top/bottom/left/right); the grow direction is derived
 * from the position (see the hook doc below).
 *
 * Key decisions:
 *   - Uses the handlersRef cleanup pattern (stores mousemove/mouseup references)
 *     to ensure exact listener removal on mouseup, blur, or unmount.
 *   - Grow sign flips per side: right/bottom grow on negative client delta;
 *     left/top grow on positive (their handle is on the far edge).
 *   - Sets document.body cursor during drag and disables text selection.
 *   - Caps the live size at 50% of available space (TERMINAL_MAX_RATIO); the
 *     store setters only enforce the absolute pixel floor.
 *   - Calls onResize callback on every move to let the parent refit xterm.
 *   - On drag end, computes the ratio from final pixel / available dimension
 *     and persists it to settingsStore.
 *   - `toggleMaximize` (WI-4.5/F6) snaps the panel to the cap and back to the
 *     STORED ratio, without rewriting that ratio. The persisted size stops at
 *     50% on purpose (the editor must stay usable); the real need behind
 *     "I want 80%" is temporary, so this is a view toggle, not a setting.
 *
 * @coordinates-with TerminalPanel.tsx — attaches handleResizeStart to the resize handle
 * @coordinates-with uiStore — updates terminalHeight / terminalWidth during drag
 * @coordinates-with settingsStore — persists panelRatio on drag end
 * @coordinates-with useTerminalPosition.ts — pixelsToRatio / getAvailableDimension helpers
 * @module components/Terminal/useTerminalResize
 */
import { useCallback, useRef, useEffect } from "react";
import { useUIStore, TERMINAL_MAX_RATIO, type EffectiveTerminalPosition } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  pixelsToRatio,
  getAvailableDimension,
  isHorizontalTerminalAxis,
  currentShellSideWidth,
} from "./useTerminalPosition";

/**
 * Hook providing drag-to-resize behavior for the terminal panel edge.
 *
 * The handle sits on the edge adjacent to the editor, so the drag direction
 * that *grows* the panel depends on which side the panel is on:
 *   - right / bottom: handle on the near (left/top) edge → drag toward the
 *     editor (left/up) grows it (negative client delta = larger).
 *   - left / top: handle on the far (right/bottom) edge → drag away from the
 *     editor (right/down) grows it (positive client delta = larger).
 */
export interface TerminalResizeControls {
  /** mousedown handler for the drag handle. */
  handleResizeStart: (e: React.MouseEvent) => void;
  /** Snap to the cap, or back to the persisted ratio if already maximized. */
  toggleMaximize: () => void;
}

export function useTerminalResize(
  position: EffectiveTerminalPosition,
  onResize?: () => void
): TerminalResizeControls {
  const horizontal = isHorizontalTerminalAxis(position);
  // right/bottom grow on negative client delta; left/top grow on positive.
  const growSign = position === "right" || position === "bottom" ? -1 : 1;
  const isResizing = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  // Whether the pointer actually moved during this press. A double-click
  // delivers two full mousedown/mouseup pairs, and persisting on every mouseup
  // would write the CURRENT size back as the stored ratio — so the second
  // double-click would save the maximized 0.5 and "restore" would become a
  // no-op. Only a real drag may change the persisted size.
  const didDrag = useRef(false);

  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: (() => void) | null;
  }>({ move: null, up: null });

  const cleanup = useCallback(() => {
    isResizing.current = false;
    if (handlersRef.current.move) {
      document.removeEventListener("mousemove", handlersRef.current.move);
    }
    if (handlersRef.current.up) {
      document.removeEventListener("mouseup", handlersRef.current.up);
      window.removeEventListener("blur", handlersRef.current.up);
    }
    handlersRef.current = { move: null, up: null };
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      didDrag.current = false;

      const ui = useUIStore.getState();
      if (horizontal) {
        startPos.current = e.clientX;
        startSize.current = ui.terminalWidth;
      } else {
        startPos.current = e.clientY;
        startSize.current = ui.terminalHeight;
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing.current) return;

        const ui = useUIStore.getState();
        // Cap live drag at 50% of available space (TERMINAL_MAX_RATIO); the
        // store setters only enforce the pixel floor.
        const available = getAvailableDimension(
          ui.effectiveTerminalPosition,
          window.innerWidth,
          window.innerHeight,
          currentShellSideWidth(),
        );
        const maxPixels = available * TERMINAL_MAX_RATIO;

        if (horizontal) {
          // growSign flips drag direction for left vs right panels.
          const delta = (e.clientX - startPos.current) * growSign;
          if (delta !== 0) didDrag.current = true;
          ui.setTerminalWidth(Math.min(maxPixels, startSize.current + delta));
        } else {
          const delta = (e.clientY - startPos.current) * growSign;
          if (delta !== 0) didDrag.current = true;
          ui.setTerminalHeight(Math.min(maxPixels, startSize.current + delta));
        }
        onResize?.();
      };

      const handleMouseUp = () => {
        // A press with no movement is a click, not a resize — persisting there
        // would overwrite the user's stored ratio with whatever the panel
        // happens to measure right now (see `didDrag`).
        if (!didDrag.current) {
          cleanup();
          return;
        }
        // Persist ratio from final pixel size
        const ui = useUIStore.getState();
        const pos = ui.effectiveTerminalPosition;
        const pixels = isHorizontalTerminalAxis(pos) ? ui.terminalWidth : ui.terminalHeight;
        const available = getAvailableDimension(
          pos,
          window.innerWidth,
          window.innerHeight,
          currentShellSideWidth(),
        );
        const ratio = pixelsToRatio(pixels, available);
        useSettingsStore.getState().updateTerminalSetting("panelRatio", ratio);

        cleanup();
      };

      handlersRef.current = { move: handleMouseMove, up: handleMouseUp };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleMouseUp);

      document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [cleanup, horizontal, growSign, onResize]
  );

  /**
   * Toggle between the persisted ratio and the cap (WI-4.5). Deliberately does
   * NOT write `panelRatio`: restoring must land on whatever the user chose,
   * and a maximize should not silently become their new default.
   */
  const toggleMaximize = useCallback(() => {
    const ui = useUIStore.getState();
    const pos = ui.effectiveTerminalPosition;
    const horizontalAxis = isHorizontalTerminalAxis(pos);
    const available = getAvailableDimension(
      pos,
      window.innerWidth,
      window.innerHeight,
      currentShellSideWidth(),
    );
    if (available <= 0) return;

    const maxPixels = Math.round(available * TERMINAL_MAX_RATIO);
    const current = horizontalAxis ? ui.terminalWidth : ui.terminalHeight;
    const storedRatio = useSettingsStore.getState().terminal.panelRatio;
    // Within a pixel of the cap counts as maximized — rounding must not make
    // the toggle a one-way trip.
    const maximized = Math.abs(current - maxPixels) <= 1;
    const target = maximized
      ? Math.round(available * Math.min(storedRatio, TERMINAL_MAX_RATIO))
      : maxPixels;

    if (horizontalAxis) ui.setTerminalWidth(target);
    else ui.setTerminalHeight(target);
    // Deliberately NOT calling onResize: the store write above already drives
    // TerminalPanel's width/height effect, which refits. Calling it too would
    // schedule the same fit twice for one toggle.
  }, []);

  return { handleResizeStart, toggleMaximize };
}
