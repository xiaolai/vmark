/**
 * Content Search Shortcuts Hook
 *
 * Purpose: Listens for the "Find in Files" keyboard shortcut and menu event,
 * toggling the ContentSearch overlay.
 *
 * Follows the same pattern as useQuickOpenShortcuts.ts.
 *
 * @coordinates-with contentSearchStore.ts — overlay visibility
 * @coordinates-with shortcutsStore.ts — configurable shortcut key
 * @module components/ContentSearch/useContentSearchShortcuts
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useContentSearchStore } from "@/stores/contentSearchStore";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isImeKeyEvent } from "@/utils/imeGuard";

export function useContentSearchShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isImeKeyEvent(e)) return;
      const key = useShortcutsStore.getState().getShortcut("contentSearch");
      if (matchesShortcutEvent(e, key)) {
        e.preventDefault();
        useContentSearchStore.getState().open();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const unlisten = listen("menu:find-in-files", () => {
      useContentSearchStore.getState().open();
    });
    return () => safeUnlistenAsync(unlisten);
  }, []);
}
