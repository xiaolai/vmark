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
 * its current committed generation is used). A human tab needs an attachment, as
 * for `read`.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — buildWaitConditionScript
 * @coordinates-with services/mcpBridge/v2/browserReadClass.ts — requireHumanAttachment
 * @module services/mcpBridge/v2/browserWaitFor
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { urlForAgent } from "@/lib/browser/url";
import { buildWaitConditionScript, type WaitCondition } from "@/lib/browser/agent/actScript";
import { browserEnabled, readTabIdArg, resolveBrowserTab, validateTimeout } from "./browserHelpers";
import { requireHumanAttachment } from "./browserReadClass";

const POLL_INTERVAL_MS = 200;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A wait mode: a page condition checked by eval, or a URL check answered from
 *  the webview mirror without touching the page (WI-NB1.4). */
type WaitMode = { kind: "script"; condition: WaitCondition } | { kind: "url"; needle: string };

/** Parse exactly one condition from the args, or null if zero or more than one. */
function readCondition(args: Record<string, unknown>): WaitMode | null {
  const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref : undefined;
  const role = typeof args.role === "string" && args.role.trim() ? args.role : undefined;
  const name = typeof args.name === "string" ? args.name : undefined;
  const text = typeof args.text === "string" && args.text.length > 0 ? args.text : undefined;
  const urlContains =
    typeof args.urlContains === "string" && args.urlContains.length > 0 ? args.urlContains : undefined;
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
    if (!browserEnabled()) {
      await respond({ id, success: false, error: "BROWSER_DISABLED" });
      return;
    }
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
    const initial = resolveBrowserTab(tabIdArg);
    if (!initial) {
      await respond({ id, success: false, error: "no active browser tab" });
      return;
    }
    if (!(await requireHumanAttachment(id, initial))) return;

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // Re-resolve each round so the wait tracks navigation (current generation).
      const tab = resolveBrowserTab(tabIdArg);
      if (!tab) {
        await respond({ id, success: true, data: { matched: false, reason: "tab-gone" } });
        return;
      }
      let matched: boolean;
      let matchedRef: string | undefined;
      if (mode.kind === "url") {
        // Answered from the webview mirror: the same redacted URL the model
        // already sees on every navigation result. No eval round-trip.
        matched = urlForAgent(tab.url).includes(mode.needle);
        if (matched) {
          await respond({ id, success: true, data: { matched: true, url: urlForAgent(tab.url) } });
          return;
        }
        if (Date.now() >= deadline) {
          await respond({ id, success: true, data: { matched: false, url: urlForAgent(tab.url) } });
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      try {
        const raw = await invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildWaitConditionScript(mode.condition, tab.generation),
          operation: "read",
          generation: tab.generation,
        });
        const parsed = JSON.parse(raw) as { matched?: boolean; ref?: string };
        matched = parsed.matched === true;
        matchedRef = parsed.ref;
      } catch {
        // The tab navigated/closed mid-wait (a stale generation), or the eval did
        // not return JSON: stop rather than spin on errors.
        await respond({ id, success: true, data: { matched: false, url: urlForAgent(tab.url), reason: "unavailable" } });
        return;
      }
      if (matched) {
        await respond({
          id,
          success: true,
          data: { matched: true, url: urlForAgent(tab.url), ...(matchedRef ? { ref: matchedRef } : {}) },
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
