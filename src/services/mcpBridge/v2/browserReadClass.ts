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
 * gate (browser/authorize.rs). The feature/platform gate and the attachment
 * mirror discipline live in `browserAccess.ts` and are shared with the act-class
 * handlers. A post-authorization data response passes URLs
 * through `urlForAgent` (path kept); a PRE-authorization approval envelope uses
 * `originForAgent` (origin only) so a credential-bearing path can't leak.
 *
 * @coordinates-with services/mcpBridge/v2/browser.ts — handleBrowserRead / handleBrowserAct
 * @coordinates-with services/mcpBridge/v2/browserScreenshot.ts — handleBrowserScreenshot
 * @coordinates-with services/mcpBridge/v2/browserAccess.ts — gate + attachment mirror
 * @module services/mcpBridge/v2/browserReadClass
 */

import { respond } from "@/services/mcpBridge/utils";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { originForAgent } from "@/lib/browser/url";
import { readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { browserGate, invokeAttached } from "./browserAccess";

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
  const approvals = useBrowserApprovalStore.getState();
  if (approvals.isHumanTabAttached(tab.tabId, tab.generation)) return true;
  const queued = approvals.requestApproval(id, tab.url, "attach", undefined, tab.tabId, tab.generation);
  // No prompt exists to approve: a needsApproval envelope would be a lie.
  if (queued === "overloaded" || queued === "rejected") {
    await respond({
      id,
      success: false,
      error: "approval queue is full — resolve or deny pending approvals, then retry",
    });
    return false;
  }
  // Await the refusal: fire-and-forget let a handler resolve before the response
  // was actually delivered, which every other response path avoids.
  await respond({
    id,
    success: false,
    error: "ATTACHMENT_REQUIRED",
    data: {
      needsApproval: true,
      operation: "attach",
      // Origin only — this pre-authorization envelope must not leak a credential-
      // bearing path (`/magic-login/<token>`). (Sec review P6 re-verify.)
      url: originForAgent(tab.url),
      tabId: tab.tabId,
      generation: tab.generation,
    },
  });
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
  if (!(await browserGate(id))) return;
  const tabIdArg = readTabIdArg(args);
  if (tabIdArg === null) {
    await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
    return;
  }
  const tab = resolveBrowserTab(tabIdArg);
  if (!tab) {
    await respond({ id, success: false, error: "no active browser tab" });
    return;
  }
  if (!(await requireHumanAttachment(id, tab))) return;
  // The attachment mirror follows the driver's consume exactly — spent on success
  // and on any post-authorization failure, kept on a pre-authorization refusal
  // (`browserAccess`). A rejection propagates to `wrapHandler`, which renders the
  // typed refusal; it is never swallowed into a success envelope.
  const result = await invokeAttached(tab, () => op.invoke(tab));
  await respond({ id, success: true, data: op.data(tab, result) });
}
