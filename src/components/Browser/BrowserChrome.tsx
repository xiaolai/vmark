import { useTranslation } from "react-i18next";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserLeaseStore } from "@/services/browser/lease";
import { BrowserOmnibox } from "./BrowserOmnibox";
import { BrowserPageTabs } from "./BrowserPageTabs";
import { getBrowserWorkspaceView } from "./browserWorkspace";
import "./browser-chrome.css";

const EMPTY_TABS: never[] = [];

type BrowserChromePlacement = "workspace" | "titlebar";

interface BrowserChromeProps {
  /**
   * Where this chrome is mounted. `titlebar` is the macOS arrangement — the app
   * draws its own strip over the native title bar, so tabs and omnibox sit
   * side by side in it. `workspace` is the arrangement everywhere else: the OS
   * owns the title bar, so the chrome stacks inside the pane above the page,
   * like every other desktop browser (#1296).
   */
  placement?: BrowserChromePlacement;
  /**
   * The page this chrome addresses. The workspace placement is mounted PER PANE,
   * and in a split the pane's page is not the window's active tab — pointing the
   * omnibox at the window's would navigate a page the user cannot see. Omitting
   * it falls back to the window's active page, which is what the window-level
   * title bar wants.
   */
  activePageId?: string;
}

/**
 * Browser-specific chrome for the active browser workspace.
 *
 * A thin placement wrapper: it resolves the workspace projection and renders the
 * webpage tablist (BrowserPageTabs) plus the omnibox, stacked inside the pane or
 * side by side in the title bar. The two placements are mutually exclusive by
 * platform, so the omnibox is never mounted twice. Page ids are the existing
 * browser tab ids, so native WebKit and MCP keep the same per-page identity and
 * approval bindings.
 *
 * @coordinates-with BrowserPageTabs.tsx — the nested webpage tablist
 * @coordinates-with BrowserWorkspaceSurface.tsx — mounts the workspace placement off macOS
 */
export function BrowserChrome({
  placement = "workspace",
  activePageId: requestedPageId,
}: BrowserChromeProps): React.ReactElement | null {
  const { t } = useTranslation("common");
  const windowLabel = useWindowLabel();
  const tabs = useTabStore((s) => s.tabs[windowLabel] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const view = getBrowserWorkspaceView(tabs, activeTabId);

  // A named page wins; otherwise fall back to the window's active one. Either
  // way it must name a page that still EXISTS: the omnibox drives navigation, so
  // a stale or wrong id would aim `browser_navigate` at nothing, and the tablist
  // would show no selection while looking perfectly normal.
  const requested = requestedPageId ?? (view.browserWorkspaceActive ? view.activeBrowserPageId : null);
  const activePageId = view.browserPages.some((page) => page.id === requested) ? requested : null;

  // WI-NB5.1: the chrome is the one place React can see human input (the page
  // itself is a native sibling view), so any interaction here while the AI
  // holds the lease is a human takeover. Subscribed, so the indicator appears
  // the moment a workflow run acquires the lease and vanishes on release.
  const aiHolds = useBrowserLeaseStore((s) =>
    activePageId !== null ? s.leases[activePageId]?.holder === "ai" : false,
  );

  if (!activePageId) return null;

  const reclaim = (): void => {
    if (useBrowserLeaseStore.getState().currentHolder(activePageId) === "ai") {
      useBrowserLeaseStore.getState().reclaimForHuman(activePageId);
    }
  };

  const leaseIndicator = aiHolds ? (
    <button type="button" className="vm-btn browser-ai-lease" onClick={reclaim}>
      {t("browser.aiControlling")}
    </button>
  ) : null;

  const pageTabs = (
    <BrowserPageTabs pages={view.browserPages} activePageId={activePageId} windowLabel={windowLabel} />
  );

  if (placement === "titlebar") {
    return (
      <div
        className="browser-chrome browser-chrome--titlebar"
        aria-label={t("browser.toolbar")}
        onMouseDownCapture={reclaim}
        onKeyDownCapture={reclaim}
      >
        <div className="browser-titlebar-navigation">
          <BrowserOmnibox tabId={activePageId} />
        </div>
        {leaseIndicator}
        <div className="browser-titlebar-tabs">{pageTabs}</div>
        <div className="browser-titlebar-drag-space" data-tauri-drag-region />
      </div>
    );
  }

  return (
    <div
      className="browser-chrome browser-chrome--workspace"
      aria-label={t("browser.toolbar")}
      onMouseDownCapture={reclaim}
      onKeyDownCapture={reclaim}
    >
      {pageTabs}
      {leaseIndicator}
      <BrowserOmnibox tabId={activePageId} />
    </div>
  );
}
