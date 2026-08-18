import { useWindowLabel } from "@/contexts/WindowContext";
import { usePaneContext } from "@/contexts/PaneContext";
import { useTabStore } from "@/stores/tabStore";
import { usesOverlayTitleBar } from "@/utils/platform";
import { getBrowserWorkspaceView } from "./browserWorkspace";
import { BrowserChrome } from "./BrowserChrome";
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
 *
 * It also HOSTS the browser chrome off macOS (#1296). On macOS the chrome lives
 * in the app's own title-bar strip; where the OS draws the title bar itself
 * there is no such strip, so the tabs and address bar stack here, above the
 * page, as they do in every other desktop browser. Nothing has to be told about
 * the geometry: `useBrowserNativeView` positions the native webview from the
 * viewport's client rect under a ResizeObserver, so the page simply starts
 * below whatever chrome this renders.
 *
 * @coordinates-with BrowserChrome.tsx — the placement it mounts
 * @coordinates-with utils/platform.ts — usesOverlayTitleBar decides which placement applies
 */
export function BrowserWorkspaceSurface(): React.ReactElement {
  const windowLabel = useWindowLabel();
  const pane = usePaneContext();
  const tabs = useTabStore((s) => s.tabs[windowLabel] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const { activeBrowserPageId } = getBrowserWorkspaceView(tabs, pane?.tabId ?? activeTabId);

  return (
    <div className="browser-workspace-surface">
      {!usesOverlayTitleBar() && activeBrowserPageId && (
        <BrowserChrome activePageId={activeBrowserPageId} />
      )}
      {activeBrowserPageId && <BrowserSurface key={activeBrowserPageId} tabId={activeBrowserPageId} />}
    </div>
  );
}
