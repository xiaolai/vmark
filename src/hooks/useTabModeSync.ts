/**
 * useTabModeSync — ADR-009 per-tab editor swap.
 *
 * Subscribes to active-tab changes; when the user switches tabs, this
 * hook reads the new document's `mode` field and brings the window's
 * `uiStore.sourceMode` into alignment. The effect: switching to a tab
 * that was last in Source mode auto-swaps the editor surface; switching
 * back to a WYSIWYG tab auto-swaps it the other way.
 *
 * The mirror runs only when modes differ — same-mode tab switches
 * trigger zero work. Mount once at the App level.
 *
 * @module hooks/useTabModeSync
 */

import { useEffect } from "react";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useWindowLabel } from "@/contexts/WindowContext";

export function useTabModeSync(): void {
  const windowLabel = useWindowLabel();

  useEffect(() => {
    return useTabStore.subscribe((state, prevState) => {
      const nextId = state.activeTabId[windowLabel];
      const prevId = prevState.activeTabId[windowLabel];
      if (nextId === prevId || !nextId) return;

      const doc = useDocumentStore.getState().getDocument(nextId);
      if (!doc) return;

      const ui = useUIStore.getState();
      const desiredSource = doc.mode === "source";
      if (ui.sourceMode !== desiredSource) {
        ui.setSourceMode(desiredSource);
      }
    });
  }, [windowLabel]);
}
