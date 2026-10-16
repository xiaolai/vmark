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
 * Key decision — a pane-focus move is not a tab switch (#1554). In a
 * two-document split both panes render in the one window-scoped mode (split
 * plan ADR-4), and moving focus between them rewrites `activeTabId`. Mirroring
 * there flipped BOTH panes to the newly focused document's mode, remounting
 * both editors — and a remount takes DOM focus, which moved the pane focus
 * again: an endless Source/WYSIWYG ping-pong. So when the previous and next
 * tab are the split's two panes, the window mode stays and the document that
 * gained focus adopts it instead — that is the mode it is displayed in. A
 * forced-source (large file) document keeps its own mode: it renders in
 * Source whatever the window says.
 *
 * @coordinates-with stores/paneStore.ts — which tabs the split shows
 * @module hooks/useTabModeSync
 */

import { useEffect } from "react";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useLargeFileSessionStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
import { useUIStore } from "@/stores/uiStore";
import { useWindowLabel } from "@/contexts/WindowContext";

/** Whether `prevId` → `nextId` is focus moving between the split's two panes. */
function isPaneFocusMove(windowLabel: string, prevId: string | null | undefined, nextId: string): boolean {
  const split = usePaneStore.getState().byWindow[windowLabel];
  if (!split?.enabled || !prevId) return false;
  const paned = [split.primaryTabId, split.secondaryTabId];
  return paned.includes(prevId) && paned.includes(nextId);
}

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
      if (isPaneFocusMove(windowLabel, prevId, nextId)) {
        if (useLargeFileSessionStore.getState().isForcedSource(nextId)) return;
        const shown = ui.sourceMode ? "source" : "wysiwyg";
        if (doc.mode !== shown) useDocumentStore.getState().setMode(nextId, shown);
        return;
      }

      const desiredSource = doc.mode === "source";
      if (ui.sourceMode !== desiredSource) {
        ui.setSourceMode(desiredSource);
      }
    });
  }, [windowLabel]);
}
