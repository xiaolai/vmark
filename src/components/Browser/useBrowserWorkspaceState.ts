import { useIsDocumentWindow, useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { getBrowserWorkspaceView } from "./browserWorkspace";

const EMPTY_TABS: never[] = [];

/** Shared browser-workspace projection for the shell and bottom workspace bar. */
export function useBrowserWorkspaceState() {
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const tabs = useTabStore((state) =>
    isDocumentWindow ? state.tabs[windowLabel] ?? EMPTY_TABS : EMPTY_TABS,
  );
  const activeTabId = useTabStore((state) =>
    isDocumentWindow ? state.activeTabId[windowLabel] ?? null : null,
  );
  const lastActiveBrowserPageId = useTabStore((state) =>
    isDocumentWindow ? state.lastActiveBrowserPageId[windowLabel] ?? null : null,
  );
  const browserWorkspace = getBrowserWorkspaceView(tabs, activeTabId, lastActiveBrowserPageId);

  return { activeTabId, browserWorkspace };
}

/**
 * Lightweight boolean selector: is the browser workspace currently active in
 * this window? Returns a primitive so subscribers (the app shell) re-render only
 * when it flips — not on every unrelated tab-metadata change, which is why the
 * shell must not read this off the full `useBrowserWorkspaceState()` projection.
 */
export function useBrowserWorkspaceActive(): boolean {
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  return useTabStore((state) => {
    if (!isDocumentWindow) return false;
    const active = state.activeTabId[windowLabel];
    return (
      !!active &&
      (state.tabs[windowLabel] ?? EMPTY_TABS).some((t) => t.id === active && t.kind === "browser")
    );
  });
}
