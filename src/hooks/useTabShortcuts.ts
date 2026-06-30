/**
 * Tab Shortcuts Hook
 *
 * Purpose: Keyboard shortcut handler for tab and UI operations — new tab,
 *   close tab (with dirty check), and status bar toggle.
 *
 * Key decisions:
 *   - Mod+W intentionally hardcoded (not configurable) for layered close handling
 *   - Mod+W closes the active tab (not the window). Closing the last tab leaves
 *     the window open on the Welcome screen (empty-workspace window); the window
 *     itself is closed via the menu:close path in useWindowClose.
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
import { useShortcutsStore } from "@/stores/settingsStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { fileOpsError } from "@/utils/debug";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { cycleTabId } from "@/utils/tabCycling";

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

      // Tab cycling (audit 20260612 H27 — there was no keyboard way to
      // reach another tab). Wraps at both ends.
      for (const [id, direction] of [
        ["nextTab", "next"],
        ["prevTab", "previous"],
      ] as const) {
        if (matchesShortcutEvent(e, shortcuts.getShortcut(id))) {
          e.preventDefault();
          const tabState = useTabStore.getState();
          const ids = (tabState.tabs[windowLabel] ?? []).map((t) => t.id);
          const target = cycleTabId(ids, tabState.activeTabId[windowLabel] ?? null, direction);
          if (target) tabState.setActiveTab(windowLabel, target);
          return;
        }
      }

      // Cmd+W: Close active tab with dirty check (any tab count).
      // Closing the last tab keeps the window open on the Welcome screen
      // (empty-workspace window). With no active tab there is nothing to close
      // here; the menu accelerator's menu:close (handled by useWindowClose)
      // closes the empty window itself. The accelerator also emits menu:close
      // when a tab IS active, so that second invocation is a safe no-op.
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
