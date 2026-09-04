/**
 * browserActFlow — the approval → one-shot → driver flow behind `act`.
 *
 * Split from `browserAct.ts` for the file-size gate; the handler parses and
 * validates, this module authorizes and acts. Three contracts live here:
 *
 *  - A `{role,name}` act authorizes through the shared approval machine
 *    (`browserApprovalFlow`, round 3 #43): the frontend one-shot is consumed with
 *    the EXACT script (payload-binding ops) and the current generation, and the
 *    driver's mint confirmation is AWAITED before invoking — one mint path
 *    (audit A-04). This module decides WHAT is bound: a click binds its element,
 *    `type`/`key`/`scroll` bind the built script.
 *  - A driver rejection propagates as its typed token. A `<timeout>`-class
 *    failure used to be read as "the click did not affect the target", which
 *    invites a retry while the enqueued script is still running (E-03).
 *  - The response carries what happened: page state after the act, a popup the
 *    page tried to open during it (X-03), and prose that names the next tool.
 *
 * @coordinates-with services/mcpBridge/v2/browserAct.ts — the caller
 * @coordinates-with services/mcpBridge/v2/browserApprovalFlow.ts — the shared approval machine
 * @coordinates-with stores/browserUiStore.ts — blocked-popup record
 * @module services/mcpBridge/v2/browserActFlow
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { originForAgent, urlForAgent } from "@/lib/browser/url";
import { resolveBrowserTab, type BrowserTarget, scriptTooLarge } from "./browserHelpers";
import { invokeAttached } from "./browserAccess";
import { authorizeOperation } from "./browserApprovalFlow";
import { parseEvalResult } from "./browserReadClass";

export type ActOp = "click" | "type" | "scroll" | "key";
/** Which result flag means the action actually landed (not merely evaluated). */
const SUCCESS_FLAG: Record<ActOp, string> = {
  click: "clicked",
  type: "typed",
  scroll: "scrolled",
  key: "dispatched",
};

function actionSucceeded(operation: ActOp, result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  return (result as Record<string, unknown>)[SUCCESS_FLAG[operation]] === true;
}

/** Turn a structured act failure into prose that names the next tool — the
 *  NeoBrowser lesson: a refusal the model can act on beats a bare false. */
function failureHint(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const r = result as { reason?: string; by?: string; matchedTotal?: number; matchedVisible?: number };
  switch (r.reason) {
    case "obscured":
      return r.by
        ? `: covered by \`${r.by}\` (page data) — dismiss or hide the overlay (browser.style), then retry`
        : ": covered by another element — dismiss or hide the overlay (browser.style), then retry";
    case "hidden":
      return `: matched ${r.matchedTotal ?? 0} element(s), none visibly rendered — the page may still be loading (browser_read wait_for), or the control lives in a collapsed section`;
    case "ambiguous":
      return `: ${r.matchedVisible ?? 0} visible elements share this role and name — refuse to guess; read the page and act by ref under a standing grant, or narrow the name`;
    case "offscreen":
      return ": the element cannot be scrolled into the viewport — it is positioned off-screen";
    case "disabled":
      return ": the target is disabled";
    case "upload":
      return ": file uploads are never automated — the user must choose files themselves";
    case "rejected-value":
      return ": the field rejected the value (the engine sanitised it) — check the input type";
    default:
      return "";
  }
}

type BlockedPopup = NonNullable<ReturnType<typeof useBrowserUiStore.getState>["entries"][string]>["blockedPopup"];

/** The popup record on the tab right now — captured BEFORE an act so the one
 *  reported afterwards is compared by identity, not by a millisecond timestamp
 *  that a popup recorded in the same millisecond as the act would share. */
function currentPopup(tabId: string): BlockedPopup {
  return useBrowserUiStore.getState().entries[tabId]?.blockedPopup ?? null;
}

/** A popup the page tried to open during this act, if the event arrived. */
function popupDuring(tabId: string, before: BlockedPopup): { url: string } | undefined {
  const popup = currentPopup(tabId);
  if (!popup || popup === before) return undefined;
  return { url: urlForAgent(popup.url) };
}

/** Invoke browser_eval for a built act `script` and report the ACTION outcome.
 *  `target` binds a one-shot on the role/name path; ref/scroll/key pass none. */
export async function finishAct(
  id: string,
  tab: BrowserTarget,
  operation: ActOp,
  script: string,
  target?: { role: string; name: string },
): Promise<void> {
  const tooLarge = scriptTooLarge(script, `${operation} script`);
  if (tooLarge) {
    await respond({ id, success: false, error: tooLarge });
    return;
  }
  const popupBefore = currentPopup(tab.tabId);
  // A driver rejection (stale generation, eval timeout, not granted…) is thrown
  // to `wrapHandler`, which renders its token; it is NOT a "did not affect" result.
  const raw = await invokeAttached(tab, () =>
    invoke<string>("browser_eval", {
      tabId: tab.tabId,
      script,
      operation,
      generation: tab.generation,
      ...(target ?? {}),
    }),
  );
  const result = parseEvalResult(raw);
  // Re-resolve AFTER the act (WI-NB1.3): a click that navigated may already have
  // bumped the webview mirror, and the model needs the freshest page state it can
  // get without a second round-trip. (A navigation landing later is still possible
  // — that is what wait_for is for; the primer says so.)
  const fresh = resolveBrowserTab(tab.tabId) ?? tab;
  const popup = popupDuring(tab.tabId, popupBefore);
  const page = {
    url: urlForAgent(fresh.url),
    generation: fresh.generation,
    ...(popup ? { popup } : {}),
  };
  if (!actionSucceeded(operation, result)) {
    await respond({
      id,
      success: false,
      error: `${operation} did not affect the target${failureHint(result)}`,
      data: { result, ...page },
    });
    return;
  }
  await respond({ id, success: true, data: { result, ...page } });
}

/**
 * Authorize through the shared approval machine (`browserApprovalFlow`: grant →
 * one-shot → prompt → mint), then act. `target` is the role/name binding, or
 * undefined for a target-less op (scroll/key); `script` is bound into the one-shot
 * for the payload-binding ops (`type`, `key`, `scroll` — a click binds its element
 * instead) and `payloadSummary` is what the prompt shows.
 */
export async function approveAndAct(
  id: string,
  tab: BrowserTarget,
  operation: ActOp,
  target: { role: string; name: string } | undefined,
  script: string,
  payloadSummary?: string,
): Promise<void> {
  // Refused BEFORE the approval queue: an oversized script the driver will always
  // reject must not be parked in the queue and approved repeatedly.
  const tooLarge = scriptTooLarge(script, `${operation} script`);
  if (tooLarge) {
    await respond({ id, success: false, error: tooLarge });
    return;
  }
  const outcome = await authorizeOperation(id, tab, {
    operation,
    ...(target ? { target } : {}),
    ...(operation !== "click" ? { script } : {}),
    ...(payloadSummary !== undefined ? { payloadSummary } : {}),
  });
  if (outcome !== "authorized") return;
  await finishAct(id, tab, operation, script, target);
}

/** Refuse a ref action that is not covered by a standing grant (an approval must
 *  show the user a legible element, not a bare ref). Returns whether it refused. */
export async function refuseUngrantedRef(id: string, tab: BrowserTarget, operation: ActOp): Promise<boolean> {
  if (useBrowserApprovalStore.getState().decide(tab.url, operation) === "allowed") return false;
  await respond({
    id,
    success: false,
    error:
      `ref actions need a standing grant for '${operation}' on ${originForAgent(tab.url)}; ` +
      "for a one-time approval retry with role+name so the user can see the element",
    data: { operation, url: originForAgent(tab.url), tabId: tab.tabId, generation: tab.generation },
  });
  return true;
}
