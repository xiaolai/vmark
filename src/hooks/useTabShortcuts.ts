/**
 * Tab Shortcuts Hook
 *
 * Purpose: Keyboard shortcut handler for tab and UI operations — new tab,
 *   close tab (with dirty check), and status bar toggle.
 *
 * Key decisions:
 *   - Mod+W intentionally hardcoded (not configurable) for layered close handling
 *   - Mod+W always closes the active tab (not the window) regardless of tab count;
 *     ensureWindowHasTab creates a new untitled if the last tab is closed.
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
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { fileOpsError } from "@/utils/debug";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";

/** Hook that handles keyboard shortcuts for new tab, close tab (with dirty check), and status bar toggle. */
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

      // Cmd+W: Close active tab with dirty check (any tab count).
      // ensureWindowHasTab (inside closeTabWithDirtyCheck) creates a new
      // untitled tab when the last tab is closed, keeping the window open.
      // The menu accelerator also emits menu:close; useWindowClose handles
      // that identically, so the second invocation is a safe no-op.
      if (isMeta && e.key === "w") {
        e.preventDefault();
        const activeTabId = useTabStore.getState().activeTabId[windowLabel];
        if (activeTabId) {
          /* v8 ignore start -- @preserve .catch() callback only fires on unexpected tab-close errors; not triggered in mocked tests */
          closeTabWithDirtyCheck(windowLabel, activeTabId).catch((error) => {
            fileOpsError("Cmd+W tab close failed:", error);
          });
          /* v8 ignore stop */
        }
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
          useUIStore.getState().searchClose();
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
