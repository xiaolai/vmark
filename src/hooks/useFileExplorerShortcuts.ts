/**
 * File Explorer Shortcuts Hook
 *
 * Purpose: Keyboard shortcut handler for file explorer actions —
 *   handles toggling hidden file visibility and all-files visibility
 *   in workspace mode.
 *
 * Key decisions:
 *   - Only active in workspace mode (no file explorer without a workspace)
 *   - Skips when focus is in INPUT or TEXTAREA to avoid conflicts
 *   - IME events filtered out
 *
 * @coordinates-with workspaceConfig.ts — toggleShowHiddenFiles/toggleShowAllFiles persist to config
 * @coordinates-with shortcutsStore.ts — reads configurable shortcut bindings
 * @module hooks/useFileExplorerShortcuts
 */

import { useEffect } from "react";
import { useShortcutsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { toggleShowHiddenFiles, toggleShowAllFiles } from "@/hooks/workspaceConfig";

/** Hook that handles keyboard shortcuts for toggling hidden/all files in the file explorer. */
export function useFileExplorerShortcuts() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeKeyEvent(event)) return;

      const target = event.target as HTMLElement | null;
      /* v8 ignore next 2 -- @preserve reason: INPUT/TEXTAREA guard; test events are dispatched on document, not from input elements */
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }

      const { isWorkspaceMode, config } = useWorkspaceStore.getState();
      /* v8 ignore next -- @preserve reason: false-branch (workspace active with config) tested but V8 marks branch miss on the true-return path */
      if (!isWorkspaceMode || !config) return;

      const shortcuts = useShortcutsStore.getState();

      const hiddenShortcut = shortcuts.getShortcut("toggleHiddenFiles");
      if (matchesShortcutEvent(event, hiddenShortcut)) {
        event.preventDefault();
        void toggleShowHiddenFiles();
        return;
      }

      const allFilesShortcut = shortcuts.getShortcut("toggleAllFiles");
      /* v8 ignore next -- @preserve reason: allFilesShortcut always truthy via mock; falsy guard is defensive */
      if (allFilesShortcut && matchesShortcutEvent(event, allFilesShortcut)) {
        event.preventDefault();
        void toggleShowAllFiles();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);
}
