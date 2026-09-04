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
 * The third job is the one entry point for closing a browser tab BY ID through
 * the store (`closeBrowserTabById`), so that everything above runs: it backs
 * `approvalDenied`, the MCP `browser.close` handler, and the DEV-only
 * `__VMARK_DEBUG__.closeBrowserTab` seam the E2E teardown uses instead of a bare
 * `browser_destroy`. Unlike the bus subscriber it AWAITS the teardown and then
 * CONFIRMS it with the driver (round 3, #44): `destroyBrowserNativeView` reports a
 * native failure with a warning and resolves anyway, and `browser_destroy` is
 * idempotent — a second call for a destroyed or unknown tab is a no-op — so one
 * more call is free when the view is gone and a real, observed attempt when it is
 * not. Its rejection is the one signal the shared teardown swallows, and it is
 * what lets a caller refuse to report a closure it cannot vouch for.
 *
 * Started once per document window from `useCommandBootstrap`, like the other
 * browser wirings.
 *
 * @coordinates-with stores/tabRemovalBus — the removal signal
 * @coordinates-with services/browser/browserNativeViews — destroyBrowserNativeView
 * @coordinates-with src-tauri browser/commands.rs — browser_destroy, the idempotent confirmation
 * @coordinates-with services/mcpBridge/v2/browserClose — reports the confirmed outcome to the AI
 * @coordinates-with components/Browser/BrowserApprovalDialog — approvalDenied
 * @coordinates-with hooks/useCommandBootstrap — publishes closeBrowserTabById as the DEV seam
 * @module services/browser/browserTabLifecycle
 */
import { invoke } from "@tauri-apps/api/core";
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import type { PendingApproval } from "@/stores/browserApprovalStore.types";
import { commandErrorMessage } from "@/services/commands/commandError";
import { destroyBrowserNativeView, hasBrowserNativeView } from "./browserNativeViews";

/** Destroy the native view of every browser tab that leaves a window. */
export function startBrowserTabLifecycle(): () => void {
  return onTabRemoved((_windowLabel, tabId, info) => {
    const isBrowser = info ? info.tab.kind === "browser" : hasBrowserNativeView(tabId);
    if (!isBrowser) return;
    void destroyBrowserNativeView(tabId);
  });
}

/** The window whose tab list holds `tabId`, if any. */
function windowOf(tabId: string): string | undefined {
  return Object.entries(useTabStore.getState().tabs).find(([, list]) =>
    list.some((t) => t.id === tabId),
  )?.[0];
}

/**
 * What closing a browser tab left behind: whether the driver confirmed the native
 * view is gone, and if not, why — the tab RECORD is gone either way.
 */
export type BrowserTabCloseOutcome = { destroyed: true } | { destroyed: false; reason: string };

/**
 * Close a browser tab by id THROUGH the tab store, so the whole lifecycle runs:
 * the removal bus fires, `destroyBrowserNativeView` withdraws the tab's prompts
 * and one-shots, drops its omnibox entry and destroys the native view — then wait
 * for that teardown and confirm it with the driver. Resolves `null` when no browser
 * tab was closed: an unknown id, a document tab (left alone), or a pinned tab the
 * store refused. Callers that need only "did anything close?" test truthiness.
 *
 * Published as the DEV-only `__VMARK_DEBUG__.closeBrowserTab` seam for the E2E
 * harness, whose teardown used to call `browser_destroy` directly: Rust forgot
 * the tab while the frontend kept its record and every prompt raised against it,
 * and later journeys inherited ghost pages and a queue of prompts for tabs the
 * driver no longer knew.
 */
export async function closeBrowserTabById(tabId: string): Promise<BrowserTabCloseOutcome | null> {
  const tabs = useTabStore.getState();
  const tab = tabs.findTabById(tabId);
  if (!tab || !isBrowserTab(tab)) return null;
  const windowLabel = windowOf(tabId);
  if (windowLabel === undefined || !tabs.closeTab(windowLabel, tabId)) return null;
  // The bus subscriber has started the teardown fire-and-forget (a user's close
  // never waits on the driver); this joins that in-flight teardown — or performs
  // it, when no lifecycle is running — and only then asks the driver.
  await destroyBrowserNativeView(tabId);
  try {
    await invoke("browser_destroy", { tabId });
    return { destroyed: true };
  } catch (error) {
    return { destroyed: false, reason: commandErrorMessage(error) };
  }
}

/**
 * The user denied a prompt. Resolve it, and if it was the destination approval
 * for an AI tab that never loaded (an `open` still owed its creation), close
 * that empty tab: nothing will ever load into it now.
 */
export function approvalDenied(request: PendingApproval): void {
  useBrowserApprovalStore.getState().resolveApproval(request.id, "deny");
  if (request.operation !== "navigate" || !request.tabId) return;
  const tab = useTabStore.getState().findTabById(request.tabId);
  if (!tab || !isBrowserTab(tab) || (tab.automationMode ?? "human") === "human") return;
  if (tab.generation !== undefined || hasBrowserNativeView(tab.id)) return;
  // A denial has no caller to report the teardown outcome to; the shared
  // teardown's own warning covers a native failure here.
  void closeBrowserTabById(tab.id);
}
