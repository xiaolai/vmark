/**
 * Tab Shortcuts Hook
 *
 * Handles keyboard shortcuts for tab and UI operations:
 * - Cmd+T: New tab
 * - Cmd+W: Close current tab (with dirty check)
 * - Cmd+J: Toggle status bar visibility (mutually exclusive with FindBar/UniversalToolbar)
 */

import { useEffect } from "react";
import { useWindowLabel, useIsDocumentWindow } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSearchStore } from "@/stores/searchStore";
import { useUIStore } from "@/stores/uiStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { isTerminalFocused } from "@/utils/focus";

export function useTabShortcuts() {
  const windowLabel = useWindowLabel();
  const isDocumentWindow = useIsDocumentWindow();

  useEffect(() => {
    if (!isDocumentWindow) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+T: New tab (editor-scoped)
      if (isMeta && e.key === "t") {
        if (isTerminalFocused()) return; // Let terminal handle it
        e.preventDefault();
        const tabId = useTabStore.getState().createTab(windowLabel, null);
        useDocumentStore.getState().initDocument(tabId, "", null);
        return;
      }

      // Cmd+W: Close current tab (if multiple tabs) with dirty check
      if (isMeta && e.key === "w") {
        const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
        const activeTabId = useTabStore.getState().activeTabId[windowLabel];

        // Only handle if we have multiple tabs
        if (tabs.length > 1 && activeTabId) {
          e.preventDefault();
          closeTabWithDirtyCheck(windowLabel, activeTabId);
        }
        // If single tab, let default Cmd+W behavior (close window) happen
        return;
      }

      // Cmd+J: Toggle status bar visibility (mutually exclusive with other bottom bars)
      if (isMeta && e.key === "j") {
        e.preventDefault();
        const ui = useUIStore.getState();
        const isCurrentlyVisible = ui.statusBarVisible;

        if (!isCurrentlyVisible) {
          // Showing StatusBar: close other bars first
          useSearchStore.getState().close();
          ui.setUniversalToolbarVisible(false);
        }
        ui.setStatusBarVisible(!isCurrentlyVisible);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [windowLabel, isDocumentWindow]);
}
