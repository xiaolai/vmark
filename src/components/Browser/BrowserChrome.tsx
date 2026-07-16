import { Globe2, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { activateTabInFocusedPane } from "@/services/navigation/activateTabInFocusedPane";
import { BrowserOmnibox } from "./BrowserOmnibox";
import { getBrowserWorkspaceView } from "./browserWorkspace";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { NEW_BROWSER_TAB_URL } from "@/services/commands/browserCommands";
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
 * The bottom status bar stays at the workspace level. This surface owns the
 * nested webpage tabs and the controls that act on the currently active page.
 * Page ids are the existing browser tab ids, so native WebKit and MCP keep the
 * same per-page identity and approval bindings.
 */
export function BrowserChrome({ placement = "workspace" }: BrowserChromeProps): React.ReactElement | null {
  const { t } = useTranslation("common");
  const windowLabel = useWindowLabel();
  const tabs = useTabStore((s) => s.tabs[windowLabel] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[windowLabel] ?? null);
  const view = getBrowserWorkspaceView(tabs, activeTabId);

  if (!view.browserWorkspaceActive || !view.activeBrowserPageId) return null;

  const activePageId = view.activeBrowserPageId;
  const createPage = () => {
    useTabStore.getState().createBrowserPage(windowLabel, NEW_BROWSER_TAB_URL);
  };

  const pageTabs = (
    <div className="browser-page-tabs" role="tablist" aria-label={t("browser.pages")}>
      <button
        type="button"
        className="browser-page-new"
        onClick={createPage}
        aria-label={t("browser.newPage")}
        title={t("browser.newPage")}
      >
        <Plus size={15} />
      </button>

      {view.browserPages.map((page) => {
        const active = page.id === activePageId;
        const pageLabel = page.title && page.title !== page.url ? page.title : t("browser.newPage");
        return (
          <div
            key={page.id}
            className={`browser-page-tab${active ? " active" : ""}`}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => activateTabInFocusedPane(windowLabel, page.id)}
            onKeyDown={(event) => {
              // Only the tab itself activates on Enter/Space — a keydown that
              // bubbled up from the nested close button must not activate the
              // page it is about to close.
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              activateTabInFocusedPane(windowLabel, page.id);
            }}
            title={pageLabel}
          >
            <Globe2 size={14} aria-hidden="true" />
            <span className="browser-page-tab-title">{pageLabel}</span>
            <button
              type="button"
              className="browser-page-tab-close"
              onClick={(event) => {
                event.stopPropagation();
                void closeTabWithDirtyCheck(windowLabel, page.id).catch(() => {
                  /* best-effort: a dirty-check/close failure must not crash the UI */
                });
              }}
              aria-label={t("browser.closePage", { title: pageLabel })}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
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
