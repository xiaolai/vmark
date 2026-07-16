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
import { Globe2, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BrowserTab } from "@/stores/tabStoreTypes";
import { useTabStore } from "@/stores/tabStore";
import { activateTabInFocusedPane } from "@/services/navigation/activateTabInFocusedPane";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { isRovingNavKey, moveRovingTabFocus } from "@/utils/rovingTabFocus";
import { NEW_BROWSER_TAB_URL } from "@/services/commands/browserCommands";

interface BrowserPageTabsProps {
  pages: BrowserTab[];
  activePageId: string;
  windowLabel: string;
}

export function BrowserPageTabs({ pages, activePageId, windowLabel }: BrowserPageTabsProps): React.ReactElement {
  const { t } = useTranslation("common");

  const createPage = () => {
    const id = useTabStore.getState().createBrowserPage(windowLabel, NEW_BROWSER_TAB_URL);
    // Route through the pane-aware activation so a split view shows the new
    // page in the focused pane rather than swapping the primary active tab.
    activateTabInFocusedPane(windowLabel, id);
  };

  return (
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

      {pages.map((page) => {
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
}
