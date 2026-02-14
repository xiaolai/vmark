/**
 * Search Commands Hook
 *
 * Purpose: Handles menu events for Find and Replace — opens the search bar,
 *   focuses the search input, and routes find-next/find-prev/replace actions.
 *
 * @coordinates-with searchStore.ts — search state (query, flags, results)
 * @coordinates-with uiStore.ts — toggles search bar visibility
 * @module hooks/useSearchCommands
 */

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSearchStore } from "@/stores/searchStore";
import { useUIStore } from "@/stores/uiStore";
import { safeUnlistenAll } from "@/utils/safeUnlisten";

export function useSearchCommands() {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Find and Replace (Cmd+F) - toggle
      // Close other bars first for mutual exclusivity
      const unlistenFindReplace = await currentWindow.listen<string>("menu:find-replace", (event) => {
        if (event.payload !== windowLabel) return;
        const search = useSearchStore.getState();
        if (!search.isOpen) {
          // Opening FindBar: close StatusBar and UniversalToolbar
          useUIStore.getState().setStatusBarVisible(false);
          useUIStore.getState().setUniversalToolbarVisible(false);
        }
        search.toggle();
      });
      if (cancelled) { unlistenFindReplace(); return; }
      unlistenRefs.current.push(unlistenFindReplace);

      const unlistenFindNext = await currentWindow.listen<string>("menu:find-next", (event) => {
        if (event.payload !== windowLabel) return;
        const { isOpen } = useSearchStore.getState();
        if (!isOpen) {
          useSearchStore.getState().open();
        } else {
          useSearchStore.getState().findNext();
        }
      });
      if (cancelled) { unlistenFindNext(); return; }
      unlistenRefs.current.push(unlistenFindNext);

      const unlistenFindPrev = await currentWindow.listen<string>("menu:find-prev", (event) => {
        if (event.payload !== windowLabel) return;
        const { isOpen } = useSearchStore.getState();
        if (!isOpen) {
          useSearchStore.getState().open();
        } else {
          useSearchStore.getState().findPrevious();
        }
      });
      if (cancelled) { unlistenFindPrev(); return; }
      unlistenRefs.current.push(unlistenFindPrev);

      const unlistenUseSelection = await currentWindow.listen<string>("menu:use-selection-find", (event) => {
        if (event.payload !== windowLabel) return;
        // This will be implemented by the editor components
        // They will get the selection and set it as the query
        window.dispatchEvent(new CustomEvent("use-selection-for-find"));
      });
      if (cancelled) { unlistenUseSelection(); return; }
      unlistenRefs.current.push(unlistenUseSelection);
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
