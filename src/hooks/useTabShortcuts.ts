/**
 * Tab Shortcuts Hook
 *
 * Handles keyboard shortcuts for tab and UI operations:
 * - Cmd+T: New tab
 * - Cmd+W: Close current tab (with dirty check)
 * - Cmd+J: Toggle status bar visibility
 */

import { useEffect } from "react";
import { useWindowLabel, useIsDocumentWindow } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { isImeKeyEvent } from "@/utils/imeGuard";

export function useTabShortcuts() {
  const windowLabel = useWindowLabel();
  const isDocumentWindow = useIsDocumentWindow();

  useEffect(() => {
    if (!isDocumentWindow) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+T: New tab
      if (isMeta && e.key === "t") {
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

      // Cmd+J: Toggle status bar visibility
      if (isMeta && e.key === "j") {
        e.preventDefault();
        useUIStore.getState().toggleStatusBar();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [windowLabel, isDocumentWindow]);
}
