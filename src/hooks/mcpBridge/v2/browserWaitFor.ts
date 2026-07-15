/**
 * MCP v2 `vmark.browser.wait_for` handler (WI-P3.1).
 *
 * Purpose: make a multi-step flow deterministic — "click → wait_for the
 * destination heading → read" — instead of "click → guess → re-read → retry".
 * Blocks until a page condition holds (an element by `ref`, by `role` +optional
 * `name`, or a substring of visible `text`) or a bounded timeout elapses,
 * reporting `matched: true|false` so the caller can tell "found" from "timed out".
 *
 * Read-class: each check is a fast SYNCHRONOUS `browser_eval` authorized as
 * `read`. It POLLS rather than blocking one long eval, because the driver's
 * per-eval run-loop pump is short — polling also keeps each eval well under that
 * cap and lets the wait track a navigation (the tab is re-resolved each round, so
 * its current committed generation is used). A human tab needs an attachment, as
 * for `read`.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — buildWaitConditionScript
 * @coordinates-with hooks/mcpBridge/v2/browserReadClass.ts — requireHumanAttachment
 * @module hooks/mcpBridge/v2/browserWaitFor
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { urlForAgent } from "@/lib/browser/url";
import { buildWaitConditionScript, type WaitCondition } from "@/lib/browser/agent/actScript";
import { browserEnabled, readTabIdArg, resolveBrowserTab, validateTimeout } from "./browserHelpers";
import { requireHumanAttachment } from "./browserReadClass";

const POLL_INTERVAL_MS = 200;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Parse exactly one condition from the args, or null if zero or more than one. */
function readCondition(args: Record<string, unknown>): WaitCondition | null {
  const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref : undefined;
  const role = typeof args.role === "string" && args.role.trim() ? args.role : undefined;
  const name = typeof args.name === "string" ? args.name : undefined;
  const text = typeof args.text === "string" && args.text.length > 0 ? args.text : undefined;
  const modes = [ref !== undefined, role !== undefined, text !== undefined].filter(Boolean).length;
  if (modes !== 1) return null;
  if (ref !== undefined) return { ref };
  if (role !== undefined) return name !== undefined ? { role, name } : { role };
  return { text };
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
    const condition = readCondition(args);
    if (!condition) {
      await respond({
        id,
        success: false,
        error: "wait_for needs exactly one of: ref, role (+optional name), or text",
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
      let matched = false;
      let matchedRef: string | undefined;
      try {
        const raw = await invoke<string>("browser_eval", {
          tabId: tab.tabId,
          script: buildWaitConditionScript(condition, tab.generation),
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
