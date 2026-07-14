/**
 * browserNavigation — stateless browser navigation actions (WI-S1.2 / ADR-5).
 *
 * The nav controls (back / forward / reload / stop) and the omnibox submit live in
 * the bottom `StatusBar` now (ADR-4), while the native webview is owned by
 * `BrowserSurface`. Both drive navigation through these functions rather than
 * duplicating `invoke` calls: each takes a `tabId` and issues the WI-1.2 command,
 * keeping `browserUiStore` (address-bar text, loading) and the committed
 * `BrowserTab.url` in sync. No component state, no hooks — safe to call from an
 * event handler or a store subscriber.
 *
 * @coordinates-with stores/browserUiStore — urlInput/loading updated on navigate
 * @coordinates-with stores/tabStore — committed BrowserTab.url updated on navigate
 * @coordinates-with lib/browser/omnibox — resolveOmnibox (URL-or-search), navigationTarget
 * @coordinates-with src-tauri browser commands — browser_navigate/back/forward/stop
 * @module services/browser/browserNavigation
 */
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { resolveOmnibox, navigationTarget } from "@/lib/browser/omnibox";
import { errorMessage } from "@/utils/errorMessage";

/** Load an already-resolved URL: show it in the omnibox, mark loading, and drive the
 *  native navigation.
 *
 *  It deliberately does NOT write `BrowserTab.url`. That field is the **committed**
 *  url — the page the webview actually has — and only `didCommitNavigation` knows
 *  it (the nav delegate emits it, and `BrowserSurface` records it). Writing it here,
 *  at *request* time, was wrong: a rejected or redirected navigation left the tab
 *  (and the driver's origin gate, which reads the committed url) reporting a page
 *  that never loaded. Found by the Codex review (v3, D1#5).
 *
 *  Loading is cleared by the nav-delegate events (onLoaded/onFailed); clearing it
 *  here on invoke error avoids a stuck spinner if the command itself rejects. */
function loadUrl(tabId: string, url: string): void {
  const ui = useBrowserUiStore.getState();
  ui.setUrlInput(tabId, url);
  ui.setLoading(tabId, true);
  // A new load clears the previous failure — the user is trying again, and the old
  // error is no longer what is on screen.
  ui.setError(tabId, null);
  void invoke("browser_navigate", { tabId, url }).catch((e: unknown) => {
    // Do NOT swallow this (WI-S0.9). A rejected navigate used to leave a spinner and a
    // blank rect, indistinguishable from a slow page.
    useBrowserUiStore.getState().setError(tabId, errorMessage(e));
  });
}

/** Report a failed native command instead of silently dropping it (WI-S0.9). */
function reportFailure(tabId: string): (e: unknown) => void {
  return (e: unknown) => useBrowserUiStore.getState().setError(tabId, errorMessage(e));
}

/** Submit the omnibox: classify URL-or-search, then navigate. Blank input is ignored. */
export function submitOmnibox(tabId: string, entry: string): void {
  const target = resolveOmnibox(entry);
  if (target === "") return;
  loadUrl(tabId, target);
}

/** Reload the tab's current committed url (fragment-preserving). */
export function reloadBrowser(tabId: string): void {
  const tab = useTabStore.getState().findTabById(tabId);
  if (!tab || !isBrowserTab(tab) || !tab.url) return;
  loadUrl(tabId, navigationTarget(tab.url));
}

export function backBrowser(tabId: string): void {
  void invoke("browser_back", { tabId }).catch(reportFailure(tabId));
}

export function forwardBrowser(tabId: string): void {
  void invoke("browser_forward", { tabId }).catch(reportFailure(tabId));
}

export function stopBrowser(tabId: string): void {
  void invoke("browser_stop", { tabId }).catch(reportFailure(tabId));
}
