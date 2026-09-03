/**
 * browserTabEvents — the window-level consumer of native browser events.
 *
 * Purpose: keep every store that mirrors a browser tab honest for EVERY tab of
 * this window, whether or not the tab's surface is mounted (audit 2026-09-03
 * L-01). These updates used to live in `BrowserSurface`'s event handlers, which
 * exist only for the visible page; with native views alive in the background an
 * AI-driven tab navigates while unmounted, and its url, generation, history,
 * prompts and dialogs must still track reality.
 *
 * What each event does:
 *  - navigated: omnibox url + spinner, history entry (with the human's intent),
 *    prompts and one-shots lapse (R7a), the tab record's url + generation (the
 *    driver stamps operations with the generation, so a stale one is refused).
 *  - loaded: spinner off, title into history, crash overlay released, tab
 *    record updated with url, generation and title — the page's, or its host
 *    (an older generation is dropped by the store).
 *  - failed: the error overlay text.
 *  - crashed: the crash overlay + occluder.
 *  - dialog: the dialog + occluder, AND the tab is brought forward — a `confirm()`
 *    parks the page's JS until someone answers, so a dialog on a background tab
 *    must reach the user.
 *  - popup: recorded per tab so the chrome can offer to open it and an act can
 *    report it (X-03).
 *
 * Only tabs of THIS window are handled: the tab store may hold other windows'
 * tabs, and each window runs its own copy of this service. And only CURRENT
 * events: one stamped with an older generation than the tab's (or a failure for
 * a superseded navigationId) is ignored whole, before any side effect — the
 * store rejected only the tab-record patch, while the omnibox, history, prompts
 * and spinner were still rewritten by a late event.
 *
 * @coordinates-with services/browser/browserNavEvents — the event decoder
 * @coordinates-with components/Browser/BrowserSurface — renders dialog/crash/popup from the store
 * @coordinates-with stores/browserUiStore — the per-tab UI mirror
 * @module services/browser/browserTabEvents
 */
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserHistoryStore } from "@/stores/browserHistoryStore";
import { subscribeBrowserNavEvents } from "./browserNavEvents";
import { hostLabel } from "@/lib/browser/url";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { activateTabInFocusedPane } from "@/services/navigation/activateTabInFocusedPane";
import { browserOcclusion, OCCLUDER } from "./browserOcclusion";
import { browserEventBroker } from "./browserEventBroker";
import { takeNavIntent } from "./navIntent";

/** Is `tabId` a browser tab of this window? */
function owned(tabId: string): boolean {
  const tab = useTabStore.getState().tabs[getCurrentWindowLabel()]?.find((t) => t.id === tabId);
  return tab !== undefined && isBrowserTab(tab);
}

/**
 * Is an event stamped `generation` about the page this tab is CURRENTLY on?
 * Events cross the IPC boundary and can arrive out of order; a late one from a
 * page the tab has left must not touch the omnibox, history, prompts, dialogs
 * or spinner. The store already rejects the tab-record patch for an older
 * generation — but only that patch; every other side effect used to run.
 */
function current(tabId: string, generation: number | undefined): boolean {
  if (generation === undefined) return true;
  const tab = useTabStore.getState().tabs[getCurrentWindowLabel()]?.find((t) => t.id === tabId);
  if (!tab || !isBrowserTab(tab) || tab.generation === undefined) return true;
  return generation >= tab.generation;
}

export function startBrowserTabEvents(): () => void {
  return subscribeBrowserNavEvents(() => ({
    onNavigated: (tabId, url, generation, redirected) => {
      if (!owned(tabId) || !current(tabId, generation)) return;
      const windowLabel = getCurrentWindowLabel();
      const ui = useBrowserUiStore.getState();
      ui.ensureEntry(tabId, url);
      ui.setUrlInput(tabId, url);
      ui.setLoading(tabId, true);
      ui.setError(tabId, null); // a fresh load supersedes the previous failure
      ui.setBlockedPopup(tabId, null);
      // The driver drains page dialogs when a new load starts; mirror it.
      if (ui.entries[tabId]?.dialog) {
        ui.setDialog(tabId, null);
        browserOcclusion.removeOccluder(tabId, OCCLUDER.dialog);
      }
      // Record where the user went, and how they set off (WI-S2.2). A redirect is
      // something the SITE did — it folds into the entry rather than becoming its own.
      useBrowserHistoryStore.getState().record(windowLabel, {
        tabId,
        url,
        transitionKind: redirected ? "redirect" : takeNavIntent(tabId),
      });
      // R7a: authority and prompts lapse with the page. The driver clears its own
      // one-shots on navigation-start; this keeps the frontend's copy in step.
      useBrowserApprovalStore.getState().dismissForNavigation(tabId);
      // Record the generation with the URL: driver operations are stamped with it.
      useTabStore.getState().updateBrowserTab(tabId, { url, generation });
    },
    onLoaded: (tabId, url, title, generation) => {
      if (!owned(tabId) || !current(tabId, generation)) return;
      const windowLabel = getCurrentWindowLabel();
      const ui = useBrowserUiStore.getState();
      ui.ensureEntry(tabId, url);
      ui.setUrlInput(tabId, url);
      ui.setLoading(tabId, false);
      // The title only exists once the page finished. It is attached to the entry it
      // belongs to — a slow finish for a page we already left must not retitle this one.
      if (title) useBrowserHistoryStore.getState().setTitle(windowLabel, tabId, url, title);
      // A clean load means the process recovered — release the crash occluder.
      if (ui.entries[tabId]?.crash) {
        ui.setCrash(tabId, null);
        browserOcclusion.removeOccluder(tabId, OCCLUDER.crash);
      }
      // Stamped with the generation of the page that finished: a late `loaded` for a page
      // this tab has already left carries an older generation, and the store drops it.
      // The tab record's title follows the page too — the page's own title, or its
      // host when it has none. It was set once at creation and never updated, so the
      // page-tab strip kept naming the FIRST page after every navigation.
      useTabStore.getState().updateBrowserTab(tabId, { url, generation, title: title || hostLabel(url) });
    },
    // The webview owns the back/forward list; mirror it so the omnibox can disable
    // its history controls instead of offering no-op buttons (WI-S1.6).
    onHistoryChanged: (tabId, canGoBack, canGoForward, generation) => {
      if (owned(tabId) && current(tabId, generation)) {
        useBrowserUiStore.getState().setHistory(tabId, canGoBack, canGoForward);
      }
    },
    onFailed: (tabId, message, navigationId) => {
      // Offline, DNS failure, TLS rejection, a refused connection: the native side knows
      // exactly what went wrong and used to tell nobody (WI-S0.9). A failure that names
      // a navigation the tab has already superseded is about a page nobody is looking
      // at — it must not paint an error over the newer page that loaded fine.
      if (!owned(tabId)) return;
      const latest = browserEventBroker.latestNavigationId(tabId);
      if (navigationId !== undefined && latest !== undefined && navigationId !== latest) return;
      useBrowserUiStore.getState().setError(tabId, message);
    },
    onCrashed: (tabId, action) => {
      if (!owned(tabId)) return;
      const ui = useBrowserUiStore.getState();
      // The process that owned an open page dialog is gone, and the driver drained
      // its completion handler; a dialog left in state would sit above the recovery UI.
      if (ui.entries[tabId]?.dialog) {
        ui.setDialog(tabId, null);
        browserOcclusion.removeOccluder(tabId, OCCLUDER.dialog);
      }
      // The native view still paints over the DOM after a crash; freeze it so the
      // recovery overlay is visible in its place (WI-1.4 occlusion / WI-1.8).
      ui.setCrash(tabId, { action });
      browserOcclusion.addOccluder(tabId, OCCLUDER.crash);
    },
    onDialog: (tabId, dialog) => {
      if (!owned(tabId)) return;
      useBrowserUiStore.getState().setDialog(tabId, dialog);
      browserOcclusion.addOccluder(tabId, OCCLUDER.dialog);
      // A dialog needs a human. If the page is not on screen, bring it there — a
      // parked confirm() on a hidden tab is a page nobody can unblock.
      const windowLabel = getCurrentWindowLabel();
      if (useTabStore.getState().activeTabId[windowLabel] !== tabId) {
        activateTabInFocusedPane(windowLabel, tabId);
      }
    },
    onPopupBlocked: (tabId, url) => {
      if (owned(tabId)) useBrowserUiStore.getState().setBlockedPopup(tabId, { url, at: Date.now() });
    },
  }));
}
