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
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useUIStore } from "@/stores/uiStore";

/** Sidebar width constraints in pixels — ONE owner: the store's canonical
 * bounds (audit 20260829: this hook said 150/500 while setSidebarWidth
 * enforced 180/480, so Home/End and the ARIA range exposed values the store
 * would immediately reject). */
export const MIN_SIDEBAR_WIDTH = SIDEBAR_MIN_WIDTH;
export const MAX_SIDEBAR_WIDTH = SIDEBAR_MAX_WIDTH;
/** Keyboard resize step per arrow press */
const KEYBOARD_RESIZE_STEP = 8;
/** Larger step when Shift is held */
const KEYBOARD_RESIZE_STEP_LARGE = 32;

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
  // Finding 3 (audit 20260829): the viewport cap only ran during interaction,
  // so a restored wide sidebar kept its width when the WINDOW narrowed.
  // Reclamp the stored width on resize (and once on mount).
  useEffect(() => {
    const reclamp = () => {
      const current = useUIStore.getState().sidebarWidth;
      const viewportMax = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 480);
      const next = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportMax, current));
      if (next !== current) useUIStore.getState().setSidebarWidth(next);
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  const clampWidth = useCallback((width: number): number => {
    // WI-UI4.10: also clamp against the live viewport — a fixed 500px max
    // could swallow the editor on a narrow window. 480px is the editor's
    // keep-alive floor (rail + margins + a readable column).
    const viewportMax = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 480);
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportMax, width));
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
      // A mousedown can arrive while a previous drag's listeners are still
      // attached (e.g. mouseup outside the window was never delivered).
      // Without this, handlersRef is overwritten and the previous
      // mousemove/mouseup/blur listeners leak — firing alongside the new
      // ones and doubling store writes per pointer move.
      cleanup();
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
      let next: number;

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
