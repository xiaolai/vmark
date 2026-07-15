/**
 * BrowserHistoryView — this window's browsing, in the sidebar (WI-S2.2).
 *
 * Shown when the active tab is a browser (ADR-2): the sidebar follows what you are
 * looking at rather than making you switch it by hand.
 *
 * Per-window, because browser events are window-routed (ADR-6) — one window's browsing is
 * not another window's business. Session-only, because a browsing history on disk is
 * sensitive and that is not a decision to make by accident; **Clear** is here anyway,
 * because "it disappears when you quit" is not the same as "you can get rid of it now".
 *
 * Clicking an entry navigates the ACTIVE browser tab, rather than reopening the tab the
 * entry came from — that tab may be long closed, and resurrecting it would be a surprise.
 *
 * @coordinates-with stores/browserHistoryStore — the records and their reducer rules
 * @coordinates-with services/browser/browserNavigation — submitOmnibox to revisit
 * @module components/Browser/BrowserHistoryView
 */
import { useTranslation } from "react-i18next";
import { useBrowserHistoryStore, type HistoryEntry } from "@/stores/browserHistoryStore";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useWindowLabel } from "@/contexts/WindowContext";
import { submitOmnibox } from "@/services/browser/browserNavigation";
import "./browser-history-view.css";

/** Stable reference. `?? []` inside a selector allocates a NEW array every render, which
 *  zustand reads as a change — and the component re-renders forever. */
const NO_ENTRIES: readonly HistoryEntry[] = [];

export function BrowserHistoryView(): React.ReactElement {
  const { t } = useTranslation("common");
  const windowLabel = useWindowLabel();
  const entries = useBrowserHistoryStore((s) => s.byWindow[windowLabel] ?? NO_ENTRIES);

  const activeBrowserTabId = useTabStore((s) => {
    const id = s.activeTabId[windowLabel];
    if (!id) return null;
    const tab = (s.tabs[windowLabel] ?? []).find((x) => x.id === id);
    return tab && isBrowserTab(tab) ? id : null;
  });

  if (entries.length === 0) {
    return <p className="browser-history-empty">{t("browser.history.empty")}</p>;
  }

  return (
    <div className="browser-history">
      <div className="browser-history-header">
        <span className="browser-history-title">{t("browser.history.heading")}</span>
        <button
          type="button"
          className="browser-history-clear"
          onClick={() => useBrowserHistoryStore.getState().clear(windowLabel)}
        >
          {t("browser.history.clear")}
        </button>
      </div>
      <ul className="browser-history-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="browser-history-item"
              // Navigate the ACTIVE browser tab. The tab this entry came from may be long
              // closed, and resurrecting it would be a surprise, not a convenience.
              disabled={!activeBrowserTabId}
              onClick={() => {
                if (activeBrowserTabId) submitOmnibox(activeBrowserTabId, entry.url);
              }}
              title={entry.url}
            >
              {entry.title && <span className="browser-history-item-title">{entry.title}</span>}
              <span className="browser-history-item-url">{entry.url}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
