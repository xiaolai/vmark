/**
 * browserWaitForPoll — the pieces of `vmark.browser.wait_for` (round 3, #71):
 * request validation, the URL poll answered from the webview mirror, and the eval
 * poll raced against the request deadline. Each is a function on its own, with the
 * handler's gates and responses kept out, so each is tested for what it decides.
 *
 * Both polls re-resolve the tab EVERY round by the id the wait started on — never
 * the active tab, which an omitted `tabId` must not follow to whichever page the
 * user switches to mid-wait — and ask the caller's `guard` whether the wait may go
 * on with that tab (the handler re-requires a human attachment when the generation
 * changed: an attachment is per page).
 *
 * The eval poll honours the deadline by RACING each poll against it, not by
 * refusing to poll near it (round 2, #70): the native eval has its own timeout
 * (seconds on a busy page), so a poll may answer after the request budget — a late
 * answer would land after the bridge deadline as a redelivery, not as a result.
 * The abandoned poll's outcome is discarded and its rejection swallowed (nothing is
 * listening any more). A FLOOR on the remaining budget was the earlier shape, and
 * it made every wait shorter than the floor a single poll — a 3 s wait_for could
 * never observe a second sample. Every timeout, raced or not, carries the same
 * `reason: "timeout"` so the model reads one shape.
 *
 * @coordinates-with services/mcpBridge/v2/browserWaitFor.ts — the handler around these
 * @coordinates-with lib/browser/agent/actScript.ts — WaitCondition
 * @module services/mcpBridge/v2/browserWaitForPoll
 */

import { urlForAgent } from "@/lib/browser/url";
import type { WaitCondition } from "@/lib/browser/agent/actScript";
import { resolveBrowserTab, validateTimeout, type BrowserTarget } from "./browserHelpers";
import { readOperationArgs } from "./readOperationArgs";

const POLL_INTERVAL_MS = 200;
/** The answer a poll that outlives the request deadline is replaced with. */
const DEADLINE_PASSED: unique symbol = Symbol("deadline-passed");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A wait mode: a page condition checked by eval, or a URL check answered from
 *  the webview mirror without touching the page (WI-NB1.4). */
type WaitMode = { kind: "script"; condition: WaitCondition } | { kind: "url"; needle: string };

interface WaitRequest {
  timeoutMs: number;
  mode: WaitMode;
}

export type WaitRequestParse = { ok: true; request: WaitRequest } | { ok: false; error: string };

/** Parse exactly one condition from the args, or null if zero or more than one. */
function readCondition(args: Record<string, unknown>): WaitMode | null {
  const wire = readOperationArgs("vmark.browser.wait_for", args);
  const ref = typeof wire.ref === "string" && wire.ref.trim() ? wire.ref : undefined;
  const role = typeof wire.role === "string" && wire.role.trim() ? wire.role : undefined;
  const name = typeof wire.name === "string" ? wire.name : undefined;
  const text = typeof wire.text === "string" && wire.text.length > 0 ? wire.text : undefined;
  const urlContains =
    typeof wire.urlContains === "string" && wire.urlContains.length > 0 ? wire.urlContains : undefined;
  const modes = [ref, role, text, urlContains].filter((m) => m !== undefined).length;
  if (modes !== 1) return null;
  if (ref !== undefined) return { kind: "script", condition: { ref } };
  if (role !== undefined) {
    return { kind: "script", condition: name !== undefined ? { role, name } : { role } };
  }
  if (text !== undefined) return { kind: "script", condition: { text } };
  if (urlContains !== undefined) return { kind: "url", needle: urlContains };
  return null;
}

/**
 * Validate the wait request: a bounded timeout (defaulting to the single wait
 * budget), exactly one condition, and — for `urlContains` — a needle that can
 * match the REDACTED url at all (query and fragment are stripped so a redirect-set
 * token cannot be probed, audit A-06; a `?` or `#` in the needle can never match).
 */
export function readWaitRequest(args: Record<string, unknown>): WaitRequestParse {
  const timeoutMs = validateTimeout(args.timeoutMs);
  if (timeoutMs === null) return { ok: false, error: "INVALID_TIMEOUT" };
  const mode = readCondition(args);
  if (!mode) {
    return { ok: false, error: "wait_for needs exactly one of: ref, role (+optional name), text, or urlContains" };
  }
  if (mode.kind === "url" && /[?#]/.test(mode.needle)) {
    return {
      ok: false,
      error:
        "urlContains is matched against the redacted URL (query and fragment stripped), so a needle " +
        "containing '?' or '#' can never match — wait for the path, or for page content instead",
    };
  }
  return { ok: true, request: { timeoutMs, mode } };
}

export type WaitOutcome =
  | { kind: "matched"; url: string; ref?: string }
  | { kind: "timeout"; url: string }
  /** The tab left the store mid-wait. */
  | { kind: "tab-gone" }
  /** The caller's guard refused to go on and has answered the request itself. */
  | { kind: "aborted" };

export interface PollContext {
  /** The tab the wait started on — always re-resolved by THIS id. */
  tabId: string;
  /** The request's single deadline (epoch ms). */
  deadline: number;
  /** May the wait go on with this re-resolved tab? False means the guard has
   *  answered the request and the poll must stop without answering again. */
  guard: (tab: BrowserTarget) => Promise<boolean>;
  /** Pause between polls; the production cadence unless a test shortens it. */
  intervalMs?: number;
}

/** The tab for this round, or the outcome that ends the wait instead. */
async function nextRound(ctx: PollContext): Promise<BrowserTarget | WaitOutcome> {
  const tab = resolveBrowserTab(ctx.tabId);
  if (!tab) return { kind: "tab-gone" };
  if (!(await ctx.guard(tab))) return { kind: "aborted" };
  return tab;
}

const isOutcome = (round: BrowserTarget | WaitOutcome): round is WaitOutcome => "kind" in round;

/** Poll the webview mirror until the tab's redacted url contains `needle`. No eval. */
export async function pollUrl(ctx: PollContext, needle: string): Promise<WaitOutcome> {
  for (;;) {
    const round = await nextRound(ctx);
    if (isOutcome(round)) return round;
    const url = urlForAgent(round.url);
    if (url.includes(needle)) return { kind: "matched", url };
    if (Date.now() >= ctx.deadline) return { kind: "timeout", url };
    await sleep(ctx.intervalMs ?? POLL_INTERVAL_MS);
  }
}

/**
 * Poll the page through `evaluate` (one read-class eval of the condition script)
 * until it reports `matched`. Each poll is raced against the deadline; a driver
 * rejection that arrives in time propagates to the caller (the model sees its
 * typed token, never a `matched:false` that looks like a patient wait).
 */
export async function pollScript(
  ctx: PollContext,
  evaluate: (tab: BrowserTarget) => Promise<string>,
): Promise<WaitOutcome> {
  for (;;) {
    const round = await nextRound(ctx);
    if (isOutcome(round)) return round;
    const tab = round;
    const poll = evaluate(tab);
    const raw = await Promise.race([
      poll,
      sleep(Math.max(0, ctx.deadline - Date.now())).then((): typeof DEADLINE_PASSED => DEADLINE_PASSED),
    ]);
    if (raw === DEADLINE_PASSED) {
      poll.catch(() => undefined);
      return { kind: "timeout", url: urlForAgent(tab.url) };
    }
    const parsed = JSON.parse(raw) as { matched?: boolean; ref?: string };
    if (parsed.matched === true) {
      return { kind: "matched", url: urlForAgent(tab.url), ...(parsed.ref ? { ref: parsed.ref } : {}) };
    }
    if (Date.now() >= ctx.deadline) return { kind: "timeout", url: urlForAgent(tab.url) };
    await sleep(ctx.intervalMs ?? POLL_INTERVAL_MS);
  }
}
