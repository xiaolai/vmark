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
 *    driver stamps operations with the generation, so a stale one is refused),
 *    and the navigation id is recorded in this tab's order.
 *  - loaded: spinner off, title into history, crash overlay released, tab
 *    record updated with url, generation and title — the page's, or its host
 *    (an older generation is dropped by the store); the id joins the order.
 *  - failed: the error overlay text — unless the failure names a navigation this
 *    tab has already moved past.
 *  - crashed: the crash overlay + occluder.
 *  - dialog: the dialog + occluder, AND the tab is brought forward — a `confirm()`
 *    parks the page's JS until someone answers, so a dialog on a background tab
 *    must reach the user.
 *  - popup: recorded per tab so the chrome can offer to open it and an act can
 *    report it (X-03).
 *
 * Only tabs of THIS window are handled: the tab store may hold other windows'
 * tabs, and each window runs its own copy of this service. And only CURRENT
 * events, guarded twice. Here, one stamped with an older generation than the
 * tab's is ignored whole, before any side effect — history, prompts, the tab
 * record. And every page-state write into `browserUiStore` is STAMPED with the
 * event's generation, so the store itself refuses a late one (round 3, #154)
 * rather than relying on this handler alone.
 *
 * A failure is judged by the ORDER of the navigation ids this service has itself
 * seen (`NavigationOrder`, #87 rounds 3–4). The driver mints `nav-<tabId>-<n>` from
 * one monotonic counter per tab, so a failure whose sequence is below the highest
 * this tab has shown — from a commit, a finish, or an earlier failure — is about a
 * page nobody is looking at, and is dropped; a provisional failure (DNS, TLS,
 * refused) is the highest when it arrives, so it shows, and a late report about
 * it is below whatever came next. The order is fed by this service's own events
 * and is a maximum, so the verdict cannot depend on the broker — which listens to
 * the same failure and adopts its id as "latest" — nor on listener registration
 * order. An id that carries no order (an older driver's `legacy-<tabId>`, a
 * malformed one) falls back to being shown.
 *
 * @coordinates-with services/browser/browserNavEvents — the handler adapter over the shared event hub
 * @coordinates-with services/browser/navigationOrder — the per-tab order of navigation ids
 * @coordinates-with components/Browser/BrowserSurface — renders dialog/crash/popup from the store
 * @coordinates-with stores/browserUiStore — the per-tab UI mirror, generation-aware
 * @coordinates-with stores/tabRemovalBus — a closed tab's ledger is dropped
 * @module services/browser/browserTabEvents
 */
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserHistoryStore } from "@/stores/browserHistoryStore";
import { subscribeBrowserNavEvents } from "./browserNavEvents";
import { hostLabel } from "@/lib/browser/url";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { activateTabInFocusedPane } from "@/services/navigation/activateTabInFocusedPane";
import { browserOcclusion, OCCLUDER } from "./browserOcclusion";
import { NavigationOrder } from "./navigationOrder";
import { takeNavIntent } from "./navIntent";

/** Is `tabId` a browser tab of this window? */
function owned(tabId: string): boolean {
  const tab = useTabStore.getState().tabs[getCurrentWindowLabel()]?.find((t) => t.id === tabId);
  return tab !== undefined && isBrowserTab(tab);
}

/**
 * Is an event stamped `generation` about the page this tab is CURRENTLY on?
 * Events cross the IPC boundary and can arrive out of order; a late one from a
 * page the tab has left must not touch the history, prompts or tab record. The
 * UI store carries its own generation and refuses a stale stamp itself.
 */
function current(tabId: string, generation: number | undefined): boolean {
  if (generation === undefined) return true;
  const tab = useTabStore.getState().tabs[getCurrentWindowLabel()]?.find((t) => t.id === tabId);
  if (!tab || !isBrowserTab(tab) || tab.generation === undefined) return true;
  return generation >= tab.generation;
}

export function startBrowserTabEvents(): () => void {
  const order = new NavigationOrder();
  const stopForgetting = onTabRemoved((_windowLabel, tabId) => order.forget(tabId));
  const stopEvents = subscribeBrowserNavEvents(() => ({
    onNavigated: (tabId, url, generation, redirected, navigationId) => {
      if (!owned(tabId) || !current(tabId, generation)) return;
      if (navigationId !== undefined) order.observe(tabId, navigationId);
      const windowLabel = getCurrentWindowLabel();
      const ui = useBrowserUiStore.getState();
      ui.ensureEntry(tabId, url, generation);
      ui.setUrlInput(tabId, url, generation);
      ui.setLoading(tabId, true, generation);
      ui.setError(tabId, null, generation); // a fresh load supersedes the previous failure
      ui.setBlockedPopup(tabId, null, generation);
      // The driver drains page dialogs when a new load starts; mirror it.
      if (ui.entries[tabId]?.dialog) {
        ui.setDialog(tabId, null, generation);
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
    onLoaded: (tabId, url, title, generation, navigationId) => {
      if (!owned(tabId) || !current(tabId, generation)) return;
      if (navigationId !== undefined) order.observe(tabId, navigationId);
      const windowLabel = getCurrentWindowLabel();
      const ui = useBrowserUiStore.getState();
      ui.ensureEntry(tabId, url, generation);
      ui.setUrlInput(tabId, url, generation);
      ui.setLoading(tabId, false, generation);
      // The title only exists once the page finished. It is attached to the entry it
      // belongs to — a slow finish for a page we already left must not retitle this one.
      if (title) useBrowserHistoryStore.getState().setTitle(windowLabel, tabId, url, title);
      // A clean load means the process recovered — release the crash occluder.
      if (ui.entries[tabId]?.crash) {
        ui.setCrash(tabId, null, generation);
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
        useBrowserUiStore.getState().setHistory(tabId, canGoBack, canGoForward, generation);
      }
    },
    onFailed: (tabId, message, navigationId) => {
      // Offline, DNS failure, TLS rejection, a refused connection: the native side knows
      // exactly what went wrong and used to tell nobody (WI-S0.9). A failure that names
      // a navigation the tab has already moved past is about a page nobody is looking
      // at — it must not paint an error over the newer page that loaded fine. One that
      // is the newest thing the tab did is shown AND joins the order, so a later report
      // about an older navigation cannot replace it. A failure carries no generation (a
      // provisional load never committed one), so it is written unstamped.
      if (!owned(tabId)) return;
      if (navigationId !== undefined) {
        if (order.isSuperseded(tabId, navigationId)) return;
        order.observe(tabId, navigationId);
      }
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
  return () => {
    stopEvents();
    stopForgetting();
  };
}
