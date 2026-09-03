/**
 * Run-scoped approval wait (audit 2026-09-03 W-01 / W-06 / W-09 — the D1v2
 * approval state machine for one write step).
 *
 *   requested → approved (await the Rust mint confirmation, then act)
 *             / denied (pause `denied`, stop-and-ask)
 *             / dropped-by-navigation (re-request ONCE against the page the tab
 *               moved to, then pause `dropped-by-navigation`)
 *             / queue-full (no prompt could be raised — pause `queue-full`)
 *             / run-cancelled or lease-lost (exit at once; never mint, never act)
 *
 * Every attempt re-decides authorization (P-1): a standing grant acts directly, a
 * matching one-shot is consumed and its mint awaited, anything else raises a
 * prompt tagged with the run id and polls until it resolves. The poll is
 * CANCELLABLE — the run's `AbortSignal` (fired by `workflow_cancel` and by the
 * lease's in-flight canceller on human takeover) and a moved lease epoch both end
 * it immediately, before any mint. W-01 was the poll checking only the deadline:
 * a user who took the tab back could still be shown the prompt, answer it, and
 * watch the run click on a page they now owned.
 *
 * The run clock is paused from `requestApproval` until the prompt resolves or is
 * withdrawn (D1v2: approval time is excluded from the 120 s budget), and the run
 * state's `pendingApproval` mirrors the open prompt for `workflow_status`.
 *
 * A prompt that vanished without authorization is a denial when the tab is on the
 * same page, and a navigation drop when the generation moved — `BrowserSurface`
 * dismisses the tab's prompts and advances the generation in the same handler.
 *
 * @coordinates-with stores/browserApprovalStore.ts — the prompt queue and one-shots
 * @coordinates-with services/browser/grantSync.ts — `mintOneShotConfirmed`, the one mint path
 * @coordinates-with services/browser/lease.ts — the takeover epoch
 * @module services/workflow/runApproval
 */

import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { grantPatternFor } from "@/stores/browserApprovalStore.helpers";
import type { ActionTarget } from "@/stores/browserApprovalStore.types";
import { mintOneShotConfirmed } from "@/services/browser/grantSync";
import { useBrowserLeaseStore } from "@/services/browser/lease";
import { originForAgent } from "@/lib/browser/url";
import { WorkflowPause } from "@/lib/browser/workflow/engine";
import type { RunClock } from "./runClock";
import type { PendingApprovalInfo } from "./runRegistry";

export interface ApprovalWaitContext {
  tabId: string;
  runId: string;
  /** Fired by cancel and by the lease's in-flight canceller (human takeover). */
  signal: AbortSignal;
  clock: RunClock;
  /** The lease epoch when the run acquired the tab; a different value means the
   *  authority was reclaimed or released since. */
  leaseEpoch: number;
  resolveTab: () => { url: string; generation: number } | null;
  now: () => number;
  pollMs: number;
  onPendingApproval: (info: PendingApprovalInfo | null) => void;
}

export interface ApprovalRequest {
  url: string;
  operation: string;
  target?: ActionTarget;
  /** The BUILT script, for the payload-binding ops (`type`, `key`, `scroll`). */
  script?: string;
  /** Display-only summary of the bound payload (`Text: "…"`). */
  payloadSummary?: string;
}

/** The page the authorization was granted against — act on exactly this. */
export interface AuthorizedPage {
  url: string;
  generation: number;
}

let sequence = 0;

/** Throw the abort reason (a `WorkflowPause`) if the run was aborted. */
export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new WorkflowPause("cancelled", "the run was cancelled");
}

/** Sleep that wakes at once when the run is aborted (the abort is then thrown). */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Race a promise against the abort signal; an abort rejects with its reason. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Consume the frontend one-shot and await the driver's copy (P-1, single mint path). */
async function consumeAndMint(ctx: ApprovalWaitContext, req: ApprovalRequest, page: AuthorizedPage): Promise<boolean> {
  const store = useBrowserApprovalStore.getState();
  if (!store.consumeOneShot(page.url, req.operation, req.target, ctx.tabId, req.script, page.generation)) return false;
  throwIfAborted(ctx.signal); // never mint after control was taken
  const pattern = grantPatternFor(page.url);
  if (pattern === null) throw new Error(`no grantable origin for ${originForAgent(page.url)}`);
  const ok = await mintOneShotConfirmed({
    originPattern: pattern,
    operation: req.operation,
    tabId: ctx.tabId,
    generation: page.generation,
    ...(req.target ? { target: req.target } : {}),
    ...(req.script !== undefined ? { script: req.script } : {}),
  });
  if (!ok) throw new Error(`the driver refused the '${req.operation}' authorization`);
  throwIfAborted(ctx.signal); // never act after control was taken
  return true;
}

type PollOutcome = "authorized" | "dropped";

/** Poll until the prompt `reqId` is answered or vanishes. Exits at once on abort
 *  or a moved lease epoch (thrown as a pause). */
async function pollPrompt(ctx: ApprovalWaitContext, req: ApprovalRequest, reqId: string, page: AuthorizedPage): Promise<PollOutcome> {
  for (;;) {
    throwIfAborted(ctx.signal);
    if (useBrowserLeaseStore.getState().epochOf(ctx.tabId) !== ctx.leaseEpoch) {
      throw new WorkflowPause("lease-lost", "automation lease lost while waiting for approval — a human took control");
    }
    const store = useBrowserApprovalStore.getState();
    if (store.decide(page.url, req.operation) === "allowed") return "authorized"; // "remember"
    if (await consumeAndMint(ctx, req, page)) return "authorized"; // "once"
    if (!store.pending.some((p) => p.id === reqId)) return "dropped"; // denied, or the page moved
    await abortableSleep(ctx.pollMs, ctx.signal);
  }
}

/** Raise the run-tagged prompt for `page`; returns the request id. */
function raisePrompt(ctx: ApprovalWaitContext, req: ApprovalRequest, page: AuthorizedPage): string {
  sequence += 1;
  const reqId = `${ctx.runId}:${req.operation}:${req.target?.role ?? ""}:${req.target?.name ?? ""}:${ctx.now()}:${sequence}`;
  const queued = useBrowserApprovalStore
    .getState()
    .requestApproval(reqId, page.url, req.operation, req.target, ctx.tabId, page.generation, req.script, ctx.runId, req.payloadSummary);
  if (queued === "overloaded" || queued === "rejected") {
    throw new WorkflowPause(
      "queue-full",
      `no approval prompt could be raised for '${req.operation}' on ${originForAgent(page.url)} (${queued})`,
    );
  }
  return reqId;
}

function currentPage(ctx: ApprovalWaitContext, fallback: AuthorizedPage): AuthorizedPage {
  const tab = ctx.resolveTab();
  return tab ? { url: tab.url, generation: tab.generation } : fallback;
}

/**
 * Ensure `req.operation` on `req.target` is authorized for the tab's current page.
 * Resolves with the page the authorization is valid for; throws a `WorkflowPause`
 * (denied / queue-full / dropped-by-navigation / lease-lost / cancelled) or an
 * `Error` (driver refused the mint → needs-human) otherwise.
 */
export async function awaitAuthorization(ctx: ApprovalWaitContext, req: ApprovalRequest): Promise<AuthorizedPage> {
  throwIfAborted(ctx.signal);
  let page = currentPage(ctx, { url: req.url, generation: 0 });
  const store = useBrowserApprovalStore.getState();
  const decision = store.decide(page.url, req.operation);
  if (decision === "denied") {
    throw new WorkflowPause("denied", `operation '${req.operation}' is not permitted on ${originForAgent(page.url)}`);
  }
  if (decision === "allowed") return page;
  if (await consumeAndMint(ctx, req, page)) return page;

  let rerequested = false;
  for (;;) {
    const reqId = raisePrompt(ctx, req, page);
    ctx.onPendingApproval({ operation: req.operation, url: originForAgent(page.url), ...(req.target ? { target: req.target } : {}) });
    ctx.clock.pause();
    let outcome: PollOutcome;
    try {
      outcome = await pollPrompt(ctx, req, reqId, page);
    } finally {
      ctx.clock.resume();
      ctx.onPendingApproval(null);
    }
    if (outcome === "authorized") return page;
    const fresh = currentPage(ctx, page);
    if (fresh.generation === page.generation) {
      throw new WorkflowPause("denied", `the user denied '${req.operation}' on ${originForAgent(page.url)}`);
    }
    if (rerequested) {
      throw new WorkflowPause(
        "dropped-by-navigation",
        `the approval prompt for '${req.operation}' was dropped by navigation twice — the page keeps moving`,
      );
    }
    rerequested = true;
    page = fresh;
  }
}
