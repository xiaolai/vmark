/**
 * useStatusBarTabDrag
 *
 * Purpose: Orchestrates all tab drag-and-drop behavior — pointer-based reorder
 * within the tab strip, drag-out to transfer tabs between windows, cross-window
 * drop preview highlighting, spring-loaded window focus, and keyboard reorder.
 *
 * Key decisions:
 *   - Delegates low-level pointer tracking to useTabDragOut (a shared hook);
 *     this hook adds StatusBar-specific concerns: ARIA announcements, snapback
 *     animation, drop preview broadcasts, and spring-loaded focus.
 *   - Spring-loaded focus: when hovering over another window during drag-out,
 *     after SPRING_LOAD_FOCUS_MS the target window is focused so the user can
 *     see where the tab will land.
 *   - Drop preview: broadcasts a tab:drop-preview event so OTHER windows can
 *     show a visual "drop target" highlight on their status bar.
 *   - Reorder validity is checked via planReorder from tabDragRules — pinned
 *     zone violations trigger snapback + ARIA feedback.
 *   - Cursor is forced to grabbing/not-allowed during drag to override any
 *     element-level cursor styles.
 *
 * @coordinates-with StatusBar.tsx — consumes the returned drag state for rendering
 * @coordinates-with tabDragRules.ts — reorder policy (pinned zone)
 * @coordinates-with tabTransferActions.ts — performs the actual cross-window transfer
 * @coordinates-with tabKeyboard.ts — keyboard reorder via handleTabKeyDown
 * @module components/StatusBar/useStatusBarTabDrag
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useTabDragOut, type DragOutPoint } from "@/hooks/useTabDragOut";
import { handleTabKeyboard } from "./tabKeyboard";
import { planReorder } from "./tabDragRules";
import { transferTabFromDragOut } from "./tabTransferActions";
import type { TabDropPreviewEvent } from "@/types/tabTransfer";

const SPRING_LOAD_FOCUS_MS = 420;
const SNAPBACK_MS = 180;
const ARIA_CLEAR_MS = 1200;
const PREVIEW_PROBE_MS = 60;

interface UseStatusBarTabDragOptions {
  tabs: Tab[];
  windowLabel: string;
  tabBarRef: RefObject<HTMLDivElement | null>;
  onActivateTab: (tabId: string) => void;
}

interface UseStatusBarTabDragResult {
  getTabDragHandlers: ReturnType<typeof useTabDragOut>["getTabDragHandlers"];
  isDragging: boolean;
  isReordering: boolean;
  dragMode: ReturnType<typeof useTabDragOut>["dragMode"];
  dragTabId: string | null;
  dropIndex: number | null;
  dragPoint: DragOutPoint | null;
  snapbackTabId: string | null;
  isDropPreviewTarget: boolean;
  isDropInvalid: boolean;
  isReorderBlocked: boolean;
  dragHint: string;
  ariaAnnouncement: string;
  handleTabKeyDown: (tabId: string, event: KeyboardEvent) => void;
}

export function useStatusBarTabDrag({ tabs, windowLabel, tabBarRef, onActivateTab }: UseStatusBarTabDragOptions): UseStatusBarTabDragResult {
  const [dragTargetWindowLabel, setDragTargetWindowLabel] = useState<string | null>(null);
  const [isDropPreviewTarget, setIsDropPreviewTarget] = useState(false);
  const [snapbackTabId, setSnapbackTabId] = useState<string | null>(null);
  const [ariaAnnouncement, setAriaAnnouncement] = useState("");

  const ariaClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const springFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const springFocusedWindowRef = useRef<string | null>(null);
  const previewProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDragPointRef = useRef<DragOutPoint | null>(null);

  const announce = useCallback((message: string) => {
    setAriaAnnouncement(message);
    if (ariaClearTimerRef.current) {
      clearTimeout(ariaClearTimerRef.current);
    }
    ariaClearTimerRef.current = setTimeout(() => {
      setAriaAnnouncement("");
      ariaClearTimerRef.current = null;
    }, ARIA_CLEAR_MS);
  }, []);

  const triggerSnapback = useCallback((tabId: string) => {
    setSnapbackTabId(tabId);
    setTimeout(() => {
      setSnapbackTabId((prev) => (prev === tabId ? null : prev));
    }, SNAPBACK_MS);
  }, []);

  const clearDropPreviewBroadcast = useCallback(() => {
    setDragTargetWindowLabel(null);
    void emit("tab:drop-preview", {
      sourceWindowLabel: windowLabel,
      targetWindowLabel: null,
    } satisfies TabDropPreviewEvent);

    if (springFocusTimerRef.current) {
      clearTimeout(springFocusTimerRef.current);
      springFocusTimerRef.current = null;
    }
    springFocusedWindowRef.current = null;
  }, [windowLabel]);

  const handleReorder = useCallback(
    (tabId: string, dropIdx: number) => {
      const windowTabs = useTabStore.getState().tabs[windowLabel] ?? [];
      const fromIndex = windowTabs.findIndex((t) => t.id === tabId);
      if (fromIndex === -1) return;
      const tab = windowTabs[fromIndex];
      if (!tab) return;

      const plan = planReorder(windowTabs, fromIndex, dropIdx);
      if (!plan.allowed || fromIndex === plan.toIndex) {
        if (!plan.allowed && plan.blockedReason === "pinned-zone") {
          triggerSnapback(tabId);
          announce("Pinned tabs stay at the left. Drop blocked.");
        }
        return;
      }

      useTabStore.getState().reorderTabs(windowLabel, fromIndex, plan.toIndex);
      toast.message(`Moved "${tab.title}"`, {
        action: {
          label: "Undo",
          onClick: () => {
            const currentTabs = useTabStore.getState().tabs[windowLabel] ?? [];
            const currentIndex = currentTabs.findIndex((t) => t.id === tab.id);
            if (currentIndex !== -1) {
              useTabStore.getState().reorderTabs(windowLabel, currentIndex, fromIndex);
            }
          },
        },
      });
      announce(`Reordered tab ${tab.title}.`);
    },
    [announce, triggerSnapback, windowLabel]
  );

  const handleDragOut = useCallback(
    async (tabId: string, point: DragOutPoint) => {
      try {
        await transferTabFromDragOut({
          tabId,
          point,
          windowLabel,
          triggerSnapback,
          announce,
        });
      } finally {
        clearDropPreviewBroadcast();
      }
    },
    [announce, clearDropPreviewBroadcast, triggerSnapback, windowLabel]
  );

  const handleTabKeyDown = useCallback((tabId: string, event: KeyboardEvent) => {
    const windowTabs = useTabStore.getState().tabs[windowLabel] ?? [];
    handleTabKeyboard({
      tabId,
      event,
      tabs: windowTabs,
      onReorder: handleReorder,
      onActivate: onActivateTab,
    });
  }, [handleReorder, onActivateTab, windowLabel]);

  const { getTabDragHandlers, isDragging, isReordering, dragMode, dragTabId, dropIndex, dragPoint } = useTabDragOut({
    tabBarRef,
    onDragOut: handleDragOut,
    onReorder: handleReorder,
    onDragMove: ({ mode, point }) => {
      if (mode !== "dragout") return;
      latestDragPointRef.current = point;
      if (previewProbeTimerRef.current) return;
      previewProbeTimerRef.current = setTimeout(() => {
        previewProbeTimerRef.current = null;
        const currentPoint = latestDragPointRef.current;
        if (!currentPoint) return;

        void invoke<string | null>("find_drop_target_window", {
          sourceWindowLabel: windowLabel,
          screenX: currentPoint.screenX,
          screenY: currentPoint.screenY,
        }).then((targetWindowLabel) => {
          setDragTargetWindowLabel(targetWindowLabel);
          void emit("tab:drop-preview", {
            sourceWindowLabel: windowLabel,
            targetWindowLabel,
          } satisfies TabDropPreviewEvent);
        }).catch((error) => {
          console.error("[StatusBar] Failed to probe drop target:", error);
        });
      }, PREVIEW_PROBE_MS);
    },
  });

  const dragFromIndex = dragTabId ? tabs.findIndex((tab) => tab.id === dragTabId) : -1;
  const reorderPlan = useMemo(() => {
    if (dragMode !== "reorder" || dragFromIndex === -1 || dropIndex === null) return null;
    return planReorder(tabs, dragFromIndex, dropIndex);
  }, [dragFromIndex, dragMode, dropIndex, tabs]);

  const isReorderBlocked = Boolean(reorderPlan && !reorderPlan.allowed);
  const isDragOutBlocked = dragMode === "dragout" && windowLabel === "main" && tabs.length <= 1;
  const isDropInvalid = isReorderBlocked || isDragOutBlocked;
  const dragHint = isDragOutBlocked
    ? "Cannot move the last tab in main window"
    : dragTargetWindowLabel
      ? `Drop to move to ${dragTargetWindowLabel}`
      : dragMode === "dragout"
        ? "Drop to create a new window"
        : isReorderBlocked
          ? "Pinned zone is locked"
          : "Reorder tab";

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<TabDropPreviewEvent>("tab:drop-preview", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.sourceWindowLabel === windowLabel) return;
      setIsDropPreviewTarget(payload.targetWindowLabel === windowLabel);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch((error) => {
      console.error("[StatusBar] Failed to listen for drop preview events:", error);
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [windowLabel]);

  useEffect(() => {
    if (dragMode !== "dragout" || !dragTargetWindowLabel) {
      if (springFocusTimerRef.current) {
        clearTimeout(springFocusTimerRef.current);
        springFocusTimerRef.current = null;
      }
      springFocusedWindowRef.current = null;
      return;
    }

    if (springFocusedWindowRef.current === dragTargetWindowLabel) return;
    if (springFocusTimerRef.current) {
      clearTimeout(springFocusTimerRef.current);
    }

    springFocusTimerRef.current = setTimeout(() => {
      springFocusTimerRef.current = null;
      springFocusedWindowRef.current = dragTargetWindowLabel;
      void invoke("focus_existing_window", {
        windowLabel: dragTargetWindowLabel,
      }).catch((error) => {
        console.error("[StatusBar] Failed to focus spring-loaded target:", error);
      });
    }, SPRING_LOAD_FOCUS_MS);
  }, [dragMode, dragTargetWindowLabel]);

  useEffect(() => {
    if (dragMode !== "idle") return;
    clearDropPreviewBroadcast();
  }, [clearDropPreviewBroadcast, dragMode]);

  useEffect(() => {
    if (dragMode !== "dragout" && previewProbeTimerRef.current) {
      clearTimeout(previewProbeTimerRef.current);
      previewProbeTimerRef.current = null;
    }
  }, [dragMode]);

  useEffect(() => {
    if (dragMode !== "dragout" && dragMode !== "reorder") return;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = isDropInvalid ? "not-allowed" : "grabbing";
    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [dragMode, isDropInvalid]);

  useEffect(() => () => {
    if (ariaClearTimerRef.current) clearTimeout(ariaClearTimerRef.current);
    if (springFocusTimerRef.current) clearTimeout(springFocusTimerRef.current);
    if (previewProbeTimerRef.current) clearTimeout(previewProbeTimerRef.current);
  }, []);

  return {
    getTabDragHandlers,
    isDragging,
    isReordering,
    dragMode,
    dragTabId,
    dropIndex,
    dragPoint,
    snapbackTabId,
    isDropPreviewTarget,
    isDropInvalid,
    isReorderBlocked,
    dragHint,
    ariaAnnouncement,
    handleTabKeyDown,
  };
}
