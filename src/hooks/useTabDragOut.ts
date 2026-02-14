/**
 * Tab Drag-Out Hook
 *
 * Purpose: Manages tab drag interactions — reorder within the tab bar
 *   or drag out to detach a tab into a new window.
 *
 * Key decisions:
 *   - Uses pointer events (not mouse) for touch support
 *   - DRAG_OUT_THRESHOLD (40px vertical) distinguishes reorder from detach
 *   - REORDER_LOCK_THRESHOLD (6px horizontal) prevents accidental reorder on click
 *   - Auto-scroll at tab bar edges during reorder
 *   - Touch hold delay (180ms) before entering drag mode on mobile
 *
 * @coordinates-with tabStore.ts — reorder and detach mutations
 * @module hooks/useTabDragOut
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Vertical distance (px) outside the tab bar to trigger drag-out. */
const DRAG_OUT_THRESHOLD = 40;
/** Horizontal distance (px) to lock into reorder mode. */
const REORDER_LOCK_THRESHOLD = 6;
const AUTO_SCROLL_EDGE_PX = 28;
const AUTO_SCROLL_MAX_STEP = 14;
const TOUCH_HOLD_DELAY_MS = 180;
const TOUCH_HOLD_CANCEL_PX = 8;

export type DragMode = "idle" | "hold" | "pending" | "reorder" | "dragout";

export interface DragOutPoint {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

export interface DragMovePayload {
  tabId: string;
  mode: Exclude<DragMode, "idle" | "hold">;
  point: DragOutPoint;
  dropIndex: number | null;
}

interface UseTabDragOptions {
  tabBarRef: RefObject<HTMLElement | null>;
  onDragOut: (tabId: string, point: DragOutPoint) => void | Promise<void>;
  onReorder: (tabId: string, toIndex: number) => void;
  onDragMove?: (payload: DragMovePayload) => void;
}

interface TabDragHandlers {
  onPointerDown: (e: ReactPointerEvent) => void;
}

interface UseTabDragResult {
  getTabDragHandlers: (tabId: string, isPinned: boolean) => TabDragHandlers;
  isDragging: boolean;
  isReordering: boolean;
  dragMode: DragMode;
  dragTabId: string | null;
  dropIndex: number | null;
  dragPoint: DragOutPoint | null;
}

/** Get the index where a dragged tab should be inserted based on cursor X. */
function calcDropIndex(bar: HTMLElement, clientX: number): number {
  const tablist = bar.querySelector("[role='tablist']");
  if (!tablist) return -1;

  const tabs = Array.from(tablist.querySelectorAll<HTMLElement>("[role='tab']"));
  if (tabs.length === 0) return -1;

  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i].getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (clientX < midX) {
      return i;
    }
  }
  return tabs.length;
}

function isOutsideVerticalBand(barTop: number, barBottom: number, clientY: number): boolean {
  return clientY > barBottom + DRAG_OUT_THRESHOLD || clientY < barTop - DRAG_OUT_THRESHOLD;
}

function calcAutoScrollDelta(tablistRect: DOMRect, clientX: number): number {
  const leftEdge = tablistRect.left + AUTO_SCROLL_EDGE_PX;
  const rightEdge = tablistRect.right - AUTO_SCROLL_EDGE_PX;
  if (clientX < leftEdge) {
    const intensity = Math.min(1, (leftEdge - clientX) / AUTO_SCROLL_EDGE_PX);
    return -Math.ceil(AUTO_SCROLL_MAX_STEP * intensity);
  }
  if (clientX > rightEdge) {
    const intensity = Math.min(1, (clientX - rightEdge) / AUTO_SCROLL_EDGE_PX);
    return Math.ceil(AUTO_SCROLL_MAX_STEP * intensity);
  }
  return 0;
}

function toPoint(ev: PointerEvent): DragOutPoint {
  return {
    clientX: ev.clientX,
    clientY: ev.clientY,
    screenX: ev.screenX,
    screenY: ev.screenY,
  };
}

export function useTabDragOut({ tabBarRef, onDragOut, onReorder, onDragMove }: UseTabDragOptions): UseTabDragResult {
  const [isDragging, setIsDragging] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>("idle");
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragPoint, setDragPoint] = useState<DragOutPoint | null>(null);

  // Track drop index in a ref so handleUp can read it synchronously
  const dropIndexRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragPointRef = useRef<DragOutPoint | null>(null);

  const stateRef = useRef({
    tabId: null as string | null,
    mode: "idle" as DragMode,
    startX: 0,
    startY: 0,
    holdTimer: null as ReturnType<typeof setTimeout> | null,
    isHoldingPointer: false,
  });

  const emitDragPoint = useCallback((point: DragOutPoint) => {
    dragPointRef.current = point;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setDragPoint(dragPointRef.current);
    });
  }, []);

  const setMode = useCallback((mode: DragMode) => {
    if (stateRef.current.mode !== mode) {
      stateRef.current.mode = mode;
      setDragMode(mode);
    }
  }, []);

  // Stable refs for callbacks used in document listeners
  const onDragOutRef = useRef(onDragOut);
  onDragOutRef.current = onDragOut;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const stableBarRef = useRef(tabBarRef);
  stableBarRef.current = tabBarRef;

  // Detach document listeners and reset state
  const cleanupRef = useRef(() => {});
  const cleanup = useCallback(() => {
    cleanupRef.current();
    cleanupRef.current = () => {};
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (stateRef.current.holdTimer) {
      clearTimeout(stateRef.current.holdTimer);
    }
    stateRef.current = {
      tabId: null,
      mode: "idle",
      startX: 0,
      startY: 0,
      holdTimer: null,
      isHoldingPointer: false,
    };
    dropIndexRef.current = null;
    setIsDragging(false);
    setIsReordering(false);
    setDragMode("idle");
    setDragTabId(null);
    setDropIndex(null);
    setDragPoint(null);
  }, []);

  const getTabDragHandlers = useCallback(
    (tabId: string, isPinned: boolean): TabDragHandlers => ({
      onPointerDown: (e: ReactPointerEvent) => {
        // Only primary button; skip pinned tabs
        if (e.button !== 0 || isPinned) return;

        const captureTarget = e.currentTarget as HTMLElement;
        const pointerId = e.pointerId;
        try {
          captureTarget.setPointerCapture(pointerId);
        } catch {
          // Best effort: some environments may reject pointer capture.
        }

        const isTouchLike = e.pointerType === "touch" || e.pointerType === "pen";
        stateRef.current = {
          tabId,
          mode: isTouchLike ? "hold" : "pending",
          startX: e.clientX,
          startY: e.clientY,
          holdTimer: null,
          isHoldingPointer: isTouchLike,
        };
        dropIndexRef.current = null;
        if (!isTouchLike) {
          setDragTabId(tabId);
          setDragMode("pending");
        } else {
          setDragMode("hold");
          stateRef.current.holdTimer = setTimeout(() => {
            const s = stateRef.current;
            if (s.tabId !== tabId || s.mode !== "hold") return;
            s.isHoldingPointer = false;
            setMode("pending");
            setDragTabId(tabId);
          }, TOUCH_HOLD_DELAY_MS);
        }

        const handleMove = (ev: PointerEvent) => {
          const s = stateRef.current;
          if (!s.tabId) return;

          const point = toPoint(ev);
          emitDragPoint(point);

          if (s.mode === "hold") {
            const holdDx = Math.abs(ev.clientX - s.startX);
            const holdDy = Math.abs(ev.clientY - s.startY);
            if (holdDx > TOUCH_HOLD_CANCEL_PX || holdDy > TOUCH_HOLD_CANCEL_PX) {
              cleanup();
            }
            return;
          }

          const bar = stableBarRef.current.current;
          if (!bar) return;

          const dx = ev.clientX - s.startX;
          const barRect = bar.getBoundingClientRect();
          const barTop = barRect.top;
          const barBottom = barRect.bottom;

          if (s.mode === "pending") {
            // Direction lock: determine reorder vs drag-out
            if (isOutsideVerticalBand(barTop, barBottom, ev.clientY)) {
              setMode("dragout");
              setIsDragging(true);
            } else if (Math.abs(dx) > REORDER_LOCK_THRESHOLD) {
              const idx = calcDropIndex(bar, ev.clientX);
              if (idx < 0) return; // DOM not ready — stay pending
              setMode("reorder");
              setIsReordering(true);
              dropIndexRef.current = idx;
              setDropIndex(idx);
            }
          } else if (s.mode === "reorder") {
            const tablist = bar.querySelector<HTMLElement>("[role='tablist']");
            if (tablist) {
              const delta = calcAutoScrollDelta(tablist.getBoundingClientRect(), ev.clientX);
              if (delta !== 0) {
                tablist.scrollLeft += delta;
              }
            }
            // Update drop position
            const idx = calcDropIndex(bar, ev.clientX);
            if (idx < 0) return; // DOM disappeared mid-drag — keep last position
            if (dropIndexRef.current !== idx) {
              dropIndexRef.current = idx;
              setDropIndex(idx);
            }

            // Allow escape to drag-out even while reordering
            if (isOutsideVerticalBand(barTop, barBottom, ev.clientY)) {
              setMode("dragout");
              setIsReordering(false);
              setIsDragging(true);
              dropIndexRef.current = null;
              setDropIndex(null);
            }
          }

          const mode = stateRef.current.mode;
          if (mode === "reorder" || mode === "dragout" || mode === "pending") {
            onDragMoveRef.current?.({
              tabId,
              mode,
              point,
              dropIndex: dropIndexRef.current,
            });
          }
        };

        const handleUp = (ev: PointerEvent) => {
          if (stateRef.current.holdTimer) {
            clearTimeout(stateRef.current.holdTimer);
            stateRef.current.holdTimer = null;
          }
          const s = stateRef.current;
          if (s.tabId && s.mode !== "hold") {
            if (s.mode === "dragout") {
              void Promise.resolve(onDragOutRef.current(s.tabId, toPoint(ev)));
            } else if (s.mode === "reorder" && dropIndexRef.current !== null) {
              onReorderRef.current(s.tabId, dropIndexRef.current);
            }
          }
          cleanup();
        };

        document.addEventListener("pointermove", handleMove);
        document.addEventListener("pointerup", handleUp);
        document.addEventListener("pointercancel", cleanup);

        cleanupRef.current = () => {
          document.removeEventListener("pointermove", handleMove);
          document.removeEventListener("pointerup", handleUp);
          document.removeEventListener("pointercancel", cleanup);
          try {
            if (captureTarget.hasPointerCapture(pointerId)) {
              captureTarget.releasePointerCapture(pointerId);
            }
          } catch {
            // Best effort cleanup.
          }
        };
      },
    }),
    [cleanup, emitDragPoint, setMode]
  );

  return { getTabDragHandlers, isDragging, isReordering, dragMode, dragTabId, dropIndex, dragPoint };
}
