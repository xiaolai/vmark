/**
 * File Explorer Shortcuts Hook
 *
 * Purpose: Keyboard shortcut handler for file explorer actions —
 *   currently handles toggling hidden file visibility in workspace mode.
 *
 * Key decisions:
 *   - Only active in workspace mode (no file explorer without a workspace)
 *   - Skips when focus is in INPUT or TEXTAREA to avoid conflicts
 *   - IME events filtered out
 *
 * @coordinates-with workspaceConfig.ts — toggleShowHiddenFiles persists to config
 * @coordinates-with shortcutsStore.ts — reads configurable shortcut bindings
 * @module hooks/useFileExplorerShortcuts
 */

import { useEffect } from "react";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { toggleShowHiddenFiles } from "@/hooks/workspaceConfig";

export function useFileExplorerShortcuts() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeKeyEvent(event)) return;

      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }

      const { isWorkspaceMode, config } = useWorkspaceStore.getState();
      if (!isWorkspaceMode || !config) return;

      const shortcut = useShortcutsStore.getState().getShortcut("toggleHiddenFiles");
      if (matchesShortcutEvent(event, shortcut)) {
        event.preventDefault();
        void toggleShowHiddenFiles();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);
}
