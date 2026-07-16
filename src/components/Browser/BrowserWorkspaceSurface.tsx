import { useWindowLabel } from "@/contexts/WindowContext";
import { usePaneContext } from "@/contexts/PaneContext";
import { useTabStore } from "@/stores/tabStore";
import { getBrowserWorkspaceView } from "./browserWorkspace";
import { BrowserSurface } from "./BrowserSurface";

const EMPTY_TABS: never[] = [];

/**
 * Groups the existing BrowserTab ids into one visual workspace while keeping
 * the native webview lifecycle active-page-only. Inactive pages remain in the
 * store and MCP session state, then mount on demand when selected.
 *
 * The active page resolves through the shared getBrowserWorkspaceView projection
 * (with the focused pane's tab overriding the window's active tab in split view)
 * so page grouping and active-page semantics stay defined in one place.
 */
export function BrowserWorkspaceSurface(): React.ReactElement {
  const windowLabel = useWindowLabel();
  const pane = usePaneContext();
  const tabs = useTabStore((s) => s.tabs[windowLabel] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const { activeBrowserPageId } = getBrowserWorkspaceView(tabs, pane?.tabId ?? activeTabId);

  return (
    <div className="browser-workspace-surface">
      {activeBrowserPageId && <BrowserSurface key={activeBrowserPageId} tabId={activeBrowserPageId} />}
    </div>
  );
}
