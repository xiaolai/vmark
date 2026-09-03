/**
 * MCP v2 `vmark.browser.wait_for` handler (WI-P3.1).
 *
 * Purpose: make a multi-step flow deterministic — "click → wait_for the
 * destination heading → read" — instead of "click → guess → re-read → retry".
 * Blocks until a page condition holds (an element by `ref`, by `role` +optional
 * `name`, a substring of visible `text`, or `urlContains` — a substring of the
 * tab URL, answered from the webview mirror with no eval round-trip, WI-NB1.4)
 * or a bounded timeout elapses, reporting `matched: true|false` so the caller
 * can tell "found" from "timed out".
 *
 * Read-class: each check is a fast SYNCHRONOUS `browser_eval` authorized as
 * `read`. It POLLS rather than blocking one long eval, because the driver's
 * per-eval run-loop pump is short — polling also keeps each eval well under that
 * cap and lets the wait track a navigation (the tab is re-resolved each round, so
 * its current committed generation is used).
 *
 * Audit 2026-09-03: a human tab attached with "Allow once" holds ONE authorized
 * read, and a poll loop is many — the first poll spent it and every later poll
 * was refused, reported as `matched:false` (A-01). Such a tab is now refused up
 * front with `ATTACHMENT_ONCE_INSUFFICIENT`; "Allow until navigation" covers a
 * wait. A driver rejection during a poll propagates as its typed token instead of
 * a success envelope (E-01). `urlContains` matches the REDACTED url — query and
 * fragment are stripped so a redirect-set token cannot be probed — so a needle
 * containing `?` or `#` can never match and is refused with a reason (A-06).
 *
 * @coordinates-with lib/browser/agent/actScript.ts — buildWaitConditionScript
 * @coordinates-with services/mcpBridge/v2/browserAccess.ts — gate + attachment mirror
 * @module services/mcpBridge/v2/browserWaitFor
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { urlForAgent } from "@/lib/browser/url";
import { buildWaitConditionScript, type WaitCondition } from "@/lib/browser/agent/actScript";
import { readTabIdArg, resolveBrowserTab, validateTimeout } from "./browserHelpers";
import { browserGate, hasOnceAttachment, invokeAttached } from "./browserAccess";
import { requireHumanAttachment } from "./browserReadClass";
import { readOperationArgs } from "./readOperationArgs";

const POLL_INTERVAL_MS = 200;
/** The answer a poll that outlives the request deadline is replaced with. */
const DEADLINE_PASSED: unique symbol = Symbol("deadline-passed");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A wait mode: a page condition checked by eval, or a URL check answered from
 *  the webview mirror without touching the page (WI-NB1.4). */
type WaitMode = { kind: "script"; condition: WaitCondition } | { kind: "url"; needle: string };

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

/** `vmark.browser.wait_for` — poll until a condition holds or the timeout elapses. */
export async function handleBrowserWaitFor(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) {
      await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
      return;
    }
    const timeoutMs = validateTimeout(args.timeoutMs);
    if (timeoutMs === null) {
      await respond({ id, success: false, error: "INVALID_TIMEOUT" });
      return;
    }
    const mode = readCondition(args);
    if (!mode) {
      await respond({
        id,
        success: false,
        error: "wait_for needs exactly one of: ref, role (+optional name), text, or urlContains",
      });
      return;
    }
    if (mode.kind === "url" && /[?#]/.test(mode.needle)) {
      await respond({
        id,
        success: false,
        error:
          "urlContains is matched against the redacted URL (query and fragment stripped), so a needle " +
          "containing '?' or '#' can never match — wait for the path, or for page content instead",
      });
      return;
    }
    const initial = resolveBrowserTab(tabIdArg);
    if (!initial) {
      await respond({ id, success: false, error: "no active browser tab" });
      return;
    }
    if (!(await requireHumanAttachment(id, initial))) return;
    if (mode.kind === "script" && hasOnceAttachment(initial)) {
      await respond({
        id,
        success: false,
        error:
          "ATTACHMENT_ONCE_INSUFFICIENT: wait_for polls the page repeatedly, and this tab is attached for " +
          "one read only — ask the user for 'Allow until navigation', or use browser_read read once",
        data: { token: "ATTACHMENT_ONCE_INSUFFICIENT", tabId: initial.tabId, generation: initial.generation },
      });
      return;
    }

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // Re-resolve each round so the wait tracks navigation (current generation) —
      // but ALWAYS the tab the wait started on: an omitted tabId must not follow
      // the active tab to whichever page the user switches to mid-wait.
      const tab = resolveBrowserTab(initial.tabId);
      if (!tab) {
        await respond({ id, success: true, data: { matched: false, reason: "tab-gone" } });
        return;
      }
      // A navigation changes the generation, and an attachment is per generation:
      // the page that was attached is gone, so re-ask rather than keep reading.
      if (tab.generation !== initial.generation && !(await requireHumanAttachment(id, tab))) return;
      if (mode.kind === "url") {
        // Answered from the webview mirror: the same redacted URL the model
        // already sees on every navigation result. No eval round-trip.
        const url = urlForAgent(tab.url);
        if (url.includes(mode.needle)) {
          await respond({ id, success: true, data: { matched: true, url } });
          return;
        }
        if (Date.now() >= deadline) {
          await respond({ id, success: true, data: { matched: false, url } });
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      // The deadline is honoured by RACING the poll against it, not by refusing
      // to poll near it: the native eval has its own timeout (seconds on a busy
      // page), so a poll may answer after the request budget — a late answer
      // would land after the bridge deadline as a redelivery, not as a result.
      // The abandoned poll's outcome is discarded (and its rejection swallowed:
      // nothing is listening any more). A floor on the remaining budget was the
      // earlier shape, and it made every wait shorter than the floor a single
      // poll — a 3 s wait_for could never observe a second sample.
      // A driver rejection that arrives in time (the tab navigated away, the
      // browser was disabled, an eval failure) is thrown to `wrapHandler` and
      // reaches the model as its typed token — never as a `matched:false` that
      // looks like a patient wait.
      const poll = invokeAttached(tab, () =>
        invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildWaitConditionScript(mode.condition, tab.generation),
          operation: "read",
          generation: tab.generation,
        }),
      );
      const raw = await Promise.race([
        poll,
        sleep(Math.max(0, deadline - Date.now())).then((): typeof DEADLINE_PASSED => DEADLINE_PASSED),
      ]);
      if (raw === DEADLINE_PASSED) {
        poll.catch(() => undefined);
        await respond({ id, success: true, data: { matched: false, url: urlForAgent(tab.url), reason: "timeout" } });
        return;
      }
      const parsed = JSON.parse(raw) as { matched?: boolean; ref?: string };
      if (parsed.matched === true) {
        await respond({
          id,
          success: true,
          data: { matched: true, url: urlForAgent(tab.url), ...(parsed.ref ? { ref: parsed.ref } : {}) },
        });
        return;
      }
      if (Date.now() >= deadline) {
        await respond({ id, success: true, data: { matched: false, url: urlForAgent(tab.url) } });
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  });
}
