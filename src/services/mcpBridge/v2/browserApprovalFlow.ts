/**
 * browserApprovalFlow — the ONE approval state machine behind every gated browser
 * operation (round 3, #43/#59/#42).
 *
 * Purpose: decide → spend a one-shot → queue a prompt → confirm the driver's mint,
 * with an explicit outcome at each exit. The act, power (`style`/`eval`), session
 * and record handlers each carried their own copy of this machine, and the copies
 * had drifted: a never-approvable operation read as "queue full" in three of them,
 * the record prompt omitted the generation every other prompt carries, and the
 * navigation handlers had a fourth spelling of the queue step. Each handler now
 * supplies only what differs — the operation, the bindings, the prose.
 *
 * Contracts every caller inherits:
 *  - `denied` is final and prompts nothing; `allowed` (a standing grant) touches no
 *    one-shot and no driver.
 *  - A one-shot is spent against the EXACT bindings (target, script, generation):
 *    approving script A never authorizes script B (security review P5, High #1).
 *  - The frontend copy is spent first and the driver's mint AWAITED before the
 *    caller may act (one mint path, audit A-04); a refused mint is a refusal.
 *  - `needsApproval` is answered only when a prompt actually exists: over the cap
 *    the request is refused as such, and an operation the store cannot queue is
 *    refused as one that cannot be approved.
 *  - The pre-authorization envelope shows the ORIGIN only, never a path that can
 *    carry a token (sec review P6); a post-authorization response may keep the path.
 *
 * @coordinates-with stores/browserApprovalStore.ts — decide / consumeOneShot / requestApproval
 * @coordinates-with services/browser/grantSync.ts — mintOneShotConfirmed, the one mint path
 * @coordinates-with src-tauri browser/authorize.rs — the authoritative gate this mirrors
 * @coordinates-with services/mcpBridge/v2/browserActFlow.ts, browserPower.ts, browserSession.ts,
 *   browserRecord.ts, browserReadClass.ts, browserNavigationShared.ts — the callers
 * @module services/mcpBridge/v2/browserApprovalFlow
 */

import { respond } from "@/services/mcpBridge/utils";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { grantPatternFor } from "@/stores/browserApprovalStore.helpers";
import type { ActionTarget } from "@/stores/browserApprovalStore.types";
import { mintOneShotConfirmed } from "@/services/browser/grantSync";
import { originForAgent } from "@/lib/browser/url";
import type { BrowserTarget } from "./browserHelpers";

/** The tab a prompt is raised for — all the store binds a prompt and a one-shot to. */
export type PromptTab = Pick<BrowserTarget, "tabId" | "generation">;

/** What one gated operation needs authorized, and how its prompt reads. */
export interface ApprovalSpec {
  /** The operation token (`click`, `style`, `eval`, `session`, `record`, `navigate`…). */
  operation: string;
  /** The element a role/name act binds; absent for a target-less operation. */
  target?: ActionTarget;
  /** The exact payload bound into the one-shot and the driver mint (the built
   *  script, `action:handle`…); absent for an operation that binds none. */
  script?: string;
  /** Display-only one-line summary of a bound payload for the prompt. */
  payloadSummary?: string;
  /** The subject of the default prompt prose, `'${operation}'` unless given. */
  describe?: string;
  /** Replaces the default prompt prose outright (a bare token such as
   *  `APPROVAL_REQUIRED` for a client that matches on it). */
  promptError?: string;
  /** The url the envelope shows — origin-only by default. A caller passes the
   *  destination it was GIVEN when that, not the page, is what is being approved. */
  promptUrl?: string;
  /** Extra envelope fields (`action`, `handle`, a truncated `script`, `retry`). */
  promptData?: Record<string, unknown>;
}

export type AuthorizeOutcome = "authorized" | "queued" | "refused";
export type QueueOutcome = "queued" | "refused";

export const QUEUE_FULL_MESSAGE = "approval queue is full — resolve or deny pending approvals, then retry";

/**
 * Queue the prompt for `spec` on `targetUrl` and answer the request. `queued` means
 * a prompt exists (raised now, or already raised under this id) and the caller has
 * been told `needsApproval`; `refused` means no prompt exists and the caller has
 * been told why — a `needsApproval` envelope then would point the client at an
 * approval that can never resolve.
 */
export async function queueApprovalPrompt(
  id: string,
  tab: PromptTab,
  spec: ApprovalSpec,
  targetUrl: string,
): Promise<QueueOutcome> {
  const queued = useBrowserApprovalStore
    .getState()
    .requestApproval(
      id,
      targetUrl,
      spec.operation,
      spec.target,
      tab.tabId,
      tab.generation,
      spec.script,
      undefined,
      spec.payloadSummary,
    );
  if (queued === "overloaded") {
    await respond({ id, success: false, error: QUEUE_FULL_MESSAGE });
    return "refused";
  }
  if (queued === "rejected") {
    await respond({ id, success: false, error: `operation '${spec.operation}' cannot be approved` });
    return "refused";
  }
  const url = spec.promptUrl ?? originForAgent(targetUrl);
  await respond({
    id,
    success: false,
    error: spec.promptError ?? `approval required: ${spec.describe ?? `'${spec.operation}'`} on ${url}`,
    data: {
      needsApproval: true,
      operation: spec.operation,
      url,
      tabId: tab.tabId,
      generation: tab.generation,
      ...spec.promptData,
    },
  });
  return "queued";
}

/**
 * Wait until the driver holds the one-shot the frontend just spent. False when the
 * driver refused it (a stale generation, a missing payload) or the origin is opaque
 * and has no grant pattern: the action must then fail, never proceed unauthorized.
 */
export async function confirmOneShotMint(tab: PromptTab, spec: ApprovalSpec, targetUrl: string): Promise<boolean> {
  const pattern = grantPatternFor(targetUrl);
  if (pattern === null) return false;
  return mintOneShotConfirmed({
    originPattern: pattern,
    operation: spec.operation,
    tabId: tab.tabId,
    generation: tab.generation,
    ...(spec.target ? { target: spec.target } : {}),
    ...(spec.script !== undefined ? { script: spec.script } : {}),
  });
}

/**
 * Authorize `spec` on `tab`'s current page. `authorized` means the caller may act
 * now (a standing grant, or a spent one-shot the driver confirmed); anything else
 * has already been answered on `id` — `queued` with a `needsApproval` envelope,
 * `refused` with the reason.
 */
export async function authorizeOperation(id: string, tab: BrowserTarget, spec: ApprovalSpec): Promise<AuthorizeOutcome> {
  const decision = useBrowserApprovalStore.getState().decide(tab.url, spec.operation);
  if (decision === "denied") {
    await respond({ id, success: false, error: `operation '${spec.operation}' is not permitted` });
    return "refused";
  }
  if (decision === "allowed") return "authorized";
  const spent = useBrowserApprovalStore
    .getState()
    .consumeOneShot(tab.url, spec.operation, spec.target, tab.tabId, spec.script, tab.generation);
  if (!spent) return queueApprovalPrompt(id, tab, spec, tab.url);
  // The frontend copy is spent; act only once the driver confirms its own copy
  // exists, else the action is refused as unauthorized while the mirror is gone.
  if (!(await confirmOneShotMint(tab, spec, tab.url))) {
    await respond({
      id,
      success: false,
      error: `the driver refused the '${spec.operation}' authorization — the page may have navigated; retry to be prompted again`,
    });
    return "refused";
  }
  return "authorized";
}
