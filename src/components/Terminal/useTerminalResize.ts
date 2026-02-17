/**
 * useTerminalResize
 *
 * Purpose: Hook for drag-to-resize on the terminal panel's edge.
 * Supports both vertical (bottom panel — drag top edge) and horizontal
 * (right panel — drag left edge) resize directions.
 *
 * Key decisions:
 *   - Uses the handlersRef cleanup pattern (stores mousemove/mouseup references)
 *     to ensure exact listener removal on mouseup, blur, or unmount.
 *   - Vertical: dragging up increases height (negative Y delta = taller).
 *   - Horizontal: dragging left increases width (negative X delta = wider).
 *   - Sets document.body cursor during drag and disables text selection.
 *   - Calls onResize callback on every move to let the parent refit xterm.
 *
 * @coordinates-with TerminalPanel.tsx — attaches handleResizeStart to the resize handle
 * @coordinates-with uiStore — persists terminalHeight / terminalWidth
 * @module components/Terminal/useTerminalResize
 */
import { useCallback, useRef, useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";

export type ResizeDirection = "vertical" | "horizontal";

export function useTerminalResize(
  direction: ResizeDirection,
  onResize?: () => void
) {
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
      if (direction === "horizontal") {
        startPos.current = e.clientX;
        startSize.current = ui.terminalWidth;
      } else {
        startPos.current = e.clientY;
        startSize.current = ui.terminalHeight;
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing.current) return;

        if (direction === "horizontal") {
          // Drag left = wider (negative X delta = more width)
          const delta = startPos.current - e.clientX;
          useUIStore.getState().setTerminalWidth(startSize.current + delta);
        } else {
          // Drag up = taller (negative Y delta = more height)
          const delta = startPos.current - e.clientY;
          useUIStore.getState().setTerminalHeight(startSize.current + delta);
        }
        onResize?.();
      };

      const handleMouseUp = () => {
        cleanup();
      };

      handlersRef.current = { move: handleMouseMove, up: handleMouseUp };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleMouseUp);

      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [cleanup, direction, onResize]
  );

  return handleResizeStart;
}
