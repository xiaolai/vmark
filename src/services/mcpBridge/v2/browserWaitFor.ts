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
 * Shape (round 3, #71): the shared envelope resolves the tab, `readWaitRequest`
 * validates the request, the attachment gates run, and the wait itself is one of
 * two polls in `browserWaitForPoll` — the URL poll against the mirror, or the
 * read-class eval poll raced against the deadline — whose outcome this handler
 * turns into the response. Read-class: each check is a fast SYNCHRONOUS
 * `browser_eval` authorized as `read`. It POLLS rather than blocking one long
 * eval, because the driver's per-eval run-loop pump is short — polling also keeps
 * each eval well under that cap and lets the wait track a navigation.
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
 * @coordinates-with services/mcpBridge/v2/browserWaitForPoll.ts — validation + the two polls
 * @coordinates-with lib/browser/agent/actScript.ts — buildWaitConditionScript
 * @coordinates-with services/mcpBridge/v2/browserAccess.ts — gate + tab resolution + attachment mirror
 * @module services/mcpBridge/v2/browserWaitFor
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { buildWaitConditionScript } from "@/lib/browser/agent/actScript";
import { hasOnceAttachment, invokeAttached, resolveBrowserTarget } from "./browserAccess";
import { requireHumanAttachment } from "./browserReadClass";
import { pollScript, pollUrl, readWaitRequest, type PollContext, type WaitOutcome } from "./browserWaitForPoll";

/** The response for a wait that ended — a guard that aborted has answered already. */
async function respondOutcome(id: string, outcome: WaitOutcome): Promise<void> {
  switch (outcome.kind) {
    case "aborted":
      return;
    case "tab-gone":
      await respond({ id, success: true, data: { matched: false, reason: "tab-gone" } });
      return;
    case "matched":
      await respond({
        id,
        success: true,
        data: { matched: true, url: outcome.url, ...(outcome.ref ? { ref: outcome.ref } : {}) },
      });
      return;
    case "timeout":
      await respond({ id, success: true, data: { matched: false, url: outcome.url, reason: "timeout" } });
      return;
  }
}

/** `vmark.browser.wait_for` — poll until a condition holds or the timeout elapses. */
export async function handleBrowserWaitFor(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const initial = await resolveBrowserTarget(id, args);
    if (!initial) return;
    const parsed = readWaitRequest(args);
    if (!parsed.ok) {
      await respond({ id, success: false, error: parsed.error });
      return;
    }
    const { timeoutMs, mode } = parsed.request;
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
    const ctx: PollContext = {
      tabId: initial.tabId,
      deadline: Date.now() + timeoutMs,
      // A navigation changes the generation, and an attachment is per generation:
      // the page that was attached is gone, so re-ask rather than keep reading.
      guard: (tab) => (tab.generation === initial.generation ? Promise.resolve(true) : requireHumanAttachment(id, tab)),
    };
    const outcome =
      mode.kind === "url"
        ? await pollUrl(ctx, mode.needle)
        : await pollScript(ctx, (tab) =>
            invokeAttached(tab, () =>
              invoke<string>("browser_eval", {
                tabId: tab.tabId,
                script: buildWaitConditionScript(mode.condition, tab.generation),
                operation: "read",
                generation: tab.generation,
              }),
            ),
          );
    await respondOutcome(id, outcome);
  });
}
