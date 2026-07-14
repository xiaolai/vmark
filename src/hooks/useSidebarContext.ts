/**
 * useSidebarContext — the sidebar follows the active tab's kind (ADR-2, WI-S2.1).
 *
 * When a browser tab is active the sidebar shows browser views (browsing history,
 * bookmarks); when a document tab is active it shows file views (explorer, outline, file
 * history). There is no separate manual sidebar mode for the user to keep in sync — the
 * sidebar tracks what they are actually looking at, the same way the tab strip already
 * holds both kinds side by side.
 *
 * Each kind remembers its OWN sub-view (WI-S2.3), so glancing at a browser tab and coming
 * back does not cost you the file tree you had open. The two are separate fields rather
 * than one union, which also keeps a browser value from ever being written into the
 * persisted (document-only) hot-exit field.
 *
 * @coordinates-with stores/uiStore — sidebarViewMode + sidebarBrowserViewMode
 * @coordinates-with components/Sidebar/Sidebar — renders whichever this returns
 * @module hooks/useSidebarContext
 */
import { useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useWindowLabel } from "@/contexts/WindowContext";
import type { SidebarViewMode, BrowserSidebarView } from "@/stores/uiStore/types";

export type SidebarKind = "document" | "browser";
export type AnySidebarView = SidebarViewMode | BrowserSidebarView;

export interface SidebarContext {
  /** What the active tab IS — which decides which views the sidebar offers. */
  kind: SidebarKind;
  /** The remembered sub-view for that kind. */
  view: AnySidebarView;
  /** Switch the sub-view *within* the current kind. */
  setView: (view: AnySidebarView) => void;
}

export function useSidebarContext(): SidebarContext {
  const windowLabel = useWindowLabel();
  const kind = useTabStore((s): SidebarKind => {
    const id = s.activeTabId[windowLabel];
    if (!id) return "document";
    const tab = (s.tabs[windowLabel] ?? []).find((t) => t.id === id);
    return tab && isBrowserTab(tab) ? "browser" : "document";
  });
  const documentView = useUIStore((s) => s.sidebarViewMode);
  const browserView = useUIStore((s) => s.sidebarBrowserViewMode);

  const setView = useCallback(
    (view: AnySidebarView) => {
      const ui = useUIStore.getState();
      // Route to the field belonging to the ACTIVE kind, so switching a browser view
      // cannot clobber the document sub-view (and vice versa).
      if (kind === "browser") {
        ui.setSidebarBrowserViewMode(view as BrowserSidebarView);
      } else {
        ui.setSidebarViewMode(view as SidebarViewMode);
      }
    },
    [kind],
  );

  return { kind, view: kind === "browser" ? browserView : documentView, setView };
}
