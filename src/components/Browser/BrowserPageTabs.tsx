/**
 * BrowserPageTabs
 *
 * Purpose: The nested webpage tablist inside the browser workspace — the "+"
 * new-page button and one roving tab per open page (with a close button). Split
 * out of BrowserChrome so that component stays a thin placement wrapper.
 *
 * Key decisions:
 *   - Page ids are the real browser tab ids, so activation/close reuse the
 *     shared tab operations and keep native WebKit / MCP identity.
 *   - New pages and activations route through activateTabInFocusedPane so a
 *     split view targets the focused pane, not the primary active tab.
 *   - APG roving tablist: Arrow/Home/End move focus (shared rovingTabFocus);
 *     a keydown bubbled from the close button must not activate the page.
 *
 * @coordinates-with BrowserChrome.tsx — parent placement wrapper
 * @coordinates-with services/navigation/activateTabInFocusedPane — pane-aware activation
 * @module components/Browser/BrowserPageTabs
 */
import { Globe2 } from "lucide-react";
import { TabStripButton } from "@/components/shared/TabStripButton";
import { useTranslation } from "react-i18next";
import type { BrowserTab } from "@/stores/tabStoreTypes";
import { useTabStore } from "@/stores/tabStore";
import { activateTabInFocusedPane } from "@/services/navigation/activateTabInFocusedPane";
import { closeTabWithDirtyCheck } from "@/services/tabs/tabOperations";
import { isRovingNavKey, moveRovingTabFocus } from "@/utils/rovingTabFocus";
import { NEW_BROWSER_TAB_URL } from "@/services/commands/browserCommands";
import { useBrowserLeaseStore } from "@/services/browser/lease";

interface BrowserPageTabsProps {
  pages: BrowserTab[];
  activePageId: string;
  windowLabel: string;
}

export function BrowserPageTabs({ pages, activePageId, windowLabel }: BrowserPageTabsProps): React.ReactElement {
  const { t } = useTranslation("common");
  // Pages an AI run currently holds (audit 2026-09-03 #15). Native views stay
  // alive in the background, so a run can be driving a page that is not the one
  // on screen; the indicator has to live on the page's tab, not only in the chrome
  // of the active page.
  const leases = useBrowserLeaseStore((s) => s.leases);

  const createPage = () => {
    const id = useTabStore.getState().createBrowserPage(windowLabel, NEW_BROWSER_TAB_URL);
    // Route through the pane-aware activation so a split view shows the new
    // page in the focused pane rather than swapping the primary active tab.
    activateTabInFocusedPane(windowLabel, id);
  };

  return (
    <div className="browser-page-tabs" role="tablist" aria-label={t("browser.pages")}>
      <TabStripButton kind="add" className="browser-page-new" onClick={createPage} label={t("browser.newPage")} />

      {pages.map((page) => {
        const active = page.id === activePageId;
        const pageLabel = page.title && page.title !== page.url ? page.title : t("browser.newPage");
        const aiHolds = leases[page.id]?.holder === "ai";
        return (
          <div
            key={page.id}
            className={`browser-page-tab${active ? " active" : ""}`}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => activateTabInFocusedPane(windowLabel, page.id)}
            onKeyDown={(event) => {
              // Only the tab itself handles keys — a keydown bubbled from the
              // nested close button must not activate the page it closes.
              if (event.target !== event.currentTarget) return;
              if (isRovingNavKey(event.key)) {
                if (moveRovingTabFocus(event.currentTarget, event.key)) event.preventDefault();
                return;
              }
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              activateTabInFocusedPane(windowLabel, page.id);
            }}
            title={pageLabel}
          >
            <Globe2 size={14} aria-hidden="true" />
            {aiHolds && (
              <span
                className="browser-page-tab-ai"
                role="img"
                aria-label={t("browser.aiControlling")}
                title={t("browser.aiControlling")}
              />
            )}
            <span className="browser-page-tab-title">{pageLabel}</span>
            <TabStripButton
              kind="close"
              className="browser-page-tab-close"
              onClick={(event) => {
                event.stopPropagation();
                void closeTabWithDirtyCheck(windowLabel, page.id).catch(() => {
                  /* best-effort: a dirty-check/close failure must not crash the UI */
                });
              }}
              label={t("browser.closePage", { title: pageLabel })}
            />
          </div>
        );
      })}
    </div>
  );
}
