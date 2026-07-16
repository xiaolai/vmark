import { useWindowLabel } from "@/contexts/WindowContext";
import { usePaneContext } from "@/contexts/PaneContext";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { BrowserSurface } from "./BrowserSurface";

const EMPTY_TABS: never[] = [];

/**
 * Groups the existing BrowserTab ids into one visual workspace while keeping
 * the native webview lifecycle active-page-only. Inactive pages remain in the
 * store and MCP session state, then mount on demand when selected.
 */
export function BrowserWorkspaceSurface(): React.ReactElement {
  const windowLabel = useWindowLabel();
  const pane = usePaneContext();
  const tabs = useTabStore((s) => s.tabs[windowLabel] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const browserPages = tabs.filter(isBrowserTab);
  const activePageId = pane?.tabId ?? activeTabId;
  const activePage = browserPages.find((page) => page.id === activePageId);

  return (
    <div className="browser-workspace-surface">
      {activePage && <BrowserSurface key={activePage.id} tabId={activePage.id} />}
    </div>
  );
}
