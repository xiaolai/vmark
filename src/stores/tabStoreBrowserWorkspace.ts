import type { BrowserAutomationMode, Tab } from "./tabStoreTypes";
import { browserTabUrl, findBrowserTab, makeBrowserTab } from "./tabStoreBrowser";
import { generateTabId } from "./tabStoreHelpers";

type BrowserStoreState = {
  tabs: Record<string, Tab[]>;
  activeTabId: Record<string, string | null>;
};

type BrowserStoreSetter = (
  updater: (state: BrowserStoreState) => Partial<BrowserStoreState>,
) => void;

/**
 * Append a browser page to a window and activate it, returning the active page
 * id. With `dedup`, an existing page for the same canonical url + automation
 * mode is reused (and activated) instead of appending a second one.
 *
 * Browser creation lives here so the general tab store stays focused on shared
 * lifecycle. The id comes from the shared `generateTabId` so the tab-id format
 * cannot drift from the rest of the store.
 */
function addBrowserPage(
  set: BrowserStoreSetter,
  windowLabel: string,
  url: string,
  title: string | undefined,
  automationMode: BrowserAutomationMode,
  dedup: boolean,
): string {
  const canonical = browserTabUrl(url);
  const id = generateTabId();
  let returnId = id;
  set((state) => {
    const windowTabs = state.tabs[windowLabel] || [];
    if (dedup) {
      const existing = findBrowserTab(windowTabs, canonical, automationMode);
      if (existing) {
        returnId = existing.id;
        return { activeTabId: { ...state.activeTabId, [windowLabel]: existing.id } };
      }
    }
    return {
      tabs: { ...state.tabs, [windowLabel]: [...windowTabs, makeBrowserTab(id, canonical, title, automationMode)] },
      activeTabId: { ...state.activeTabId, [windowLabel]: id },
    };
  });
  return returnId;
}

/** Create-or-reuse a browser tab by canonical url (the "New Browser Tab" command). */
export function createBrowserTabAction(
  set: BrowserStoreSetter,
  windowLabel: string,
  url: string,
  title: string | undefined,
  automationMode: BrowserAutomationMode,
): string {
  return addBrowserPage(set, windowLabel, url, title, automationMode, true);
}

/** Always create a fresh browser page (the workspace "+" / new-page action). */
export function createBrowserPageAction(
  set: BrowserStoreSetter,
  windowLabel: string,
  url: string,
  title: string | undefined,
  automationMode: BrowserAutomationMode,
): string {
  return addBrowserPage(set, windowLabel, url, title, automationMode, false);
}
