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
 * gate (browser/authorize.rs). A post-authorization data response passes URLs
 * through `urlForAgent` (path kept); a PRE-authorization approval envelope uses
 * `originForAgent` (origin only) so a credential-bearing path can't leak.
 *
 * @coordinates-with hooks/mcpBridge/v2/browser.ts — handleBrowserRead / handleBrowserAct
 * @coordinates-with hooks/mcpBridge/v2/browserScreenshot.ts — handleBrowserScreenshot
 * @module hooks/mcpBridge/v2/browserReadClass
 */

import { respond } from "../utils";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { originForAgent } from "@/lib/browser/url";
import { browserEnabled, readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";

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
  approvals.requestApproval(id, tab.url, "attach", undefined, tab.tabId, tab.generation);
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
  if (!browserEnabled()) {
    await respond({ id, success: false, error: "BROWSER_DISABLED" });
    return;
  }
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
  const approvals = useBrowserApprovalStore.getState();
  const humanRead =
    tab.automationMode === "human" && approvals.isHumanTabAttached(tab.tabId, tab.generation);
  const result = await op.invoke(tab);
  // Rust consumes the one-shot attachment while authorizing; mirror that after the
  // command succeeds so the next action cannot pass the frontend check then fail
  // in the driver. On an invoke rejection this is skipped — consent is not spent.
  if (humanRead) approvals.consumeHumanTabAttachment(tab.tabId, tab.generation);
  await respond({ id, success: true, data: op.data(tab, result) });
}
