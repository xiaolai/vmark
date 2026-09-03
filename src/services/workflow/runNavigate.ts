/**
 * `navigate to` step (audit 2026-09-03 W-02).
 *
 * The first executor returned success the moment `browser_ai_navigate` issued a
 * ticket, so the next step ran against the PREVIOUS document at the old
 * generation — which Rust still treated as fresh. A same-role control on the old
 * page was clicked and ledgered; otherwise self-heal snapshotted the old page.
 * This step now does exactly what the one-off `navigate` tool does:
 *
 *   1. call the driver; on an `approval-required` refusal raise a run-tagged
 *      prompt for `navigate` on the DESTINATION origin, await it, retry once
 *      (no TypeScript pre-gate — the driver decides, "exactly like a hand-issued
 *      action");
 *   2. AWAIT the ticket on the navigation broker, bounded by the remaining run
 *      budget: `loaded` → success and the tab store learns the new url +
 *      generation; `failed` / `timeout` / `superseded` → failed with
 *      `postconditionMet:false` (retry-eligible); a timeout that spent the run
 *      budget pauses the run as `deadline`; a gone surface stops and asks.
 *
 * @coordinates-with services/mcpBridge/v2/browserNavigation.ts — the one-off tool this mirrors
 * @coordinates-with services/browser/browserEventBroker.ts — the ticket wait
 * @coordinates-with services/workflow/runApproval.ts — the run-tagged prompt
 * @module services/workflow/runNavigate
 */

import { invoke } from "@tauri-apps/api/core";
import { browserFailureToken, needsNavigationApproval } from "@/services/mcpBridge/v2/browserFailure";
import type { BrowserWaitResult } from "@/services/browser/browserEventBroker";
import { WorkflowPause } from "@/lib/browser/workflow/engine";
import type { StepOutcome } from "@/lib/browser/workflow/safety";
import { raceAbort, throwIfAborted, type ApprovalRequest, type AuthorizedPage } from "./runApproval";
import type { RunClock } from "./runClock";

/** The one-off tool's default navigation wait; the run budget can only shorten it. */
export const NAVIGATION_WAIT_MS = 12_000;

export interface NavigateStepContext {
  tabId: string;
  signal: AbortSignal;
  clock: RunClock;
  /** The run's approval wait (raises a run-tagged prompt and awaits the mint). */
  authorize: (req: ApprovalRequest) => Promise<AuthorizedPage>;
  /** Await a navigation ticket (the broker in production). */
  waitForNavigation: (tabId: string, navigationId: string, timeoutMs: number) => Promise<BrowserWaitResult>;
  /** The navigation landed: let the tab store learn the new url + generation. */
  onNavigated?: (nav: { url: string; generation: number }) => void;
}

/** Issue the navigation; returns the ticket's navigationId, or a failed outcome. */
async function issueNavigation(ctx: NavigateStepContext, url: string): Promise<string | StepOutcome> {
  const navigate = () => invoke<{ navigationId?: unknown }>("browser_ai_navigate", { tabId: ctx.tabId, url });
  let ticket: { navigationId?: unknown };
  try {
    ticket = await navigate();
  } catch (error) {
    if (!needsNavigationApproval(error)) return { outcome: "failed", reason: browserFailureToken(error) };
    // Approval on the destination origin, then exactly one retry — the one-off tool's shape.
    await ctx.authorize({ url, operation: "navigate" });
    throwIfAborted(ctx.signal);
    try {
      ticket = await navigate();
    } catch (again) {
      return { outcome: "failed", reason: needsNavigationApproval(again) ? "APPROVAL_REQUIRED" : browserFailureToken(again) };
    }
  }
  const navigationId = ticket && typeof ticket === "object" ? ticket.navigationId : undefined;
  if (typeof navigationId !== "string" || navigationId === "") return { outcome: "failed", reason: "NO_NAVIGATION_TICKET" };
  return navigationId;
}

/** Run one `navigate to <url>` step to a verified outcome. */
export async function runNavigateStep(ctx: NavigateStepContext, url: string): Promise<StepOutcome> {
  throwIfAborted(ctx.signal);
  const issued = await issueNavigation(ctx, url);
  if (typeof issued !== "string") return issued;

  const budget = Math.min(NAVIGATION_WAIT_MS, ctx.clock.remaining());
  if (budget <= 0) throw new WorkflowPause("deadline", "the run budget was spent before the navigation could be awaited");
  const result = await raceAbort(ctx.waitForNavigation(ctx.tabId, issued, budget), ctx.signal);
  throwIfAborted(ctx.signal);

  switch (result.kind) {
    case "loaded":
      ctx.onNavigated?.({ url: result.url, generation: result.generation });
      return { outcome: "success", postconditionMet: true };
    case "failed":
      return { outcome: "failed", postconditionMet: false, reason: `NAVIGATION_FAILED: ${result.message}` };
    case "superseded":
      return { outcome: "failed", postconditionMet: false, reason: "NAVIGATION_SUPERSEDED" };
    case "timeout":
      if (ctx.clock.expired()) throw new WorkflowPause("deadline", "the run budget was spent waiting for the navigation");
      // The ticket is still live and may yet load: "confirmed not applied" would let the
      // engine issue the same navigation again on top of it. Inconclusive → a human.
      return { outcome: "unknown", reason: "TIMEOUT" };
    case "disabled":
      return { outcome: "failed", reason: "BROWSER_DISABLED" };
    case "unmounted":
      return { outcome: "failed", reason: "WINDOW_UNAVAILABLE" };
    default:
      return { outcome: "failed", reason: "TAB_NOT_FOUND" };
  }
}
