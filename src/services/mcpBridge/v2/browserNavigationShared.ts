/**
 * browserNavigationShared — the pieces `open`, `navigate` and `wait` share: the
 * single wait budget, the navigation-ticket wait and its result mapping, the
 * pending-approval envelope with its retry verb, and creation completion for a
 * tab whose `open` waited for the user (audit 2026-09-03 L-02). Split from
 * `browserNavigation.ts` for the file-size gate.
 *
 * @coordinates-with services/mcpBridge/v2/browserNavigation — navigate + wait
 * @coordinates-with services/mcpBridge/v2/browserOpen — open
 * @module services/mcpBridge/v2/browserNavigationShared
 */
import { respond } from "@/services/mcpBridge/utils";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { bridgeErrorEnvelope } from "./bridgeError";
import { readAiState, redactUrl } from "./browserHelpers";
import { probeGate } from "./browserGateProbe";
import type { BrowserTarget } from "./browserHelpers";
import { mintOneShotConfirmed } from "@/services/browser/grantSync";
import { grantPatternFor } from "@/stores/browserApprovalStore.helpers";

export type NavigationResult = { tabId: string; navigationId: string };

export function failure(id: string, error: string, data?: unknown): Promise<void> {
  return respond({ id, success: false, error, ...(data === undefined ? {} : { data }) });
}

/**
 * Respond with a thrown value as the failure envelope — `TOKEN: message` plus the
 * typed detail (`data.code`, `data.token`, `data.detail`) for a typed error. A
 * bare token used to be all the model got: an `open` that died in the native
 * layer read `INTERNAL`, with the classifier's `kind` and the driver's reason
 * dropped on the floor. An UNTYPED failure (the surface never registered, a
 * timeout) is reported under `fallbackToken` with its message.
 */
export function failureFrom(id: string, error: unknown, fallbackToken?: string): Promise<void> {
  const envelope = bridgeErrorEnvelope(error);
  if (!envelope.data && fallbackToken) {
    return respond({ id, success: false, error: `${fallbackToken}: ${envelope.error}` });
  }
  return respond({ id, success: false, ...envelope });
}

/** Time left on a request's single wait budget (never below 1 ms). */
export function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

export async function requestNavigationApproval(
  id: string,
  tabId: string,
  url: string,
  generation: number,
  /** The verb the client should retry with once the user approves. */
  retry: "navigate" | "open",
): Promise<boolean> {
  const queued = useBrowserApprovalStore
    .getState()
    .requestApproval(id, url, "navigate", undefined, tabId, generation);
  // No prompt exists to approve: a needsApproval envelope would be a lie.
  if (queued === "overloaded" || queued === "rejected") {
    await failure(id, "approval queue is full — resolve or deny pending approvals, then retry");
    return false;
  }
  await failure(id, "APPROVAL_REQUIRED", {
    needsApproval: true,
    operation: "navigate",
    url: redactUrl(url),
    tabId,
    generation,
    // The one-shot is bound to THIS tab; a fresh `open` would mint a tab it cannot
    // match. The sidecar renders this into its "then try again" prose.
    retry: { action: retry, tabId },
  });
  return true;
}

/**
 * Drop a provisional AI tab whose creation never completed. Detaching runs the
 * tab-removal lifecycle, which destroys whatever native view exists — a direct
 * `browser_destroy` here issued the same teardown twice and bypassed that path.
 */
export function discardUncreatedAiTab(tabId: string, windowLabel: string): void {
  useTabStore.getState().detachTab(windowLabel, tabId);
}

/**
 * If the user approved THIS navigation with "Allow once", spend the mirror's copy
 * and wait until the driver holds the authorization. Without the wait a fast
 * retry reached `browser_ai_navigate` before `grantSync` had pushed the mint and
 * was refused despite the approval. Returns false only when the driver REFUSED the
 * mint (a stale generation); with no local one-shot the driver decides on its own.
 */
export async function confirmNavigationOneShot(tab: BrowserTarget, url: string): Promise<boolean> {
  const spent = useBrowserApprovalStore
    .getState()
    .consumeOneShot(url, "navigate", undefined, tab.tabId, undefined, tab.generation);
  if (!spent) return true;
  const pattern = grantPatternFor(url);
  if (pattern === null) return false;
  return mintOneShotConfirmed({
    originPattern: pattern,
    operation: "navigate",
    tabId: tab.tabId,
    generation: tab.generation,
  });
}

function eventData(result: Awaited<ReturnType<typeof browserEventBroker.wait>>, tabId: string) {
  if (result.kind === "loaded") {
    return {
      tabId,
      url: redactUrl(result.url),
      title: result.title,
      navigationId: result.navigationId,
      generation: result.generation,
      loading: false,
    };
  }
  return { tabId, navigationId: "navigationId" in result ? result.navigationId : undefined, loading: false };
}

export async function waitForNavigation(
  id: string,
  tabId: string,
  navigationId: string,
  deadline: number,
): Promise<void> {
  const result = await browserEventBroker.wait(tabId, navigationId, remaining(deadline));
  if (result.kind === "loaded") {
    // Persist the committed generation (and url) onto the tab record. `open`
    // waits on the broker for the initial load, whose event may be consumed here
    // before the window-level tab sync sees it — so without this the tab keeps
    // `generation: undefined`, resolveBrowserTab defaults it to 0, and the driver
    // rejects the first read/act as a stale command. The store ignores an older
    // generation, so this never regresses a tab the sync already advanced.
    useTabStore.getState().updateBrowserTab(tabId, {
      url: result.url,
      generation: result.generation,
    });
    // Advisory gate verdict (WI-NB2.2): best-effort, absent for ordinary pages
    // and on any probe failure — a gate must never degrade a loaded result. It
    // is also bounded by what is LEFT of the request's budget: a slow page could
    // hold the eval for seconds and push the response past the bridge deadline.
    const gate = await Promise.race([
      probeGate(tabId, result.generation),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), remaining(deadline))),
    ]);
    await respond({
      id,
      success: true,
      data: { ...eventData(result, tabId), ...(gate ? { gate } : {}) },
    });
  } else if (result.kind === "failed") {
    await failure(id, "NAVIGATION_FAILED", {
      ...eventData(result, tabId),
      error: result.message,
    });
  } else if (result.kind === "superseded") {
    await failure(id, "NAVIGATION_SUPERSEDED", eventData(result, tabId));
  } else if (result.kind === "timeout") {
    // The ticket is still live: a later `wait {navigationId}` retrieves the
    // terminal result. The sidecar passes this data through (audit E-02).
    await failure(id, "TIMEOUT", eventData(result, tabId));
  } else if (result.kind === "disabled") {
    await failure(id, "BROWSER_DISABLED", eventData(result, tabId));
  } else if (result.kind === "unmounted") {
    await failure(id, "WINDOW_UNAVAILABLE", eventData(result, tabId));
  } else {
    await failure(id, "TAB_NOT_FOUND");
  }
}

/** Complete a creation started earlier (an `open` that waited for approval) and
 *  wait on ITS ticket — issuing `browser_ai_navigate` on top would ask for a second
 *  approval for the same page. */
export async function finishCreation(id: string, tabId: string, deadline: number): Promise<void> {
  let state: Record<string, unknown>;
  try {
    state = await readAiState(tabId);
  } catch (error) {
    await failureFrom(id, error);
    return;
  }
  const navigationId = typeof state.navigationId === "string" ? state.navigationId : undefined;
  if (!navigationId) {
    await failure(id, "WINDOW_UNAVAILABLE");
    return;
  }
  await waitForNavigation(id, tabId, navigationId, deadline);
}

