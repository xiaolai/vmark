/**
 * browserTabLifecycle — when a browser tab's native view is destroyed, and by whom.
 *
 * Purpose: the native WKWebView is kept alive while its tab exists (audit
 * 2026-09-03 L-01 — `useBrowserNativeView` hides it on unmount instead of
 * destroying it), so SOMETHING must destroy it when the tab actually goes. That
 * is the tab-removal bus: `closeTab` and `detachTab` are the single choke point
 * for a tab leaving a window, and every browser tab that leaves through them —
 * closed by the user, closed by the AI (`browser.close`), moved to another window
 * — has its view torn down here.
 *
 * The second job is the never-loaded AI tab (L-02): a shared-posture `open` that
 * waits for the user's destination approval keeps its tab record so the retry
 * can reuse it. If the user DENIES, that record is an empty tab nobody asked to
 * keep, and `approvalDenied` discards it.
 *
 * Started once per document window from `useCommandBootstrap`, like the other
 * browser wirings.
 *
 * @coordinates-with stores/tabRemovalBus — the removal signal
 * @coordinates-with services/browser/browserNativeViews — destroyBrowserNativeView
 * @coordinates-with components/Browser/BrowserApprovalDialog — approvalDenied
 * @module services/browser/browserTabLifecycle
 */
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import type { PendingApproval } from "@/stores/browserApprovalStore.types";
import { destroyBrowserNativeView, hasBrowserNativeView } from "./browserNativeViews";

/** Destroy the native view of every browser tab that leaves a window. */
export function startBrowserTabLifecycle(): () => void {
  return onTabRemoved((_windowLabel, tabId, info) => {
    const isBrowser = info ? info.tab.kind === "browser" : hasBrowserNativeView(tabId);
    if (!isBrowser) return;
    void destroyBrowserNativeView(tabId);
  });
}

/**
 * The user denied a prompt. Resolve it, and if it was the destination approval
 * for an AI tab that never loaded (an `open` still owed its creation), close
 * that empty tab: nothing will ever load into it now.
 */
export function approvalDenied(request: PendingApproval): void {
  useBrowserApprovalStore.getState().resolveApproval(request.id, "deny");
  if (request.operation !== "navigate" || !request.tabId) return;
  const tabs = useTabStore.getState();
  const tab = tabs.findTabById(request.tabId);
  if (!tab || !isBrowserTab(tab) || (tab.automationMode ?? "human") === "human") return;
  if (tab.generation !== undefined || hasBrowserNativeView(tab.id)) return;
  const windowLabel = Object.entries(tabs.tabs).find(([, list]) => list.some((t) => t.id === tab.id))?.[0];
  if (windowLabel) tabs.closeTab(windowLabel, tab.id);
}
