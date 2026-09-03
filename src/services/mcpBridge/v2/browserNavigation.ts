/**
 * MCP v2 `vmark.browser.open` / `navigate` / `wait` handlers.
 *
 * Audit 2026-09-03 changes, each with its mechanism:
 *  - ONE wait budget per request (`MAX_WAIT_MS`, below the bridge's first
 *    deadline): the native-view wait and the navigation wait draw on the same
 *    deadline, so two stacked waits can no longer outlive the transport (timing).
 *  - `wait` no longer focuses the window or switches the active tab (L-03): it
 *    is advertised read-only, and a client that auto-approves read-only tools
 *    must not be able to yank the user's foreground through it. It answers from
 *    the broker and the mirror; a tab with no native view yet reports its state.
 *  - Shared posture (L-02): an `open` refused pending destination approval keeps
 *    its tab RECORD (the prompt is about that page) and tells the client to retry
 *    with `navigate {tabId}`; a fresh `open` would create a new tab the tab-bound
 *    one-shot cannot match. That `navigate` on a tab whose native view does not
 *    exist yet completes the CREATION (which consumes the one-shot) and waits on
 *    the creation ticket instead of issuing a second navigation that would demand
 *    a second approval. Denying the prompt discards the never-loaded tab
 *    (`browserTabLifecycle`).
 *
 * `open` lives in `browserOpen.ts` and the shared tail in `browserNavigationShared.ts`
 * (file-size gate); this file is `navigate` and `wait`.
 *
 * @coordinates-with services/mcpBridge/v2/browserHelpers.ts — MAX_WAIT_MS, tab resolution
 * @coordinates-with services/mcpBridge/v2/browserNavigationShared.ts — the shared tail
 * @coordinates-with services/browser/browserNativeViews.ts — native view creation
 * @coordinates-with services/browser/browserEventBroker.ts — navigation tickets
 * @module services/mcpBridge/v2/browserNavigation
 */
import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import {
  ensureBrowserNativeView,
  hasBrowserNativeView,
  waitForBrowserNativeView,
} from "@/services/browser/browserNativeViews";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { needsNavigationApproval } from "./browserFailure";
import {
  activateBrowserTarget,
  ensureBrokerStarted,
  readAiState,
  readTabIdArg,
  redactUrl,
  resolveBrowserTab,
  validateNonEmptyString,
  validateTimeout,
} from "./browserHelpers";
import { browserGate } from "./browserAccess";
import { readOperationArgs } from "./readOperationArgs";
import {
  failure,
  failureFrom,
  finishCreation,
  remaining,
  requestNavigationApproval,
  waitForNavigation,
  type NavigationResult,
} from "./browserNavigationShared";

export { handleBrowserOpen } from "./browserOpen";

export async function handleBrowserNavigate(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
    const wire = readOperationArgs("vmark.browser.navigate", args);
    if (!validateNonEmptyString(wire.url)) return failure(id, "INVALID_URL");
    const url = wire.url;
    const timeoutMs = validateTimeout(wire.timeoutMs);
    if (timeoutMs === null) return failure(id, "INVALID_TIMEOUT");
    const deadline = Date.now() + timeoutMs;
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) return failure(id, "INVALID_TAB");
    const target = resolveBrowserTab(tabIdArg ?? undefined);
    if (!target) return failure(id, "TAB_NOT_FOUND");
    if (target.automationMode === "human") return failure(id, "TAB_NOT_AI_OWNED");
    // A tab whose creation is still owed (an `open` that waited for the user):
    // creating it IS the navigation the user approved.
    const creationOwed = !hasBrowserNativeView(target.tabId);
    try {
      // The page must be visible while the AI drives it (browser.md, co-driving).
      await activateBrowserTarget(target);
      await ensureBrowserNativeView(target.tabId, creationOwed ? url : target.url, target.automationMode);
      await waitForBrowserNativeView(target.tabId, remaining(deadline));
    } catch (error) {
      if (needsNavigationApproval(error)) {
        await requestNavigationApproval(id, target.tabId, url, target.generation, "navigate");
        return;
      }
      return failureFrom(id, error, "WINDOW_UNAVAILABLE");
    }
    await ensureBrokerStarted();
    if (creationOwed) {
      await finishCreation(id, target.tabId, deadline);
      return;
    }
    let ticket: NavigationResult;
    try {
      ticket = await invoke<NavigationResult>("browser_ai_navigate", {
        tabId: target.tabId,
        url,
      });
    } catch (error) {
      if (needsNavigationApproval(error)) {
        await requestNavigationApproval(id, target.tabId, url, target.generation, "navigate");
        return;
      }
      await failureFrom(id, error);
      return;
    }
    await waitForNavigation(id, ticket.tabId, ticket.navigationId, deadline);
  });
}

export async function handleBrowserWait(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
    const wire = readOperationArgs("vmark.browser.wait", args);
    const timeoutMs = validateTimeout(wire.timeoutMs);
    if (timeoutMs === null) return failure(id, "INVALID_TIMEOUT");
    const deadline = Date.now() + timeoutMs;
    if (wire.navigationId !== undefined && !validateNonEmptyString(wire.navigationId)) {
      return failure(id, "INVALID_NAVIGATION");
    }
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) return failure(id, "INVALID_TAB");
    const target = resolveBrowserTab(tabIdArg ?? undefined);
    if (!target) return failure(id, "TAB_NOT_FOUND");
    if (target.automationMode === "human") return failure(id, "TAB_NOT_AI_OWNED");
    await ensureBrokerStarted();
    // Observe only: no focus change, no activation, no view creation. A tab whose
    // native view does not exist yet has nothing in flight to wait for.
    if (!hasBrowserNativeView(target.tabId)) {
      await respond({
        id,
        success: true,
        data: { tabId: target.tabId, url: redactUrl(target.url), generation: target.generation, loading: false },
      });
      return;
    }
    const navigationId =
      typeof wire.navigationId === "string"
        ? wire.navigationId
        : browserEventBroker.latestNavigationId(target.tabId);
    if (!navigationId) {
      const state = await readAiState(target.tabId);
      await respond({ id, success: true, data: { ...state, url: redactUrl(target.url), loading: false } });
      return;
    }
    await waitForNavigation(id, target.tabId, navigationId, deadline);
  });
}
