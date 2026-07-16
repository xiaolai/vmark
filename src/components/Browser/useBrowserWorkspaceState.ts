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
  const browserWorkspace = getBrowserWorkspaceView(tabs, activeTabId);
  const browserReturnPageId = browserWorkspace.browserWorkspaceTabId;

  return { activeTabId, browserWorkspace, activeBrowserPageId: browserWorkspace.activeBrowserPageId, browserReturnPageId };
}
