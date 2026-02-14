/**
 * Sidebar Resize Hook
 *
 * Purpose: Drag-to-resize handler for the sidebar panel — clamps width
 *   to min/max bounds and cleans up listeners on blur/unmount.
 *
 * @coordinates-with uiStore.ts — reads/writes sidebarWidth
 * @module hooks/useSidebarResize
 */

import { useCallback, useRef, useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";

/** Sidebar width constraints in pixels */
const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 500;

/**
 * Hook for handling sidebar resize via drag handle.
 *
 * Features:
 * - Clamps width to MIN/MAX bounds
 * - Cleans up listeners on blur/unmount to prevent leaks
 * - Prevents text selection during drag
 *
 * @returns handleResizeStart - onMouseDown handler for the resize handle
 */
export function useSidebarResize() {
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Store references for cleanup
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: (() => void) | null;
  }>({ move: null, up: null });

  /** Clamp width to valid range */
  const clampWidth = useCallback((width: number): number => {
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));
  }, []);

  /** Clean up listeners and styles */
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

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = useUIStore.getState().sidebarWidth;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = e.clientX - startX.current;
        const newWidth = clampWidth(startWidth.current + delta);
        useUIStore.getState().setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        cleanup();
      };

      // Store references for cleanup
      handlersRef.current = { move: handleMouseMove, up: handleMouseUp };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      // Also cleanup on window blur (user switches away mid-drag)
      window.addEventListener("blur", handleMouseUp);

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [clampWidth, cleanup]
  );

  return handleResizeStart;
}
