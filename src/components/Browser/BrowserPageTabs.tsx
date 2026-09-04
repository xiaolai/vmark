/**
 * BrowserPageTabs
 *
 * Purpose: The nested webpage tablist inside the browser workspace — the "+"
 * new-page button and one roving tab per open page, each with a close button
 * beside it. Split out of BrowserChrome so that component stays a thin
 * placement wrapper.
 *
 * Key decisions:
 *   - Page ids are the real browser tab ids, so activation/close reuse the
 *     shared tab operations and keep native WebKit / MCP identity.
 *   - Activating an EXISTING page routes through activateTabInFocusedPane. A NEW
 *     page is activated by `createBrowserPage` itself, which writes the alias and
 *     announces once on the activation bus (audit 2026-09-03 #162): a second
 *     activation re-wrote identical state and announced the same activation
 *     twice, and converged nothing — panes hold documents only, so a browser
 *     activation never touches a split.
 *   - APG roving tablist: Arrow/Home/End move focus (shared rovingTabFocus);
 *     Enter/Space activate, handled explicitly as the status-bar strip does.
 *   - The tab is its own element and its close control is a SIBLING inside a
 *     non-interactive wrapper (audit 2026-09-03 round 3, #163), never a
 *     descendant: a focusable control nested in a role="tab" joined the tab's
 *     accessible name and put one extra stop per page into the normal Tab
 *     order. Only the CURRENT page's close button is a Tab stop; the others are
 *     reached by pointer or by activating their page first — the roving model's
 *     own rule of one stop per strip.
 *   - The tab is a `<div role="tab" tabIndex>`, like the status-bar pill
 *     (Tabs/Tab.tsx), not a `<button>`: the bespoke-button budget counts every
 *     non-canonical class on a literal `<button>`, and a tab is not a `.vm-btn`.
 *   - A page an AI run holds shows a dot on ITS tab (lease store): native views
 *     stay alive in the background, so the driven page need not be the visible
 *     one (audit 2026-09-03 #15).
 *
 * @coordinates-with BrowserChrome.tsx — parent placement wrapper
 * @coordinates-with services/browser/lease.ts — the AI-hold indicator source
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
    // `createBrowserPage` activates the page it creates: it writes `activeTabId`
    // and `lastActiveBrowserPageId` and announces ONCE on the activation bus —
    // the seam paneStore and the MRU listen on. Activating it again here (audit
    // 2026-09-03 #162) re-wrote the same two fields and announced the same
    // activation a second time, and converged nothing: panes hold documents only,
    // so a browser activation never touches the split. Pinned in
    // BrowserPageTabs.test.tsx, "new-page activation in a split view".
    useTabStore.getState().createBrowserPage(windowLabel, NEW_BROWSER_TAB_URL);
  };

  const closePage = (pageId: string) => {
    void closeTabWithDirtyCheck(windowLabel, pageId).catch(() => {
      /* best-effort: a dirty-check/close failure must not crash the UI */
    });
  };

  return (
    <div className="browser-page-tabs" role="tablist" aria-label={t("browser.pages")}>
      <TabStripButton kind="add" className="browser-page-new" onClick={createPage} label={t("browser.newPage")} />

      {pages.map((page) => {
        const active = page.id === activePageId;
        const pageLabel = page.title && page.title !== page.url ? page.title : t("browser.newPage");
        const aiHolds = leases[page.id]?.holder === "ai";
        return (
          // The wrapper is not interactive: it owns the tab's frame (CSS) and holds
          // the two sibling controls. See "Key decisions".
          <div key={page.id} className={`browser-page-tab${active ? " active" : ""}`}>
            <div
              role="tab"
              className="browser-page-tab-select"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => activateTabInFocusedPane(windowLabel, page.id)}
              onKeyDown={(event) => {
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
            </div>
            <TabStripButton
              kind="close"
              className="browser-page-tab-close"
              tabIndex={active ? 0 : -1}
              onClick={() => closePage(page.id)}
              label={t("browser.closePage", { title: pageLabel })}
            />
          </div>
        );
      })}
    </div>
  );
}
