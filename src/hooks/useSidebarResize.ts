/**
 * Sidebar Resize Hook
 *
 * Purpose: Resize handlers for the sidebar panel — drag (mouse) and
 *   keyboard arrows (a11y). Clamps width to min/max bounds and cleans
 *   up drag listeners on blur/unmount.
 *
 * @coordinates-with uiStore.ts — reads/writes sidebarWidth
 * @module hooks/useSidebarResize
 */

import { useCallback, useRef, useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";

/** Sidebar width constraints in pixels */
export const MIN_SIDEBAR_WIDTH = 150;
export const MAX_SIDEBAR_WIDTH = 500;
/** Keyboard resize step per arrow press */
export const KEYBOARD_RESIZE_STEP = 8;
/** Larger step when Shift is held */
export const KEYBOARD_RESIZE_STEP_LARGE = 32;

/**
 * Hook for handling sidebar resize via drag (mouse) and keyboard arrows.
 *
 * Features:
 * - Clamps width to MIN/MAX bounds
 * - Cleans up drag listeners on blur/unmount to prevent leaks
 * - Prevents text selection during drag
 * - WI-2.2 (a11y): arrow-key resize for keyboard users
 *
 * Returns both:
 * - `handleResizeStart` — onMouseDown handler for drag
 * - `handleResizeKeyDown` — onKeyDown handler: ArrowLeft/Right step by
 *   KEYBOARD_RESIZE_STEP (Shift = KEYBOARD_RESIZE_STEP_LARGE); Home/End
 *   clamp to MIN/MAX
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

  // WI-2.2 — keyboard resize for screen-reader and keyboard-only users.
  // Arrows step by KEYBOARD_RESIZE_STEP (Shift = LARGE); Home/End clamp.
  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const current = useUIStore.getState().sidebarWidth;
      const step = e.shiftKey
        ? KEYBOARD_RESIZE_STEP_LARGE
        : KEYBOARD_RESIZE_STEP;
      let next: number | null = null;

      switch (e.key) {
        case "ArrowLeft":
          next = current - step;
          break;
        case "ArrowRight":
          next = current + step;
          break;
        case "Home":
          next = MIN_SIDEBAR_WIDTH;
          break;
        case "End":
          next = MAX_SIDEBAR_WIDTH;
          break;
        default:
          return;
      }

      e.preventDefault();
      useUIStore.getState().setSidebarWidth(clampWidth(next));
    },
    [clampWidth],
  );

  return { handleResizeStart, handleResizeKeyDown };
}
