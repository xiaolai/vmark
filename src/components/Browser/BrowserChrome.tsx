import { useTranslation } from "react-i18next";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { BrowserOmnibox } from "./BrowserOmnibox";
import { BrowserPageTabs } from "./BrowserPageTabs";
import { getBrowserWorkspaceView } from "./browserWorkspace";
import "./browser-chrome.css";

const EMPTY_TABS: never[] = [];

export type BrowserChromePlacement = "workspace" | "titlebar";

interface BrowserChromeProps {
  /** Workspace renders page tabs alone; titlebar combines them with navigation. */
  placement?: BrowserChromePlacement;
}

/**
 * Browser-specific chrome for the active browser workspace.
 *
 * A thin placement wrapper: it resolves the workspace projection and renders the
 * webpage tablist (BrowserPageTabs) either alone (workspace placement) or next
 * to the omnibox in the title bar. Page ids are the existing browser tab ids, so
 * native WebKit and MCP keep the same per-page identity and approval bindings.
 *
 * @coordinates-with BrowserPageTabs.tsx — the nested webpage tablist
 */
export function BrowserChrome({ placement = "workspace" }: BrowserChromeProps): React.ReactElement | null {
  const { t } = useTranslation("common");
  const windowLabel = useWindowLabel();
  const tabs = useTabStore((s) => s.tabs[windowLabel] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const view = getBrowserWorkspaceView(tabs, activeTabId);

  if (!view.browserWorkspaceActive || !view.activeBrowserPageId) return null;

  const activePageId = view.activeBrowserPageId;
  const pageTabs = (
    <BrowserPageTabs pages={view.browserPages} activePageId={activePageId} windowLabel={windowLabel} />
  );

  if (placement === "titlebar") {
    return (
      <div className="browser-chrome browser-chrome--titlebar" aria-label={t("browser.toolbar")}>
        <div className="browser-titlebar-navigation">
          <BrowserOmnibox tabId={activePageId} />
        </div>
        <div className="browser-titlebar-tabs">{pageTabs}</div>
        <div className="browser-titlebar-drag-space" data-tauri-drag-region />
      </div>
    );
  }

  return (
    <div className="browser-chrome browser-chrome--workspace" aria-label={t("browser.toolbar")}>
      {pageTabs}
    </div>
  );
}
