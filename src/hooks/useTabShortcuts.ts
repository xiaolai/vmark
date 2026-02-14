/**
 * Tab Shortcuts Hook
 *
 * Purpose: Keyboard shortcut handler for tab and UI operations — new tab,
 *   close tab (with dirty check), and status bar toggle.
 *
 * Key decisions:
 *   - Mod+W intentionally hardcoded (not configurable) for layered close handling
 *   - Close finds the search bar first, then closes the tab
 *   - New tab and status bar toggle use configurable shortcuts from store
 *   - Only active in document windows (not settings or other window types)
 *
 * @coordinates-with useTabOperations.ts — closeTabWithDirtyCheck for save prompts
 * @coordinates-with shortcutsStore.ts — reads configurable shortcut bindings
 * @module hooks/useTabShortcuts
 */

import { useEffect } from "react";
import { useWindowLabel, useIsDocumentWindow } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSearchStore } from "@/stores/searchStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useUIStore } from "@/stores/uiStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";

export function useTabShortcuts() {
  const windowLabel = useWindowLabel();
  const isDocumentWindow = useIsDocumentWindow();

  useEffect(() => {
    if (!isDocumentWindow) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      const isMeta = e.metaKey || e.ctrlKey;
      const shortcuts = useShortcutsStore.getState();

      // New tab (uses newTab shortcut from store)
      const newTabKey = shortcuts.getShortcut("newTab");
      if (matchesShortcutEvent(e, newTabKey)) {
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

      // Toggle status bar visibility (mutually exclusive with other bottom bars)
      const statusBarKey = useShortcutsStore.getState().getShortcut("toggleStatusBar");
      if (matchesShortcutEvent(e, statusBarKey)) {
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
