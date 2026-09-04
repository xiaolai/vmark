/**
 * Shared read-class execution for the MCP browser handlers (WI-P1.2 / audit #8).
 *
 * `read` and `screenshot` are both non-mutating "read-class" ops with the exact
 * same envelope: feature gate → tab resolution → human-attachment gate → a native
 * invoke → mirrored attachment consumption → respond. Factoring that here removes
 * the duplication between `handleBrowserRead` and `handleBrowserScreenshot` and,
 * because `requireHumanAttachment` lives here rather than in `browser.ts`, breaks
 * the `browser.ts` ↔ `browserScreenshot.ts` dependency cycle (a `lint:deps`
 * `no-circular` error).
 *
 * This layer keeps the human in the loop; the Rust driver is the authoritative
 * gate (browser/authorize.rs). The feature/platform gate, the tab resolution and
 * the attachment mirror discipline live in `browserAccess.ts`, and the prompt step
 * behind `requireHumanAttachment` in `browserApprovalFlow.ts` — both shared with
 * the act-class handlers. A post-authorization data response passes URLs
 * through `urlForAgent` (path kept); a PRE-authorization approval envelope uses
 * `originForAgent` (origin only) so a credential-bearing path can't leak.
 *
 * @coordinates-with services/mcpBridge/v2/browser.ts — handleBrowserRead / handleBrowserAct
 * @coordinates-with services/mcpBridge/v2/browserScreenshot.ts — handleBrowserScreenshot
 * @coordinates-with services/mcpBridge/v2/browserAccess.ts — gate + tab resolution + attachment mirror
 * @coordinates-with services/mcpBridge/v2/browserApprovalFlow.ts — the attach prompt step
 * @module services/mcpBridge/v2/browserReadClass
 */

import { respond } from "@/services/mcpBridge/utils";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import type { BrowserTarget } from "./browserHelpers";
import { invokeAttached, resolveBrowserTarget } from "./browserAccess";
import { queueApprovalPrompt } from "./browserApprovalFlow";

/** Parse a `browser_eval` string result as JSON, falling back to the raw string
 *  (shared by read and act). A completed eval returns a JSON payload; anything
 *  else is handed back verbatim rather than throwing. */
export function parseEvalResult(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Ensure the AI may touch this tab. A non-human tab needs no attachment; a human
 * tab needs an explicit one, and without it this queues an `attach` approval,
 * responds `ATTACHMENT_REQUIRED`, and returns false so the caller stops.
 */
export async function requireHumanAttachment(
  id: string,
  tab: BrowserTarget | null,
): Promise<boolean> {
  if (!tab || tab.automationMode !== "human") return true;
  if (useBrowserApprovalStore.getState().isHumanTabAttached(tab.tabId, tab.generation)) return true;
  // The shared prompt step: an `attach` prompt when one can be queued (answered
  // `ATTACHMENT_REQUIRED`, origin only — sec review P6 re-verify), a refusal when
  // the queue is full. Awaited, so the handler never resolves before its refusal
  // is delivered.
  await queueApprovalPrompt(id, tab, { operation: "attach", promptError: "ATTACHMENT_REQUIRED" }, tab.url);
  return false;
}

/** How a specific read-class action invokes the driver and shapes its response. */
export interface ReadClassOp<T> {
  /** Invoke the native command for the resolved tab and return its raw result. */
  invoke: (tab: BrowserTarget) => Promise<T>;
  /** Build the response `data` from the tab and the raw result. */
  data: (tab: BrowserTarget, result: T) => Record<string, unknown>;
}

/**
 * Run a read-class MCP browser op end-to-end: `browserEnabled` gate, tabId
 * validation, tab resolution, the human-attachment gate, the native invoke, the
 * mirrored one-shot-attachment consumption (only on success), and the response.
 * The caller supplies only the parts that differ (`op.invoke`, `op.data`).
 */
export async function runReadClass<T>(
  id: string,
  args: Record<string, unknown>,
  op: ReadClassOp<T>,
): Promise<void> {
  const tab = await resolveBrowserTarget(id, args);
  if (!tab) return;
  if (!(await requireHumanAttachment(id, tab))) return;
  // The attachment mirror follows the driver's consume exactly — spent on success
  // and on any post-authorization failure, kept on a pre-authorization refusal
  // (`browserAccess`). A rejection propagates to `wrapHandler`, which renders the
  // typed refusal; it is never swallowed into a success envelope.
  const result = await invokeAttached(tab, () => op.invoke(tab));
  await respond({ id, success: true, data: op.data(tab, result) });
}
