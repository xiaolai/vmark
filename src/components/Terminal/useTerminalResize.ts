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
import { pixelsToRatio, getAvailableDimension, isHorizontalTerminalAxis } from "./useTerminalPosition";

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
export function useTerminalResize(
  position: EffectiveTerminalPosition,
  onResize?: () => void
) {
  const horizontal = isHorizontalTerminalAxis(position);
  // right/bottom grow on negative client delta; left/top grow on positive.
  const growSign = position === "right" || position === "bottom" ? -1 : 1;
  const isResizing = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

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
          window.innerWidth, window.innerHeight,
          ui.sidebarVisible, ui.sidebarWidth
        );
        const maxPixels = available * TERMINAL_MAX_RATIO;

        if (horizontal) {
          // growSign flips drag direction for left vs right panels.
          const delta = (e.clientX - startPos.current) * growSign;
          ui.setTerminalWidth(Math.min(maxPixels, startSize.current + delta));
        } else {
          const delta = (e.clientY - startPos.current) * growSign;
          ui.setTerminalHeight(Math.min(maxPixels, startSize.current + delta));
        }
        onResize?.();
      };

      const handleMouseUp = () => {
        // Persist ratio from final pixel size
        const ui = useUIStore.getState();
        const pos = ui.effectiveTerminalPosition;
        const pixels = isHorizontalTerminalAxis(pos) ? ui.terminalWidth : ui.terminalHeight;
        const available = getAvailableDimension(
          pos, window.innerWidth, window.innerHeight,
          ui.sidebarVisible, ui.sidebarWidth
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

  return handleResizeStart;
}
