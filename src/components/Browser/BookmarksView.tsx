/**
 * BookmarksView — saved pages, in the sidebar (WI-S3.2 / WI-S3.3).
 *
 * Shown when the active tab is a browser (ADR-2). Opening a bookmark navigates the active
 * browser tab if there is one, and otherwise CREATES one — a bookmark is reachable from a
 * document tab too (a user may want to open one while writing), and "nothing happened"
 * would be a poor answer.
 *
 * @coordinates-with stores/bookmarkStore — the persisted set
 * @coordinates-with stores/tabStore — createBrowserTab when there is no browser open
 * @coordinates-with services/browser/browserNavigation — submitOmnibox to navigate one
 * @module components/Browser/BookmarksView
 */
import { useTranslation } from "react-i18next";
import { useBookmarkStore } from "@/stores/bookmarkStore";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useWindowLabel } from "@/contexts/WindowContext";
import { submitOmnibox } from "@/services/browser/browserNavigation";
import "./browser-history-view.css";

export function BookmarksView(): React.ReactElement {
  const { t } = useTranslation("common");
  const windowLabel = useWindowLabel();
  const bookmarks = useBookmarkStore((s) => s.bookmarks);

  const open = (url: string) => {
    const state = useTabStore.getState();
    const activeId = state.activeTabId[windowLabel];
    const active = activeId
      ? (state.tabs[windowLabel] ?? []).find((tab) => tab.id === activeId)
      : undefined;

    if (active && isBrowserTab(active)) {
      submitOmnibox(active.id, url);
      return;
    }
    // No browser to navigate — a bookmark opened from a document tab makes one.
    state.createBrowserTab(windowLabel, url);
  };

  if (bookmarks.length === 0) {
    return <p className="browser-history-empty">{t("browser.bookmarks.empty")}</p>;
  }

  return (
    <div className="browser-history">
      <div className="browser-history-header">
        <span className="browser-history-title">{t("browser.bookmarks.heading")}</span>
      </div>
      <ul className="browser-history-list">
        {bookmarks.map((bookmark) => (
          <li key={bookmark.id} className="browser-bookmark-row">
            <button
              type="button"
              className="browser-history-item"
              onClick={() => open(bookmark.url)}
              title={bookmark.url}
            >
              <span className="browser-history-item-title">{bookmark.title || bookmark.url}</span>
              <span className="browser-history-item-url">{bookmark.url}</span>
            </button>
            <button
              type="button"
              className="browser-bookmark-remove"
              aria-label={t("browser.bookmarks.removeLabel", { title: bookmark.title || bookmark.url })}
              onClick={() => useBookmarkStore.getState().remove(bookmark.url)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
